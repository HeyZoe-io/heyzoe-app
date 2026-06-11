"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  computeContactStatus,
  contactStatusLabel,
  CONTACT_STATUS_META,
  CONTACT_STATUS_FILTER_ORDER,
  MANUAL_CONTACT_STATUSES,
  canManuallySetContactStatus,
  type ContactStatusFilterValue,
  type ContactStatusKey,
} from "@/lib/contact-status";
import { leadConversationAt } from "@/lib/lead-activity";
import { normalizePhone } from "@/lib/phone-normalize";
import type { LeadRow } from "@/lib/leads-types";
import { MARKETING_CONVERSATIONS_SLUG, marketingWaSessionId } from "@/lib/marketing-whatsapp";
import MarketingLeadAnswersModal from "@/app/admin/leads/MarketingLeadAnswersModal";

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

function resolveInitialStatusFilter(raw: string | null): ContactStatusFilterValue {
  const value = String(raw ?? "").trim();
  if (value === "all" || value === "none") return value;
  if (CONTACT_STATUS_FILTER_ORDER.includes(value as ContactStatusKey)) return value as ContactStatusKey;
  return "all";
}

function contactsSharePhone(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const ka = normalizePhone(a) ?? String(a ?? "").replace(/\D/g, "");
  const kb = normalizePhone(b) ?? String(b ?? "").replace(/\D/g, "");
  return Boolean(ka && kb && ka === kb);
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
    ? ["עסק", "שם", "טלפון", "מקור", "שיחה אחרונה", "סטטוס"]
    : ["שם", "טלפון", "מקור", "שיחה אחרונה", "סטטוס"];
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
            formatDateTime(leadConversationAt(c)),
            contactStatusLabel(statusKey),
          ]
        : [
            c.full_name?.trim() || "",
            c.phone ?? "",
            c.source?.trim() || "",
            formatDateTime(leadConversationAt(c)),
            contactStatusLabel(statusKey),
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

function isContactStatusEditable(
  contact: Contact,
  multiBusinessAdmin: boolean,
  marketingAdminMode: boolean
): boolean {
  if (marketingAdminMode) return false;
  if (!contact.phone?.trim()) return false;
  if (multiBusinessAdmin && !contact.business_slug?.trim()) return false;
  if (contact.opted_out || contact.not_relevant_at) return false;
  return MANUAL_CONTACT_STATUSES.some((s) => canManuallySetContactStatus(s, contact));
}

function ContactStatusMenu({
  contact,
  rowKey,
  editable,
  busy,
  open,
  onOpen,
  onClose,
  onPickStatus,
}: {
  contact: Contact;
  rowKey: string;
  editable: boolean;
  busy: boolean;
  open: boolean;
  onOpen: (rowKey: string) => void;
  onClose: () => void;
  onPickStatus: (contact: Contact, rowKey: string, status: ContactStatusKey) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const currentKey = computeContactStatus(contact);

  useEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);

    let removeOutsideClick: (() => void) | undefined;
    const outsideTimer = window.setTimeout(() => {
      function onClickOutside(e: MouseEvent) {
        const t = e.target as Node;
        if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
        onClose();
      }
      document.addEventListener("click", onClickOutside);
      removeOutsideClick = () => document.removeEventListener("click", onClickOutside);
    }, 0);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(outsideTimer);
      removeOutsideClick?.();
    };
  }, [open, onClose]);

  function openMenu() {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }
    onOpen(rowKey);
  }

  const badgeLabel = currentKey ? CONTACT_STATUS_META[currentKey].label : "ללא סטטוס";
  const badgeClass = currentKey ? CONTACT_STATUS_META[currentKey].badgeClass : "border-zinc-200 bg-zinc-50 text-zinc-600";

  if (!editable) {
    if (!currentKey) return <span className="text-zinc-400">—</span>;
    const meta = CONTACT_STATUS_META[currentKey];
    return (
      <Badge className={meta.badgeClass} title={meta.tooltip}>
        {meta.label}
      </Badge>
    );
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="inline-flex items-center gap-1 rounded-full focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`סטטוס: ${badgeLabel}. לחצו לשינוי`}
        disabled={busy}
        onClick={() => (open ? onClose() : openMenu())}
      >
        <Badge className={`${badgeClass} cursor-pointer hover:opacity-90`}>
          {busy ? "מעדכן…" : badgeLabel}
        </Badge>
        <span className="text-[10px] text-zinc-400" aria-hidden>
          ▾
        </span>
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              aria-label="שינוי סטטוס ליד"
              className="fixed z-[2147483001] min-w-[11rem] rounded-xl border border-zinc-200 bg-white py-1 shadow-lg"
              style={{
                top: menuPos?.top ?? 0,
                right: menuPos?.right ?? 0,
                visibility: menuPos ? "visible" : "hidden",
              }}
              dir="rtl"
              onMouseDown={(e) => e.stopPropagation()}
            >
              {CONTACT_STATUS_FILTER_ORDER.map((statusKey) => {
                const meta = CONTACT_STATUS_META[statusKey];
                const isCurrent = currentKey === statusKey;
                const canPick = canManuallySetContactStatus(statusKey, contact);
                return (
                  <button
                    key={statusKey}
                    type="button"
                    role="option"
                    aria-selected={isCurrent}
                    aria-disabled={!canPick || isCurrent}
                    title={canPick ? meta.tooltip : "סטטוס זה נקבע אוטומטית על ידי זואי"}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-right text-sm ${
                      canPick && !isCurrent
                        ? "text-zinc-800 hover:bg-fuchsia-50 cursor-pointer"
                        : "text-zinc-400 cursor-default"
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!canPick || isCurrent) return;
                      onPickStatus(contact, rowKey, statusKey);
                    }}
                  >
                    <span>{meta.label}</span>
                    {isCurrent ? <span className="text-xs text-fuchsia-600">נוכחי</span> : null}
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </>
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
  const searchParams = useSearchParams();
  const multiBusinessAdmin = adminMode && !marketingAdminMode;
  const showBusinessColumn = multiBusinessAdmin;
  const todayInput = useMemo(() => toDateInputValue(new Date()), []);
  const [dateFrom, setDateFrom] = useState(() => defaultLast30DaysRange().from);
  const [dateTo, setDateTo] = useState(() => defaultLast30DaysRange().to);
  const [statusFilter, setStatusFilter] = useState<ContactStatusFilterValue>(() =>
    resolveInitialStatusFilter(searchParams.get("status"))
  );
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const [singleOpen, setSingleOpen] = useState(false);
  const [singleContact, setSingleContact] = useState<Contact | null>(null);
  const [singleMsg, setSingleMsg] = useState("");
  const [answersContact, setAnswersContact] = useState<Contact | null>(null);
  const [contacts, setContacts] = useState(initialContacts);
  const [statusMenuKey, setStatusMenuKey] = useState<string | null>(null);
  const [statusUpdatingKey, setStatusUpdatingKey] = useState<string | null>(null);
  const [statusPendingConfirm, setStatusPendingConfirm] = useState<{
    contact: Contact;
    rowKey: string;
    status: ContactStatusKey;
  } | null>(null);

  const closeStatusMenu = useCallback(() => setStatusMenuKey(null), []);
  const openStatusMenu = useCallback((key: string) => setStatusMenuKey(key), []);

  useEffect(() => {
    setContacts(initialContacts);
  }, [initialContacts]);

  const filteredContacts = useMemo(() => {
    return contacts.filter((c) => {
      if (!matchesConversationDateRange(leadConversationAt(c), dateFrom, dateTo)) return false;
      if (statusFilter === "all") return true;
      const status = computeContactStatus(c);
      if (statusFilter === "none") return status === null;
      return status === statusFilter;
    });
  }, [contacts, dateFrom, dateTo, statusFilter]);

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
      template: 0,
      active: 0,
      followup: 0,
      no_response: 0,
      not_relevant: 0,
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

  function openAnswers(c: Contact) {
    if (!c.phone) return;
    setAnswersContact(c);
  }

  function requestContactStatusChange(c: Contact, rowKey: string, status: ContactStatusKey) {
    if (!canManuallySetContactStatus(status, c)) {
      showToast("לא ניתן לשנות לסטטוס הזה");
      return;
    }
    const slug = slugForContact(c, businessSlug, multiBusinessAdmin, marketingAdminMode);
    if (!slug || !c.phone) {
      showToast("חסר מזהה עסק לעדכון הסטטוס");
      return;
    }

    setStatusMenuKey(null);
    if (status === "not_relevant") {
      setStatusPendingConfirm({ contact: c, rowKey, status });
      return;
    }
    void commitContactStatusChange(c, rowKey, status);
  }

  async function commitContactStatusChange(c: Contact, rowKey: string, status: ContactStatusKey) {
    const slug = slugForContact(c, businessSlug, multiBusinessAdmin, marketingAdminMode);
    if (!slug || !c.phone) return;

    setStatusUpdatingKey(rowKey);
    setStatusPendingConfirm(null);
    try {
      const res = await fetch("/api/contacts/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_slug: slug,
          phone: c.phone,
          status,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        not_relevant_at?: string;
      };
      if (!res.ok) throw new Error(j?.error || "status_update_failed");

      if (status === "not_relevant") {
        const notRelevantAt = j.not_relevant_at ?? new Date().toISOString();
        setContacts((prev) =>
          prev.map((row) =>
            contactsSharePhone(row.phone, c.phone) &&
            (!multiBusinessAdmin || row.business_slug === c.business_slug)
              ? {
                  ...row,
                  not_relevant_at: notRelevantAt,
                  not_relevant_reason: row.not_relevant_reason ?? null,
                  wa_next_followup_at: null,
                  wa_no_response_due_at: null,
                  wa_followup_stage: 3,
                  followup_sent: true,
                }
              : row
          )
        );
        showToast("הסטטוס עודכן — זואי תפסיק פולואפים לליד הזה");
      }
    } catch (e) {
      console.error(e);
      showToast("עדכון הסטטוס נכשל. נסו שוב.");
    } finally {
      setStatusUpdatingKey(null);
    }
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
                        <p className="mt-1 text-xs text-zinc-500">
                          שיחה אחרונה: {formatDateTime(leadConversationAt(c))}
                        </p>
                      </div>
                      <div className="shrink-0">
                        <ContactStatusMenu
                          contact={c}
                          rowKey={rowKey}
                          editable={isContactStatusEditable(c, multiBusinessAdmin, marketingAdminMode)}
                          busy={statusUpdatingKey === rowKey}
                          open={statusMenuKey === rowKey}
                          onOpen={openStatusMenu}
                          onClose={closeStatusMenu}
                          onPickStatus={requestContactStatusChange}
                        />
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      {marketingAdminMode ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => openAnswers(c)}
                          disabled={!c.phone}
                        >
                          תשובות
                        </Button>
                      ) : null}
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
                  <th className="py-3 px-2 font-medium">שיחה אחרונה</th>
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
                        <td className="py-3 px-2 whitespace-nowrap">{formatDateTime(leadConversationAt(c))}</td>
                        <td className="py-3 px-2">
                          <ContactStatusMenu
                            contact={c}
                            rowKey={rowKey}
                            editable={isContactStatusEditable(c, multiBusinessAdmin, marketingAdminMode)}
                            busy={statusUpdatingKey === rowKey}
                            open={statusMenuKey === rowKey}
                            onOpen={openStatusMenu}
                            onClose={closeStatusMenu}
                            onPickStatus={requestContactStatusChange}
                          />
                        </td>
                        <td className="py-3 px-2">
                          <div className="flex flex-wrap justify-end gap-2">
                            {marketingAdminMode ? (
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => openAnswers(c)}
                                disabled={!c.phone}
                              >
                                תשובות
                              </Button>
                            ) : null}
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

      {answersContact?.phone ? (
        <MarketingLeadAnswersModal
          phone={answersContact.phone}
          fullName={answersContact.full_name}
          onClose={() => setAnswersContact(null)}
        />
      ) : null}

      {statusPendingConfirm ? (
        <ModalShell
          title="שינוי סטטוס ליד"
          onClose={() => setStatusPendingConfirm(null)}
          widthClass="max-w-md"
        >
          <div className="space-y-4">
            <p className="text-sm text-zinc-700 text-right leading-relaxed">
              לסמן את{" "}
              <span className="font-medium text-zinc-900">
                {statusPendingConfirm.contact.full_name?.trim() ||
                  statusPendingConfirm.contact.phone}
              </span>{" "}
              כלא רלוונטי?
              <br />
              זואי תפסיק לשלוח פולואפים לליד הזה.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStatusPendingConfirm(null)}
                disabled={statusUpdatingKey === statusPendingConfirm.rowKey}
              >
                ביטול
              </Button>
              <Button
                type="button"
                onClick={() =>
                  void commitContactStatusChange(
                    statusPendingConfirm.contact,
                    statusPendingConfirm.rowKey,
                    statusPendingConfirm.status
                  )
                }
                disabled={statusUpdatingKey === statusPendingConfirm.rowKey}
              >
                {statusUpdatingKey === statusPendingConfirm.rowKey ? "מעדכן…" : "אישור"}
              </Button>
            </div>
          </div>
        </ModalShell>
      ) : null}

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
