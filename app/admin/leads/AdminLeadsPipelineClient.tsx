"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  computeContactStatus,
  CONTACT_STATUS_META,
  MARKETING_PIPELINE_STATUS_ORDER,
  type ContactStatusKey,
} from "@/lib/contact-status";
import { leadConversationAt } from "@/lib/lead-activity";
import type { LeadRow } from "@/lib/leads-types";
import { MARKETING_CONVERSATIONS_SLUG, marketingWaSessionId } from "@/lib/marketing-whatsapp";
import MarketingLeadAnswersModal from "@/app/admin/leads/MarketingLeadAnswersModal";

type PipelineStatus = ContactStatusKey | "none";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("he-IL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function israelTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

function tomorrowYmd(): string {
  const parts = israelTodayYmd().split("-").map(Number);
  const d = new Date(Date.UTC(parts[0] ?? 2026, (parts[1] ?? 1) - 1, (parts[2] ?? 1) + 1));
  return d.toISOString().slice(0, 10);
}

function defaultLast30DaysRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return { from: toDateInputValue(from), to: toDateInputValue(to) };
}

function startOfDayIso(dateInput: string): string | null {
  if (!dateInput.trim()) return null;
  const d = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function endOfDayIso(dateInput: string): string | null {
  if (!dateInput.trim()) return null;
  const d = new Date(`${dateInput}T23:59:59.999`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function matchesConversationDateRange(contactAt: string | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!contactAt) return false;
  const t = new Date(contactAt).getTime();
  if (Number.isNaN(t)) return false;
  const fromIso = from ? startOfDayIso(from) : null;
  const toIso = to ? endOfDayIso(to) : null;
  if (fromIso && t < new Date(fromIso).getTime()) return false;
  if (toIso && t > new Date(toIso).getTime()) return false;
  return true;
}

function leadStatus(c: LeadRow): PipelineStatus {
  return computeContactStatus(c) ?? "none";
}

function pipelineLabel(status: PipelineStatus): string {
  if (status === "none") return "ללא סטטוס";
  return CONTACT_STATUS_META[status].label;
}

function pipelineHeaderClass(status: PipelineStatus): string {
  if (status === "none") return "border-zinc-200 bg-zinc-50 text-zinc-600";
  return CONTACT_STATUS_META[status].badgeClass;
}

const ALWAYS_VISIBLE: PipelineStatus[] = [
  "template",
  "active",
  "followup",
  "human_followup",
  "no_response",
  "registered",
];

function nextCallMs(c: LeadRow): number {
  const raw = String(c.next_call_at ?? "").trim();
  if (!raw) return Number.POSITIVE_INFINITY;
  const t = new Date(`${raw}T00:00:00`).getTime();
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

function sortColumnLeads(status: PipelineStatus, rows: LeadRow[]): LeadRow[] {
  if (status !== "human_followup") return rows;
  return [...rows].sort((a, b) => {
    const diff = nextCallMs(a) - nextCallMs(b);
    if (diff !== 0) return diff;
    const aAt = leadConversationAt(a);
    const bAt = leadConversationAt(b);
    return new Date(bAt ?? 0).getTime() - new Date(aAt ?? 0).getTime();
  });
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function exportPipelineToExcel(rows: LeadRow[]): void {
  const headers = ["שם", "טלפון", "סטטוס", "שיחה אחרונה", "שיחה הבאה"];
  const lines = [
    headers.join(","),
    ...rows.map((c) =>
      [
        c.full_name?.trim() || "",
        c.phone ?? "",
        pipelineLabel(leadStatus(c)),
        formatDateTime(leadConversationAt(c)),
        c.next_call_at ?? "",
      ]
        .map((v) => escapeCsvCell(v))
        .join(",")
    ),
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leads-pipeline-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function ModalShell({
  title,
  children,
  onClose,
  widthClass = "max-w-md",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  widthClass?: string;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[2147483000]">
      <button type="button" aria-label="סגירה" className="absolute inset-0 bg-black/35" onClick={onClose} />
      <div className="relative mx-auto mt-20 w-[92vw]">
        <div className={`mx-auto ${widthClass} overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl`}>
          <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
            <p className="text-sm font-semibold text-zinc-900 text-right">{title}</p>
            <button
              type="button"
              className="rounded-full px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100"
              onClick={onClose}
            >
              סגור
            </button>
          </div>
          <div className="p-5" dir="rtl">
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function AdminLeadsPipelineClient({ initialContacts }: { initialContacts: LeadRow[] }) {
  const router = useRouter();
  const todayInput = useMemo(() => toDateInputValue(new Date()), []);
  const todayYmd = useMemo(() => israelTodayYmd(), []);
  const [dateFrom, setDateFrom] = useState(() => defaultLast30DaysRange().from);
  const [dateTo, setDateTo] = useState(() => defaultLast30DaysRange().to);
  const [leads, setLeads] = useState(initialContacts);
  const [toast, setToast] = useState<string | null>(null);
  const [busyPhone, setBusyPhone] = useState<string | null>(null);
  const [answersContact, setAnswersContact] = useState<LeadRow | null>(null);
  const [singleOpen, setSingleOpen] = useState(false);
  const [singleContact, setSingleContact] = useState<LeadRow | null>(null);
  const [singleMsg, setSingleMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [humanModal, setHumanModal] = useState<{ contact: LeadRow; nextCallAt: string } | null>(null);

  useEffect(() => {
    setLeads(initialContacts);
  }, [initialContacts]);

  function showToast(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(null), 2600);
  }

  const filteredLeads = useMemo(() => {
    return leads.filter((c) => {
      if (c.human_followup_at) return true;
      return matchesConversationDateRange(leadConversationAt(c), dateFrom, dateTo);
    });
  }, [leads, dateFrom, dateTo]);

  const grouped = useMemo(() => {
    const map = new Map<PipelineStatus, LeadRow[]>();
    for (const status of MARKETING_PIPELINE_STATUS_ORDER) map.set(status, []);
    for (const c of filteredLeads) {
      const status = leadStatus(c);
      const list = map.get(status) ?? [];
      list.push(c);
      map.set(status, list);
    }
    for (const [status, list] of map) {
      map.set(status, sortColumnLeads(status, list));
    }
    return map;
  }, [filteredLeads]);

  const visibleColumns = useMemo(() => {
    return MARKETING_PIPELINE_STATUS_ORDER.filter((status) => {
      if (ALWAYS_VISIBLE.includes(status)) return true;
      return (grouped.get(status) ?? []).length > 0;
    });
  }, [grouped]);

  const overdueHuman = useMemo(() => {
    return (grouped.get("human_followup") ?? []).filter((c) => {
      const d = String(c.next_call_at ?? "").trim();
      return d && d < todayYmd;
    }).length;
  }, [grouped, todayYmd]);

  async function savePipeline(phone: string, humanFollowup: boolean, nextCallAt: string | null) {
    setBusyPhone(phone);
    try {
      const res = await fetch("/api/admin/marketing/lead-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          human_followup: humanFollowup,
          next_call_at: nextCallAt,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        human_followup_at?: string | null;
        next_call_at?: string | null;
      };
      if (!res.ok) {
        if (j.error === "migration_required") {
          showToast("חסרה עמודת DB — הריצו supabase/marketing_flow_sessions_human_followup.sql");
          return;
        }
        if (j.error === "lead_not_found") {
          showToast("לא נמצא ליד עם המספר הזה");
          return;
        }
        showToast("עדכון נכשל. נסו שוב.");
        return;
      }
      setLeads((prev) =>
        prev.map((row) =>
          row.phone === phone
            ? {
                ...row,
                human_followup_at: j.human_followup_at ?? (humanFollowup ? new Date().toISOString() : null),
                next_call_at: humanFollowup ? (j.next_call_at ?? nextCallAt) : null,
              }
            : row
        )
      );
      showToast(humanFollowup ? "הועבר לפולואפ אנושי" : "הוסר מפולואפ אנושי");
    } catch (e) {
      console.error("[admin/leads] pipeline update failed:", e);
      showToast("עדכון נכשל. נסו שוב.");
    } finally {
      setBusyPhone(null);
    }
  }

  function openHumanModal(c: LeadRow) {
    if (!c.phone) return;
    setHumanModal({
      contact: c,
      nextCallAt: c.next_call_at || tomorrowYmd(),
    });
  }

  function viewConversations(phone: string) {
    const sp = new URLSearchParams({
      tab: "conversations",
      conv_slug: MARKETING_CONVERSATIONS_SLUG,
      phone,
    });
    router.push(`/admin/zoe?${sp.toString()}`);
  }

  const sendMarketingManual = useCallback(async (phone: string, message: string) => {
    const res = await fetch("/api/admin/marketing/manual-send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: marketingWaSessionId(phone),
        text: message,
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(j?.error || "send_failed");
  }, []);

  async function onSendSingle() {
    const c = singleContact;
    if (!c?.phone) return;
    const text = singleMsg.trim();
    if (!text) return;
    setSending(true);
    try {
      await sendMarketingManual(c.phone, text);
      showToast("נשלח בהצלחה ✅");
      setSingleOpen(false);
    } catch (e) {
      console.error(e);
      showToast("שליחה נכשלה. בדקו מספר ונסו שוב.");
    } finally {
      setSending(false);
    }
  }

  function handleDateFromChange(value: string) {
    setDateFrom(value);
    if (value && dateTo && value > dateTo) setDateTo(value);
  }

  function handleDateToChange(value: string) {
    if (value && dateFrom && value < dateFrom) {
      setDateTo(dateFrom);
      return;
    }
    setDateTo(value);
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="text-right">
          <p className="text-sm text-zinc-600">
            {filteredLeads.length} לידים בפייפליין
            {overdueHuman > 0 ? (
              <span className="mr-2 font-medium text-red-700">· {overdueHuman} שיחות באיחור</span>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-zinc-500">לידים בפולואפ אנושי מוצגים תמיד, גם מחוץ לטווח התאריכים</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-right">
            <span className="text-xs text-zinc-500">מתאריך שיחה</span>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || todayInput}
              onChange={(e) => handleDateFromChange(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-right">
            <span className="text-xs text-zinc-500">עד תאריך שיחה</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              max={todayInput}
              onChange={(e) => handleDateToChange(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
            />
          </label>
          <Button type="button" variant="outline" onClick={() => exportPipelineToExcel(filteredLeads)}>
            ייצוא ל-Excel
          </Button>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-3 [scrollbar-width:thin]">
        {visibleColumns.map((status) => {
          const columnLeads = grouped.get(status) ?? [];
          return (
            <section
              key={status}
              className="flex w-[min(100%,280px)] shrink-0 flex-col rounded-2xl border border-zinc-200 bg-white/90 shadow-[0_10px_24px_rgba(117,90,180,0.08)]"
            >
              <header className={`rounded-t-2xl border-b px-3 py-3 ${pipelineHeaderClass(status)}`}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">{pipelineLabel(status)}</h2>
                  <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-semibold">{columnLeads.length}</span>
                </div>
                {status === "human_followup" ? (
                  <p className="mt-1 text-[11px] opacity-80">תאריך לשיחה הבאה · ממוין לפי הדחוף ביותר</p>
                ) : null}
              </header>
              <div className="max-h-[min(70vh,720px)] space-y-2 overflow-y-auto p-2">
                {columnLeads.length === 0 ? (
                  <p className="px-2 py-8 text-center text-xs text-zinc-400">אין לידים</p>
                ) : (
                  columnLeads.map((c) => {
                    const overdue = Boolean(c.next_call_at && c.next_call_at < todayYmd);
                    const busy = busyPhone === c.phone;
                    return (
                      <article
                        key={c.phone ?? c.created_at}
                        className={`rounded-xl border bg-white p-3 text-right shadow-sm ${
                          overdue ? "border-red-300 bg-red-50/40" : "border-zinc-200"
                        }`}
                      >
                        <p className="text-sm font-semibold text-zinc-900">{c.full_name?.trim() || "ליד"}</p>
                        <button
                          type="button"
                          className="mt-0.5 text-xs text-[#7133da] underline underline-offset-2"
                          onClick={() => (c.phone ? viewConversations(c.phone) : null)}
                          disabled={!c.phone}
                        >
                          {c.phone ?? "—"}
                        </button>
                        <p className="mt-1 text-[11px] text-zinc-500">שיחה אחרונה: {formatDateTime(leadConversationAt(c))}</p>

                        {status === "human_followup" ? (
                          <label className="mt-2 flex flex-col gap-1">
                            <span className={`text-[11px] ${overdue ? "font-semibold text-red-700" : "text-zinc-500"}`}>
                              {overdue ? "שיחה באיחור" : "שיחה הבאה"}
                            </span>
                            <input
                              type="date"
                              value={c.next_call_at ?? ""}
                              disabled={busy || !c.phone}
                              onChange={(e) => {
                                if (!c.phone) return;
                                void savePipeline(c.phone, true, e.target.value || null);
                              }}
                              className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs"
                            />
                          </label>
                        ) : null}

                        <div className="mt-2 flex flex-wrap justify-end gap-1">
                          <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setAnswersContact(c)} disabled={!c.phone}>
                            תשובות
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-8 px-2 text-xs"
                            onClick={() => (c.phone ? viewConversations(c.phone) : null)}
                            disabled={!c.phone}
                          >
                            שיחה
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-8 px-2 text-xs"
                            onClick={() => {
                              setSingleContact(c);
                              setSingleMsg("");
                              setSingleOpen(true);
                            }}
                            disabled={!c.phone || Boolean(c.opted_out)}
                          >
                            הודעה
                          </Button>
                        </div>
                        {status === "human_followup" ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="mt-2 h-8 w-full text-xs"
                            disabled={busy || !c.phone}
                            onClick={() => c.phone && void savePipeline(c.phone, false, null)}
                          >
                            {busy ? "מעדכן…" : "הסר מפולואפ אנושי"}
                          </Button>
                        ) : c.opted_out || c.trial_registered ? null : (
                          <Button
                            type="button"
                            variant="outline"
                            className="mt-2 h-8 w-full text-xs"
                            disabled={busy || !c.phone}
                            onClick={() => openHumanModal(c)}
                          >
                            פולואפ אנושי
                          </Button>
                        )}
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>

      {answersContact?.phone ? (
        <MarketingLeadAnswersModal
          phone={answersContact.phone}
          fullName={answersContact.full_name}
          onClose={() => setAnswersContact(null)}
        />
      ) : null}

      {humanModal ? (
        <ModalShell title="פולואפ אנושי" onClose={() => setHumanModal(null)}>
          <div className="space-y-4">
            <p className="text-sm text-zinc-700 text-right leading-relaxed">
              להעביר את{" "}
              <span className="font-medium text-zinc-900">
                {humanModal.contact.full_name?.trim() || humanModal.contact.phone}
              </span>{" "}
              לפולואפ אנושי? זואי תפסיק פולואפים אוטומטיים לליד הזה.
            </p>
            <label className="flex flex-col gap-1 text-right">
              <span className="text-xs text-zinc-500">תאריך לשיחה הבאה (אופציונלי)</span>
              <input
                type="date"
                value={humanModal.nextCallAt}
                onChange={(e) => setHumanModal({ ...humanModal, nextCallAt: e.target.value })}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setHumanModal(null)}>
                ביטול
              </Button>
              <Button
                type="button"
                disabled={!humanModal.contact.phone || busyPhone === humanModal.contact.phone}
                onClick={async () => {
                  const phone = humanModal.contact.phone;
                  if (!phone) return;
                  await savePipeline(phone, true, humanModal.nextCallAt || null);
                  setHumanModal(null);
                }}
              >
                {busyPhone === humanModal.contact.phone ? "מעדכן…" : "אישור"}
              </Button>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {singleOpen && singleContact ? (
        <ModalShell title="שליחת הודעה" onClose={() => setSingleOpen(false)}>
          <div className="space-y-3">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
              <p className="text-sm font-medium text-zinc-900 text-right">{singleContact.full_name?.trim() || "ליד"}</p>
              <p className="text-sm text-zinc-600 text-right">{singleContact.phone ?? "—"}</p>
            </div>
            <textarea
              dir="rtl"
              className="w-full rounded-xl border border-zinc-300 bg-white p-3 text-sm text-right placeholder:text-right focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
              rows={4}
              value={singleMsg}
              placeholder="כתוב את ההודעה שלך כאן..."
              onChange={(e) => setSingleMsg(e.target.value)}
            />
            <p className="text-xs text-zinc-500 text-right">ההודעה תכלול אוטומטית אפשרות הסרה בסוף</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setSingleOpen(false)} disabled={sending}>
                ביטול
              </Button>
              <Button type="button" onClick={() => void onSendSingle()} disabled={sending || !singleMsg.trim()}>
                {sending ? "שולח..." : "שלח"}
              </Button>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {toast ? (
        <div className="fixed bottom-4 right-4 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
