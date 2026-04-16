"use client";

import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Contact = {
  phone: string | null;
  full_name: string | null;
  source: string | null;
  created_at: string | null;
  opted_out: boolean | null;
};

type Props = {
  businessSlug: string;
  initialContacts: Contact[];
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("he-IL", { year: "numeric", month: "2-digit", day: "2-digit" });
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

export default function ContactsClient({ businessSlug, initialContacts }: Props) {
  const router = useRouter();
  const contacts = initialContacts;
  const [toast, setToast] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const [singleOpen, setSingleOpen] = useState(false);
  const [singleContact, setSingleContact] = useState<Contact | null>(null);
  const [singleMsg, setSingleMsg] = useState("");

  const stats = useMemo(() => {
    const total = contacts.length;
    const active = contacts.filter((c) => !c.opted_out).length;
    return { total, active };
  }, [contacts]);

  function showToast(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(null), 2600);
  }

  async function sendViaApi(payload: { mode: "single"; phone: string; message: string }) {
    const res = await fetch("/api/contacts/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_slug: businessSlug,
        ...payload,
      }),
    });
    const j = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new Error(j?.error || "send_failed");
    return { sent: Number(j.sent ?? 0), failed: Number(j.failed ?? 0) };
  }

  function openSingle(c: Contact) {
    setSingleContact(c);
    setSingleMsg("");
    setSingleOpen(true);
  }

  function viewConversations(phone: string) {
    router.push(`/${encodeURIComponent(businessSlug)}/conversations?phone=${encodeURIComponent(phone)}`);
  }

  async function onSendSingle() {
    const c = singleContact;
    if (!c?.phone) return;
    const text = singleMsg.trim();
    if (!text) return;
    setSending(true);
    try {
      const { sent, failed } = await sendViaApi({ mode: "single", phone: c.phone, message: text });
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

  return (
    <div className="space-y-6" dir="rtl">
      <div className="hz-wave hz-wave-1">
        <h1 className="text-2xl font-semibold text-zinc-900 text-right">אנשי קשר</h1>
        <p className="text-sm text-zinc-600 text-right">
          סה״כ {stats.total} אנשי קשר ({stats.active} פעילים)
        </p>
      </div>

      <Card className="hz-wave hz-wave-2">
        <CardHeader>
          <CardTitle className="text-right">רשימת אנשי קשר</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Mobile: cards (no horizontal scroll). Desktop: table. */}
          <div className="space-y-3 md:hidden">
            {contacts.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500">אין אנשי קשר עדיין.</p>
            ) : (
              contacts.map((c, idx) => {
                const optedOut = Boolean(c.opted_out);
                return (
                  <div
                    key={`${c.phone ?? "row"}-${idx}`}
                    className="rounded-2xl border border-zinc-200 bg-white p-4 text-right"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <button
                          type="button"
                          className="text-sm font-semibold text-zinc-900 underline underline-offset-4 decoration-zinc-300 hover:decoration-zinc-500 truncate max-w-[78vw]"
                          onClick={() => (c.phone ? viewConversations(c.phone) : null)}
                          disabled={!c.phone}
                        >
                          {c.phone ?? "—"}
                        </button>
                        <p className="mt-1 text-xs text-zinc-600">
                          {c.full_name?.trim() || "—"} · {c.source?.trim() || "—"}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">הצטרף: {formatDate(c.created_at)}</p>
                      </div>
                      <div className="shrink-0">
                        {optedOut ? (
                          <Badge className="border-red-200 bg-red-50 text-red-700">הוסר</Badge>
                        ) : (
                          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">פעיל</Badge>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => (c.phone ? viewConversations(c.phone) : null)}
                        disabled={!c.phone}
                      >
                        צפה בשיחות
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => openSingle(c)}
                        disabled={sending || optedOut || !c.phone}
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
                  <th className="py-3 px-2 font-medium">טלפון</th>
                  <th className="py-3 px-2 font-medium">שם</th>
                  <th className="py-3 px-2 font-medium">מקור</th>
                  <th className="py-3 px-2 font-medium">תאריך הצטרפות</th>
                  <th className="py-3 px-2 font-medium">סטטוס</th>
                  <th className="py-3 px-2 font-medium">פעולות</th>
                </tr>
              </thead>
              <tbody>
                {contacts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-zinc-500">
                      אין אנשי קשר עדיין.
                    </td>
                  </tr>
                ) : (
                  contacts.map((c, idx) => {
                    const optedOut = Boolean(c.opted_out);
                    return (
                      <tr key={`${c.phone ?? "row"}-${idx}`} className="border-b border-zinc-100 text-right">
                        <td className="py-3 px-2 whitespace-nowrap">{c.phone ?? "—"}</td>
                        <td className="py-3 px-2">{c.full_name?.trim() || "—"}</td>
                        <td className="py-3 px-2">{c.source?.trim() || "—"}</td>
                        <td className="py-3 px-2 whitespace-nowrap">{formatDate(c.created_at)}</td>
                        <td className="py-3 px-2">
                          {optedOut ? (
                            <Badge className="border-red-200 bg-red-50 text-red-700">הוסר</Badge>
                          ) : (
                            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">פעיל</Badge>
                          )}
                        </td>
                        <td className="py-3 px-2">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => (c.phone ? viewConversations(c.phone) : null)}
                              disabled={!c.phone}
                            >
                              צפה בשיחות
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => openSingle(c)}
                              disabled={sending || optedOut || !c.phone}
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
                {singleContact.full_name?.trim() || "איש קשר"}
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

