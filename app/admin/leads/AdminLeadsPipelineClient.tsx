"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  computeContactStatus,
  CONTACT_STATUS_META,
  MARKETING_PIPELINE_STATUS_ORDER,
  type ContactStatusKey,
} from "@/lib/contact-status";
import { leadConversationAt } from "@/lib/lead-activity";
import type { LeadRow } from "@/lib/leads-types";
import {
  applyManualPipelineStatus,
  isMarketingPipelineDropStatus,
  isMarketingPipelineDropTarget,
  type MarketingPipelineDropStatus,
} from "@/lib/marketing-pipeline-status";
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
  if (isMarketingPipelineDropStatus(c.pipeline_status)) return c.pipeline_status;
  return computeContactStatus(c) ?? "none";
}

const COLUMN_ORDER_KEY = "heyzoe.admin.leads.columnOrder";
const LEAD_DRAG_MIME = "application/x-heyzoe-lead";
const COLUMN_DRAG_MIME = "application/x-heyzoe-column";

function sanitizeColumnOrder(raw: unknown): PipelineStatus[] {
  const allowed = new Set<string>(MARKETING_PIPELINE_STATUS_ORDER);
  const seen = new Set<string>();
  const order: PipelineStatus[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== "string" || !allowed.has(item) || seen.has(item)) continue;
      order.push(item as PipelineStatus);
      seen.add(item);
    }
  }
  for (const status of MARKETING_PIPELINE_STATUS_ORDER) {
    if (!seen.has(status)) order.push(status);
  }
  return order;
}

function loadColumnOrder(): PipelineStatus[] {
  if (typeof window === "undefined") return [...MARKETING_PIPELINE_STATUS_ORDER];
  try {
    return sanitizeColumnOrder(JSON.parse(localStorage.getItem(COLUMN_ORDER_KEY) || "null"));
  } catch {
    return [...MARKETING_PIPELINE_STATUS_ORDER];
  }
}

function pipelineLabel(status: PipelineStatus): string {
  if (status === "none") return "ללא סטטוס";
  return CONTACT_STATUS_META[status].label;
}

function pipelineHeaderClass(status: PipelineStatus): string {
  if (status === "none") return "border-zinc-200 bg-zinc-50 text-zinc-600";
  return CONTACT_STATUS_META[status].badgeClass;
}

