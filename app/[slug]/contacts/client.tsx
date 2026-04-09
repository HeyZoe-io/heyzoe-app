"use client";

import { useMemo, useState } from "react";
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
  totalCount: number;
  activeCount: number;
  initialContacts: Contact[];
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

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

export default function ContactsClient({ businessSlug, totalCount, activeCount, initialContacts }: Props) {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [msg, setMsg] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const [singleOpen, setSingleOpen] = useState(false);
  const [singleContact, setSingleContact] = useState<Contact | null>(null);
  const [singleMsg, setSingleMsg] = useState("");

  const [selectOpen, setSelectOpen] = useState(false);
  const [selectedPhones, setSelectedPhones] = useState<Record<string, boolean>>({});
  const [selectQuery, setSelectQuery] = useState("");

  const stats = useMemo(() => {
    const total = contacts.length;
    const active = contacts.filter((c) => !c.opted_out).length;
    return { total, active };
  }, [contacts]);

  const filteredForSelect = useMemo(() => {
    const q = selectQuery.trim();
    if (!q) return contacts;
    return contacts.filter((c) => {
      const p = (c.phone ?? "").toLowerCase();
      const n = (c.full_name ?? "").toLowerCase();
      return p.includes(q.toLowerCase()) || n.includes(q.toLowerCase());
    });
  }, [contacts, selectQuery]);

  function showToast(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(null), 2600);
  }

  async function sendViaApi(payload: { mode: "single" | "broadcast"; phone?: string; message: string }) {
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

  async function onSendAll() {
    const text = msg.trim();
    if (!text) return;
    if (!window.confirm("לשלוח הודעה לכל אנשי הקשר הפעילים?")) return;
    setSending(true);
    try {
      const { sent, failed } = await sendViaApi({ mode: "broadcast", message: text });
      if (sent > 0) showToast(`נשלח ל-${sent} אנשי קשר בהצלחה ✅`);
      if (failed > 0) showToast(`נשלח ל-${sent} אנשי קשר. נכשלו: ${failed}`);
    } catch (e) {
      console.error(e);
      showToast("שליחה נכשלה. נסו שוב.");
    } finally {
      setSending(false);
    }
  }

  function openSingle(c: Contact) {
    setSingleContact(c);
    setSingleMsg(msg); // reuse broadcast text if already typed
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

  function openSelect() {
    const next: Record<string, boolean> = {};
    contacts.forEach((c) => {
      if (c.phone) next[c.phone] = Boolean(selectedPhones[c.phone]);
    });
    setSelectedPhones(next);
    setSelectOpen(true);
  }

  async function onSendSelected() {
    const text = msg.trim();
    if (!text) return;
    const targets = Object.entries(selectedPhones)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (targets.length === 0) {
      showToast("לא נבחרו אנשי קשר.");
      return;
    }
    setSending(true);
    let ok = 0;
    let bad = 0;
    try {
      // Send sequentially with small delay to reduce rate limiting
      for (const p of targets) {
        try {
          const r = await sendViaApi({ mode: "single", phone: p, message: text });
          ok += r.sent;
          bad += r.failed;
        } catch {
          bad += 1;
        }
        await sleep(500);
      }
      if (ok > 0) showToast(`נשלח ל-${ok} אנשי קשר בהצלחה ✅`);
      if (bad > 0) showToast(`נשלח ל-${ok} אנשי קשר. נכשלו: ${bad}`);
      setSelectOpen(false);
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
          <CardTitle className="text-right">שליחת הודעת שידור</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={msg} onChange={setMsg} placeholder="כתוב את ההודעה שלך כאן..." rows={4} />
          <p className="text-xs text-zinc-500 text-right">ההודעה תכלול אוטומטית אפשרות הסרה בסוף</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={openSelect} disabled={sending || !msg.trim()}>
              שלח לנבחרים
            </Button>
            <Button type="button" onClick={onSendAll} disabled={sending || !msg.trim() || stats.active === 0}>
              {sending ? "שולח..." : "שלח לכולם"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="hz-wave hz-wave-3">
        <CardHeader>
          <CardTitle className="text-right">רשימת אנשי קשר</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
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

      {selectOpen ? (
        <ModalShell title="שליחה לנבחרים" onClose={() => setSelectOpen(false)} widthClass="max-w-2xl">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-zinc-600 text-right">
                סמנו אנשי קשר לשליחה (רק פעילים יקבלו הודעה אם תלחצו “שלח” מהטבלה)
              </p>
              <input
                dir="rtl"
                value={selectQuery}
                onChange={(e) => setSelectQuery(e.target.value)}
                placeholder="חיפוש לפי שם / טלפון…"
                className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-right placeholder:text-right"
              />
            </div>
            <div className="max-h-[52vh] overflow-y-auto rounded-xl border border-zinc-200">
              <table className="w-full text-sm" dir="rtl">
                <thead>
                  <tr className="text-right text-xs text-zinc-500 border-b border-zinc-200">
                    <th className="py-3 px-2 font-medium">בחירה</th>
                    <th className="py-3 px-2 font-medium">טלפון</th>
                    <th className="py-3 px-2 font-medium">שם</th>
                    <th className="py-3 px-2 font-medium">סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredForSelect.map((c, idx) => {
                    const p = c.phone ?? "";
                    const optedOut = Boolean(c.opted_out);
                    const checked = p ? Boolean(selectedPhones[p]) : false;
                    return (
                      <tr key={`${p || "row"}-${idx}`} className="border-b border-zinc-100 text-right">
                        <td className="py-3 px-2">
                          <input
                            type="checkbox"
                            disabled={!p || optedOut}
                            checked={checked}
                            onChange={(e) => {
                              if (!p) return;
                              setSelectedPhones((prev) => ({ ...prev, [p]: e.target.checked }));
                            }}
                          />
                        </td>
                        <td className="py-3 px-2 whitespace-nowrap">{p || "—"}</td>
                        <td className="py-3 px-2">{c.full_name?.trim() || "—"}</td>
                        <td className="py-3 px-2">
                          {optedOut ? (
                            <Badge className="border-red-200 bg-red-50 text-red-700">הוסר</Badge>
                          ) : (
                            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">פעיל</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredForSelect.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-zinc-500">
                        אין תוצאות לחיפוש.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setSelectOpen(false)} disabled={sending}>
                ביטול
              </Button>
              <Button type="button" onClick={onSendSelected} disabled={sending || !msg.trim()}>
                {sending ? "שולח..." : "שלח"}
              </Button>
            </div>
            <p className="text-xs text-zinc-500 text-right">ההודעה תכלול אוטומטית אפשרות הסרה בסוף</p>
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

