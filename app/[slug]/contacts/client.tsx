"use client";

import { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  computeContactStatus,
  contactStatusLabel,
  CONTACT_STATUS_META,
  CONTACT_STATUS_FILTER_ORDER,
  type ContactStatusFilterValue,
  type ContactStatusKey,
} from "@/lib/contact-status";
import type { LeadRow } from "@/lib/leads-types";
import { MARKETING_CONVERSATIONS_SLUG, marketingWaSessionId } from "@/lib/marketing-whatsapp";

type Contact = LeadRow;

type Props = {
  /** נדרש במצב עסק; באדמין — slug לכל שורה */
  businessSlug?: string;
  initialContacts: Contact[];
  /** לידים מכל העסקים — עמודת עסק */
  adminMode?: boolean;
  /** לידים מקו זואי אדמין בלבד */
  marketingAdminMode?: boolean;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("he-IL", { year: "numeric", month: "2-digit", day: "2-digit" });
}

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

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 30 הימים האחרונים כולל היום */
function defaultLast30DaysRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return { from: toDateInputValue(from), to: toDateInputValue(to) };
}

function isDefaultDateRange(from: string, to: string): boolean {
  const d = defaultLast30DaysRange();
  return from === d.from && to === d.to;
}

function matchesCreatedAtRange(createdAt: string | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return false;
  const fromIso = from ? startOfDayIso(from) : null;
  const toIso = to ? endOfDayIso(to) : null;
  if (fromIso && t < new Date(fromIso).getTime()) return false;
  if (toIso && t > new Date(toIso).getTime()) return false;
  return true;
}

function contactRowKey(
  c: Contact,
  idx: number,
  multiBusinessAdmin: boolean
): string {
  const phone = String(c.phone ?? "").trim();
  const slug = String(c.business_slug ?? "").trim();
  if (multiBusinessAdmin && slug) return `${slug}::${phone || idx}`;
  return phone || `row-${c.created_at ?? ""}-${idx}`;
}