const ALWAYS_VISIBLE: PipelineStatus[] = [...MARKETING_PIPELINE_STATUS_ORDER];

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
  const [draggingPhone, setDraggingPhone] = useState<string | null>(null);
  const [draggingColumn, setDraggingColumn] = useState<PipelineStatus | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<PipelineStatus | null>(null);
  const [columnOrder, setColumnOrder] = useState<PipelineStatus[]>(() => [...MARKETING_PIPELINE_STATUS_ORDER]);
  const draggingPhoneRef = useRef<string | null>(null);
  const draggingColumnRef = useRef<PipelineStatus | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLeads(initialContacts);
  }, [initialContacts]);

  useEffect(() => {
    setColumnOrder(loadColumnOrder());
  }, []);

  useEffect(() => {
    if (!draggingPhone && !draggingColumn) return;
    const board = boardRef.current;
    if (!board) return;
    const onMove = (e: DragEvent) => {
      const rect = board.getBoundingClientRect();
      const edge = 56;
      if (e.clientX < rect.left + edge) board.scrollLeft -= 22;
      else if (e.clientX > rect.right - edge) board.scrollLeft += 22;
    };
    window.addEventListener("dragover", onMove);
    return () => window.removeEventListener("dragover", onMove);
  }, [draggingPhone, draggingColumn]);

  function persistColumnOrder(next: PipelineStatus[]) {
    setColumnOrder(next);
    try {
      localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
  }

  function reorderColumns(from: PipelineStatus, to: PipelineStatus) {
    if (from === to) return;
    const next = [...columnOrder];
    const fromIdx = next.indexOf(from);
    const toIdx = next.indexOf(to);
    if (fromIdx < 0 || toIdx < 0) return;
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, from);
    persistColumnOrder(next);
  }

  function showToast(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(null), 2600);
  }

  const filteredLeads = useMemo(() => {
    return leads.filter((c) => {
      const status = leadStatus(c);
      if (status === "human_followup" || isMarketingPipelineDropStatus(c.pipeline_status)) return true;
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
    return columnOrder.filter((status) => {
      if (ALWAYS_VISIBLE.includes(status)) return true;
      return (grouped.get(status) ?? []).length > 0;
    });
  }, [grouped, columnOrder]);

  const overdueHuman = useMemo(() => {
    return (grouped.get("human_followup") ?? []).filter((c) => {
      const d = String(c.next_call_at ?? "").trim();
      return d && d < todayYmd;
    }).length;
  }, [grouped, todayYmd]);

  async function savePipeline(
    phone: string,
    patch: { human_followup?: boolean; status?: MarketingPipelineDropStatus; next_call_at?: string | null }
  ): Promise<boolean> {
    setBusyPhone(phone);
    try {
      const res = await fetch("/api/admin/marketing/lead-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          human_followup: patch.human_followup,
          status: patch.status,
          next_call_at: patch.next_call_at,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        human_followup_at?: string | null;
        next_call_at?: string | null;
        pipeline_status?: string | null;
        lead_patch?: Partial<LeadRow>;
      };
      if (!res.ok) {
        if (j.error === "migration_required") {
          showToast("חסרה עמודת DB — הריצו supabase/marketing_flow_sessions_pipeline_status.sql");
          return false;
        }
        if (j.error === "lead_not_found") {
          showToast("לא נמצא ליד עם המספר הזה");
          return false;
        }
        showToast("עדכון נכשל. נסו שוב.");
        return false;
      }
      setLeads((prev) =>
        prev.map((row) => {
          if (row.phone !== phone) return row;
          const withPatch = { ...row, ...(j.lead_patch ?? {}) };
          if (patch.status) {
            const applied = applyManualPipelineStatus(withPatch, patch.status, new Date().toISOString());
            return {
              ...applied,
              human_followup_at: j.human_followup_at ?? applied.human_followup_at,
              next_call_at:
                patch.status === "human_followup"
                  ? (j.next_call_at ?? patch.next_call_at ?? applied.next_call_at)
                  : null,
              pipeline_status: patch.status,
            };
          }
          return {
            ...row,
            human_followup_at: j.human_followup_at ?? (patch.human_followup ? new Date().toISOString() : null),
            next_call_at: patch.human_followup ? (j.next_call_at ?? patch.next_call_at ?? null) : null,
            pipeline_status: patch.human_followup ? "human_followup" : null,
          };
        })
      );
      if (patch.status) {
        showToast(`הועבר ל«${pipelineLabel(patch.status)}»`);
      } else {
        showToast(patch.human_followup ? "הועבר לפולואפ אנושי" : "הוסר מפולואפ אנושי");
      }
      return true;
    } catch (e) {
      console.error("[admin/leads] pipeline update failed:", e);
      showToast("עדכון נכשל. נסו שוב.");
      return false;
    } finally {
      setBusyPhone(null);
    }
  }

  async function moveLeadToStatus(phone: string, status: MarketingPipelineDropStatus, current: LeadRow) {
    if (leadStatus(current) === status) return;
    const snapshot = leads;
    const nextCallAt = status === "human_followup" ? current.next_call_at || tomorrowYmd() : null;
    setLeads((prev) =>
      prev.map((row) => {
        if (row.phone !== phone) return row;
        const applied = applyManualPipelineStatus(row, status, new Date().toISOString());
        return {
          ...applied,
          next_call_at: status === "human_followup" ? nextCallAt : null,
          pipeline_status: status,
        };
      })
    );
    const ok = await savePipeline(phone, { status, next_call_at: nextCallAt });
    if (!ok) setLeads(snapshot);
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
          <p className="mt-1 text-xs text-zinc-500">
            גררו כרטיס ליד לכל עמודה כדי לעדכן סטטוס (בלי לשלוח הודעה). גררו כותרת עמודה כדי לשנות את סדר הדשבורד.
          </p>
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

      <div ref={boardRef} className="flex gap-3 overflow-x-auto pb-3 [scrollbar-width:thin]">
        {visibleColumns.map((status) => {
          const columnLeads = grouped.get(status) ?? [];
          const droppable = isMarketingPipelineDropTarget(status);
          const isOver = droppable && dragOverStatus === status;
          return (
            <section
              key={status}
              onDragOver={(e) => {
                if (!droppable) return;
                const types = Array.from(e.dataTransfer.types);
                const isLead = Boolean(draggingPhoneRef.current) || types.includes(LEAD_DRAG_MIME);
                const isCol = Boolean(draggingColumnRef.current) || types.includes(COLUMN_DRAG_MIME);
                const hasText = types.includes("text/plain") || types.includes("Text");
                if (!isLead && !isCol && !hasText) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragOverStatus !== status) setDragOverStatus(status);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                if (dragOverStatus === status) setDragOverStatus(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverStatus(null);
                const rawColumn = e.dataTransfer.getData(COLUMN_DRAG_MIME) || draggingColumnRef.current || "";
                const columnFromText = e.dataTransfer.getData("text/plain").trim();
                const droppedColumn = (
                  rawColumn || (columnFromText.startsWith("column:") ? columnFromText.slice("column:".length) : "")
                ) as PipelineStatus;
                const phone =
                  e.dataTransfer.getData(LEAD_DRAG_MIME).trim() ||
                  (columnFromText.startsWith("column:") ? "" : columnFromText) ||
                  draggingPhoneRef.current;
                draggingPhoneRef.current = null;
                draggingColumnRef.current = null;
                setDraggingPhone(null);
                setDraggingColumn(null);
                if (droppedColumn && MARKETING_PIPELINE_STATUS_ORDER.includes(droppedColumn)) {
                  reorderColumns(droppedColumn, status);
                  return;
                }
                if (!phone || !isMarketingPipelineDropTarget(status)) return;
                const current = leads.find((row) => row.phone === phone);
                if (!current) return;
                void moveLeadToStatus(phone, status, current);
              }}
              className={`flex w-[min(100%,280px)] shrink-0 flex-col rounded-2xl border bg-white/90 shadow-[0_10px_24px_rgba(117,90,180,0.08)] ${
                isOver ? "border-[#7133da] ring-2 ring-[#7133da]/30" : "border-zinc-200"
              } ${draggingColumn === status ? "opacity-60" : ""}`}
            >
              <header
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  e.dataTransfer.setData(COLUMN_DRAG_MIME, status);
                  e.dataTransfer.setData("text/plain", `column:${status}`);
                  e.dataTransfer.effectAllowed = "move";
                  draggingColumnRef.current = status;
                  requestAnimationFrame(() => setDraggingColumn(status));
                }}
                onDragEnd={() => {
                  draggingColumnRef.current = null;
                  setDraggingColumn(null);
                  setDragOverStatus(null);
                }}
                className={`cursor-grab rounded-t-2xl border-b px-3 py-3 active:cursor-grabbing ${pipelineHeaderClass(status)}`}
                title="גררו כדי לשנות סדר עמודות"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">{pipelineLabel(status)}</h2>
                  <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-semibold">{columnLeads.length}</span>
                </div>
                {status === "human_followup" ? (
                  <p className="mt-1 text-[11px] opacity-80">תאריך לשיחה הבאה · ממוין לפי הדחוף ביותר</p>
                ) : (
                  <p className="mt-1 text-[11px] opacity-80">גררו ליד לכאן</p>
                )}
              </header>
              <div className="max-h-[min(70vh,720px)] min-h-[140px] space-y-2 overflow-y-auto p-2">
                {columnLeads.length === 0 ? (
                  <p className="px-2 py-8 text-center text-xs text-zinc-400">גררו ליד לכאן</p>
                ) : (
                  columnLeads.map((c) => {
                    const overdue = Boolean(c.next_call_at && c.next_call_at < todayYmd);
                    const busy = busyPhone === c.phone;
                    return (
                      <article
                        key={c.phone ?? c.created_at}
                        draggable={Boolean(c.phone) && !busy}
                        onDragStart={(e) => {
                          if (!c.phone) return;
                          e.stopPropagation();
                          const target = e.target as HTMLElement | null;
                          if (target?.closest("button, input, textarea, a, label")) {
                            e.preventDefault();
                            return;
                          }
                          e.dataTransfer.setData(LEAD_DRAG_MIME, c.phone);
                          e.dataTransfer.setData("text/plain", c.phone);
                          e.dataTransfer.effectAllowed = "move";
                          draggingPhoneRef.current = c.phone;
                          requestAnimationFrame(() => setDraggingPhone(c.phone));
                        }}
                        onDragEnd={() => {
                          draggingPhoneRef.current = null;
                          setDraggingPhone(null);
                          setDragOverStatus(null);
                        }}
                        className={`rounded-xl border bg-white p-3 text-right shadow-sm ${
                          overdue ? "border-red-300 bg-red-50/40" : "border-zinc-200"
                        } ${c.phone && !busy ? "cursor-grab active:cursor-grabbing" : ""} ${
                          draggingPhone === c.phone ? "opacity-50" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-zinc-900">{c.full_name?.trim() || "ליד"}</p>
                          {c.phone && !busy ? (
                            <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-zinc-300" aria-hidden />
                          ) : null}
                        </div>
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
                                void savePipeline(c.phone, { human_followup: true, status: "human_followup", next_call_at: e.target.value || null });
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
                            onClick={() => c.phone && void savePipeline(c.phone, { human_followup: false })}
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
                  await savePipeline(phone, {
                    human_followup: true,
                    status: "human_followup",
                    next_call_at: humanModal.nextCallAt || null,
                  });
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