function slugForContact(
  c: Contact,
  businessSlug: string,
  multiBusinessAdmin: boolean,
  marketingAdminMode: boolean
): string {
  if (marketingAdminMode) return MARKETING_CONVERSATIONS_SLUG;
  if (multiBusinessAdmin) return String(c.business_slug ?? "").trim().toLowerCase();
  return businessSlug.trim().toLowerCase();
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function exportContactsToExcel(rows: Contact[], adminMode: boolean): void {
  const headers = adminMode
    ? ["עסק", "שם", "טלפון", "מקור", "תאריך כניסה", "סטטוס", "תאריך פעילות אחרונה"]
    : ["שם", "טלפון", "מקור", "תאריך כניסה", "סטטוס", "תאריך פעילות אחרונה"];
  const lines = [
    headers.join(","),
    ...rows.map((c) => {
      const statusKey = computeContactStatus(c);
      const cells = adminMode
        ? [
            c.business_name?.trim() || c.business_slug?.trim() || "",
            c.full_name?.trim() || "",
            c.phone ?? "",
            c.source?.trim() || "",
            formatDate(c.created_at),
            contactStatusLabel(statusKey),
            formatDateTime(c.last_contact_at),
          ]
        : [
            c.full_name?.trim() || "",
            c.phone ?? "",
            c.source?.trim() || "",
            formatDate(c.created_at),
            contactStatusLabel(statusKey),
            formatDateTime(c.last_contact_at),
          ];
      return cells.map(escapeCsvCell).join(",");
    }),
  ];
  const bom = "\uFEFF";
  const blob = new Blob([bom + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function ContactStatusBadge({ contact }: { contact: Contact }) {
  const key = computeContactStatus(contact);
  if (!key) return <span className="text-zinc-400">—</span>;
  const meta = CONTACT_STATUS_META[key];
  return (
    <Badge className={meta.badgeClass} title={meta.tooltip}>
      {meta.label}
    </Badge>
  );
}

function Textarea({
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      dir="rtl"
      className="w-full rounded-xl border border-zinc-300 bg-white p-3 text-sm text-right placeholder:text-right focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function ModalShell({
  title,
  children,
  onClose,
  widthClass = "max-w-lg",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  widthClass?: string;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[2147483000]">
      <button
        type="button"
        aria-label="סגירה"
        className="absolute inset-0 bg-black/35"
        onClick={onClose}
      />
      <div className="relative mx-auto mt-20 w-[92vw]">
        <div className={`mx-auto ${widthClass} rounded-2xl bg-white shadow-xl border border-zinc-200 overflow-hidden`}>
          <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
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

export default function ContactsClient({
  businessSlug = "",
  initialContacts,
  adminMode = false,
  marketingAdminMode = false,
}: Props) {
  const router = useRouter();
  const multiBusinessAdmin = adminMode && !marketingAdminMode;
  const showBusinessColumn = multiBusinessAdmin;
  const todayInput = useMemo(() => toDateInputValue(new Date()), []);
  const [dateFrom, setDateFrom] = useState(() => defaultLast30DaysRange().from);
  const [dateTo, setDateTo] = useState(() => defaultLast30DaysRange().to);
  const [statusFilter, setStatusFilter] = useState<ContactStatusFilterValue>("all");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const [singleOpen, setSingleOpen] = useState(false);
  const [singleContact, setSingleContact] = useState<Contact | null>(null);
  const [singleMsg, setSingleMsg] = useState("");

  const filteredContacts = useMemo(() => {
    return initialContacts.filter((c) => {
      if (!matchesCreatedAtRange(c.created_at, dateFrom, dateTo)) return false;
      if (statusFilter === "all") return true;
      const status = computeContactStatus(c);
      if (statusFilter === "none") return status === null;
      return status === statusFilter;
    });
  }, [initialContacts, dateFrom, dateTo, statusFilter]);

  const filteredKeys = useMemo(
    () => new Set(filteredContacts.map((c, i) => contactRowKey(c, i, multiBusinessAdmin))),
    [filteredContacts, multiBusinessAdmin]
  );

  useEffect(() => {
    setSelectedKeys((prev) => {
      const next = new Set([...prev].filter((k) => filteredKeys.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredKeys]);

  const selectedContacts = useMemo(
    () =>
      filteredContacts.filter((c, i) => selectedKeys.has(contactRowKey(c, i, multiBusinessAdmin))),
    [filteredContacts, selectedKeys, multiBusinessAdmin]
  );

  const selectedCount = selectedContacts.length;
  const canExport = selectedCount > 0;
  const allFilteredSelected =
    filteredContacts.length > 0 &&
    filteredContacts.every((c, i) => selectedKeys.has(contactRowKey(c, i, multiBusinessAdmin)));
  const someFilteredSelected = filteredContacts.some((c, i) =>
    selectedKeys.has(contactRowKey(c, i, multiBusinessAdmin))
  );

  function toggleRow(key: string, checked: boolean) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredContacts.forEach((c, i) => next.delete(contactRowKey(c, i, multiBusinessAdmin)));
      } else {
        filteredContacts.forEach((c, i) => next.add(contactRowKey(c, i, multiBusinessAdmin)));
      }
      return next;
    });
  }

  const stats = useMemo(() => {
    const total = filteredContacts.length;
    const byStatus: Record<ContactStatusKey, number> = {
      active: 0,
      followup: 0,
      no_response: 0,
      registered: 0,
      opted_out: 0,
    };
    for (const c of filteredContacts) {
      const key = computeContactStatus(c);
      if (key) byStatus[key] += 1;
    }
    const active = byStatus.active + byStatus.followup + byStatus.no_response;
    return { total, active, byStatus };
  }, [filteredContacts]);

  function showToast(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(null), 2600);
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

  function resetFilters() {
    const { from, to } = defaultLast30DaysRange();
    setDateFrom(from);
    setDateTo(to);
    setStatusFilter("all");
  }

  const hasNonDefaultFilters = statusFilter !== "all" || !isDefaultDateRange(dateFrom, dateTo);

  async function sendViaApi(
    slug: string,
    payload: { mode: "single"; phone: string; message: string }
  ) {
    const res = await fetch("/api/contacts/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_slug: slug,
        ...payload,
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string; sent?: number; failed?: number };
    if (!res.ok) throw new Error(j?.error || "send_failed");
    return { sent: Number(j.sent ?? 0), failed: Number(j.failed ?? 0) };
  }

  async function sendMarketingManual(phone: string, message: string) {
    const res = await fetch("/api/admin/marketing/manual-send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: marketingWaSessionId(phone),
        text: message,
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
    if (!res.ok) throw new Error(j?.error || "send_failed");
    return { sent: 1, failed: 0 };
  }

  function openSingle(c: Contact) {
    setSingleContact(c);
    setSingleMsg("");
    setSingleOpen(true);
  }

  function viewConversations(phone: string, contact: Contact) {
    if (marketingAdminMode) {
      const sp = new URLSearchParams({
        tab: "conversations",
        conv_slug: MARKETING_CONVERSATIONS_SLUG,
        phone,
      });
      router.push(`/admin/zoe?${sp.toString()}`);
      return;
    }
    const slug = slugForContact(contact, businessSlug, multiBusinessAdmin, marketingAdminMode);
    if (!slug) return;
    router.push(`/${encodeURIComponent(slug)}/conversations?phone=${encodeURIComponent(phone)}`);
  }

  async function onSendSingle() {
    const c = singleContact;
    if (!c?.phone) return;
    const text = singleMsg.trim();
    if (!text) return;
    setSending(true);
    try {
      const { sent, failed } = marketingAdminMode
        ? await sendMarketingManual(c.phone, text)
        : await (async () => {
            const slug = slugForContact(c, businessSlug, multiBusinessAdmin, marketingAdminMode);
            if (!slug) {
              showToast("חסר מזהה עסק לשליחה");
              return { sent: 0, failed: 1 };
            }
            return sendViaApi(slug, { mode: "single", phone: c.phone!, message: text });
          })();
      if (sent === 0 && failed === 1 && !marketingAdminMode) {
        setSending(false);
        return;
      }
      if (sent === 1 && failed === 0) showToast("נשלח בהצלחה ✅");
      else showToast(`נשלח: ${sent}, נכשלו: ${failed}`);
      setSingleOpen(false);
    } catch (e) {
      console.error(e);
      showToast("שליחה נכשלה. בדקו מספר ונסו שוב.");
    } finally {
      setSending(false);
    }
  }

  function onExportExcel() {
    if (!canExport) return;
    exportContactsToExcel(selectedContacts, showBusinessColumn);
  }

  const emptyListMsg = "אין לידים בטווח שנבחר.";
  const embeddedAdmin = adminMode || marketingAdminMode;

  return (
    <div className="space-y-6" dir="rtl">
      <div className={embeddedAdmin ? undefined : "hz-wave hz-wave-1"}>
        <h1 className="text-2xl font-semibold text-zinc-900 text-right">לידים</h1>
        <p className="text-sm text-zinc-600 text-right">
          סה״כ {stats.total} לידים ({stats.active} בתהליך מכירה)
        </p>
      </div>

      <Card className={embeddedAdmin ? undefined : "hz-wave hz-wave-2"}>
        <CardHeader className="space-y-4">
          <CardTitle className="text-right">רשימת לידים</CardTitle>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-right">
                <span className="text-xs text-zinc-500">מתאריך כניסה</span>
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo || todayInput}
                  onChange={(e) => handleDateFromChange(e.target.value)}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-right">
                <span className="text-xs text-zinc-500">עד תאריך כניסה</span>
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  max={todayInput}
                  onChange={(e) => handleDateToChange(e.target.value)}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-right">
                <span className="text-xs text-zinc-500">סטטוס</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as ContactStatusFilterValue)}
                  className="min-w-[9rem] rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-right"
                >
                  <option value="all">הכל</option>
                  {CONTACT_STATUS_FILTER_ORDER.map((key) => (
                    <option key={key} value={key}>
                      {CONTACT_STATUS_META[key].label}
                    </option>
                  ))}
                  <option value="none">ללא סטטוס</option>
                </select>
              </label>
              {hasNonDefaultFilters && (
                <Button type="button" variant="outline" className="mb-0.5" onClick={resetFilters}>
                  נקה פילטרים
                </Button>
              )}
            </div>
            <Button type="button" variant="outline" onClick={onExportExcel} disabled={!canExport}>
              ייצוא ל-Excel{canExport ? ` (${selectedCount})` : ""}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 md:hidden">
            {filteredContacts.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500">{emptyListMsg}</p>
            ) : (
              filteredContacts.map((c, idx) => {
                const optedOut = Boolean(c.opted_out);
                const rowKey = contactRowKey(c, idx, multiBusinessAdmin);
                const checked = selectedKeys.has(rowKey);
                return (
                  <div
                    key={rowKey}
                    className="rounded-2xl border border-zinc-200 bg-white p-4 text-right"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <label className="flex shrink-0 cursor-pointer items-center pt-0.5">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-zinc-300 text-fuchsia-600 focus:ring-fuchsia-400"
                          checked={checked}
                          onChange={(e) => toggleRow(rowKey, e.target.checked)}
                          aria-label="בחירה לייצוא"
                        />
                      </label>
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          className="text-sm font-semibold text-zinc-900 underline underline-offset-4 decoration-zinc-300 hover:decoration-zinc-500 truncate max-w-[78vw]"
                          onClick={() => (c.phone ? viewConversations(c.phone, c) : null)}
                          disabled={!c.phone || (multiBusinessAdmin && !c.business_slug)}
                        >
                          {c.phone ?? "—"}
                        </button>
                        <p className="mt-1 text-xs text-zinc-600">
                          {showBusinessColumn && (c.business_name || c.business_slug) ? (
                            <span className="block text-[#7133da]">{c.business_name || c.business_slug}</span>
                          ) : null}
                          {c.full_name?.trim() || "—"} · {c.source?.trim() || "—"}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">הצטרף: {formatDate(c.created_at)}</p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          פעילות אחרונה: {formatDateTime(c.last_contact_at)}
                        </p>
                      </div>
                      <div className="shrink-0">
                        <ContactStatusBadge contact={c} />
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => (c.phone ? viewConversations(c.phone, c) : null)}
                        disabled={!c.phone || (multiBusinessAdmin && !c.business_slug)}
                      >
                        צפה בשיחות
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => openSingle(c)}
                        disabled={
                          sending || optedOut || !c.phone || (multiBusinessAdmin && !c.business_slug)
                        }
                      >
                        שלח הודעה
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm" dir="rtl">
              <thead>
                <tr className="text-right text-xs text-zinc-500 border-b border-zinc-200">
                  <th className="py-3 px-2 w-10 font-medium">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-zinc-300 text-fuchsia-600 focus:ring-fuchsia-400"
                      checked={allFilteredSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected;
                      }}
                      onChange={toggleSelectAllFiltered}
                      aria-label="בחר הכל"
                    />
                  </th>
                  {showBusinessColumn ? <th className="py-3 px-2 font-medium">עסק</th> : null}
                  <th className="py-3 px-2 font-medium">טלפון</th>
                  <th className="py-3 px-2 font-medium">שם</th>
                  <th className="py-3 px-2 font-medium">מקור</th>
                  <th className="py-3 px-2 font-medium">תאריך הצטרפות</th>
                  <th className="py-3 px-2 font-medium">סטטוס</th>
                  <th className="py-3 px-2 font-medium">פעולות</th>
                </tr>
              </thead>
              <tbody>
                {filteredContacts.length === 0 ? (
                  <tr>
                    <td colSpan={showBusinessColumn ? 8 : 7} className="py-8 text-center text-zinc-500">
                      {emptyListMsg}
                    </td>
                  </tr>
                ) : (
                  filteredContacts.map((c, idx) => {
                    const optedOut = Boolean(c.opted_out);
                    const rowKey = contactRowKey(c, idx, multiBusinessAdmin);
                    const checked = selectedKeys.has(rowKey);
                    return (
                      <tr key={rowKey} className="border-b border-zinc-100 text-right">
                        <td className="py-3 px-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-zinc-300 text-fuchsia-600 focus:ring-fuchsia-400"
                            checked={checked}
                            onChange={(e) => toggleRow(rowKey, e.target.checked)}
                            aria-label="בחירה לייצוא"
                          />
                        </td>
                        {showBusinessColumn ? (
                          <td className="py-3 px-2 text-zinc-700">
                            {c.business_name?.trim() || c.business_slug?.trim() || "—"}
                          </td>
                        ) : null}
                        <td className="py-3 px-2 whitespace-nowrap">{c.phone ?? "—"}</td>
                        <td className="py-3 px-2">{c.full_name?.trim() || "—"}</td>
                        <td className="py-3 px-2">{c.source?.trim() || "—"}</td>
                        <td className="py-3 px-2 whitespace-nowrap">{formatDate(c.created_at)}</td>
                        <td className="py-3 px-2">
                          <ContactStatusBadge contact={c} />
                        </td>
                        <td className="py-3 px-2">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => (c.phone ? viewConversations(c.phone, c) : null)}
                              disabled={!c.phone || (multiBusinessAdmin && !c.business_slug)}
                            >
                              צפה בשיחות
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => openSingle(c)}
                              disabled={
                                sending ||
                                optedOut ||
                                !c.phone ||
                                (multiBusinessAdmin && !c.business_slug)
                              }
                            >
                              שלח הודעה
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {singleOpen && singleContact ? (
        <ModalShell title="שליחת הודעה" onClose={() => setSingleOpen(false)} widthClass="max-w-md">
          <div className="space-y-3">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
              <p className="text-sm font-medium text-zinc-900 text-right">
                {singleContact.full_name?.trim() || "ליד"}
              </p>
              <p className="text-sm text-zinc-600 text-right">{singleContact.phone ?? "—"}</p>
            </div>
            <Textarea value={singleMsg} onChange={setSingleMsg} placeholder="כתוב את ההודעה שלך כאן..." rows={4} />
            <p className="text-xs text-zinc-500 text-right">ההודעה תכלול אוטומטית אפשרות הסרה בסוף</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setSingleOpen(false)} disabled={sending}>
                ביטול
              </Button>
              <Button type="button" onClick={onSendSingle} disabled={sending || !singleMsg.trim()}>
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
