"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Send, X, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type ChatRow = {
  role: "owner" | "assistant" | "system";
  content: string;
};

function normalizePhone(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("972") && digits.length >= 12) {
    const local = digits.slice(3);
    return local.startsWith("0") ? local : `0${local}`;
  }
  return digits.startsWith("0") ? digits : digits;
}

export default function DashboardHelpChatWidget({ slug }: { slug: string }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ChatRow[]>([
    { role: "assistant", content: "היי! אני זואי. איך אפשר לעזור בדשבורד?" },
  ]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [needsHuman, setNeedsHuman] = useState(false);
  const [suggestedPhone, setSuggestedPhone] = useState("");
  const [phone, setPhone] = useState("");
  const [callbackSent, setCallbackSent] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Prefill phone from account metadata for easy confirmation.
    void supabase.auth.getUser().then(({ data }) => {
      const ph = typeof data.user?.user_metadata?.phone === "string" ? data.user.user_metadata.phone : "";
      const normalized = normalizePhone(ph);
      setSuggestedPhone(normalized);
      setPhone(normalized);
    });
  }, [supabase]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [rows.length, open]);

  async function send() {
    const msg = text.trim();
    if (!msg || sending) return;
    setSending(true);
    setCallbackSent(false);
    setNeedsHuman(false);
    setRows((prev) => [...prev, { role: "owner", content: msg }]);
    setText("");
    try {
      const res = await fetch("/api/dashboard/help-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, message: msg, thread_id: threadId }),
      });
      const j = (await res.json().catch(() => null)) as any;
      if (!res.ok || !j?.ok) {
        setRows((prev) => [
          ...prev,
          { role: "assistant", content: "הייתה בעיה בשליחת ההודעה. אפשר לנסות שוב." },
        ]);
        return;
      }
      if (typeof j.thread_id === "number") setThreadId(j.thread_id);
      setRows((prev) => [...prev, { role: "assistant", content: String(j.reply ?? "").trim() }]);
      const nh = Boolean(j.needs_human);
      setNeedsHuman(nh);
      const sp = normalizePhone(String(j.suggested_phone ?? ""));
      if (sp) {
        setSuggestedPhone(sp);
        setPhone((p) => (p.trim() ? p : sp));
      }
      if (nh) {
        setRows((prev) => [
          ...prev,
          {
            role: "system",
            content:
              "כדי שנחזור אליך, אפשר לאשר מספר לחזרה (או לכתוב מספר אחר) ואז ללחוץ על “בקשו שיחזרו אליי”.",
          },
        ]);
      }
    } finally {
      setSending(false);
    }
  }

  async function sendCallback() {
    const p = phone.trim();
    if (!needsHuman || !threadId || !p) return;
    setSending(true);
    try {
      const res = await fetch("/api/dashboard/help-chat/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, thread_id: threadId, phone: p }),
      });
      if (!res.ok) {
        setRows((prev) => [...prev, { role: "system", content: "לא הצלחתי לשמור את המספר. נסו שוב." }]);
        return;
      }
      setCallbackSent(true);
      setRows((prev) => [
        ...prev,
        { role: "system", content: `מעולה, העברתי לצוות. נחזור אליך למספר: ${p}` },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-50" dir="rtl">
      {open ? (
        <div className="w-[min(92vw,380px)] h-[min(70vh,520px)] rounded-2xl border border-[rgba(113,51,218,0.2)] bg-white shadow-[0_30px_90px_rgba(15,23,42,0.18)] overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between">
            <div className="text-right">
              <p className="text-sm font-semibold text-zinc-900">עזרה עם זואי</p>
              <p className="text-[11px] text-zinc-500">תמיכה בדשבורד עבור {slug}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-2 rounded-full hover:bg-zinc-100 text-zinc-600"
              aria-label="סגור"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto bg-[#faf7ff] p-3 space-y-2">
            {rows.map((r, i) => (
              <div
                key={i}
                className={`flex ${r.role === "owner" ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={
                    "max-w-[86%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap border " +
                    (r.role === "owner"
                      ? "bg-white text-zinc-900 border-zinc-200"
                      : r.role === "assistant"
                        ? "text-white border-[rgba(113,51,218,0.18)] bg-[linear-gradient(135deg,#7133da,#ff92ff)]"
                        : "bg-amber-50 text-amber-900 border-amber-200")
                  }
                >
                  {r.content}
                </div>
              </div>
            ))}

            {needsHuman && (
              <div className="mt-2 rounded-2xl border border-amber-200 bg-white p-3">
                <p className="text-xs font-semibold text-amber-900 text-right">בקשו שיחזרו אליי</p>
                <div className="mt-2 flex gap-2 items-center">
                  <Input
                    dir="ltr"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder={suggestedPhone || "0501234567"}
                    className="flex-1"
                    autoComplete="tel"
                  />
                  <Button
                    type="button"
                    onClick={() => void sendCallback()}
                    disabled={sending || callbackSent || !phone.trim()}
                    className="gap-2"
                  >
                    <PhoneCall className="h-4 w-4" />
                    שליחה
                  </Button>
                </div>
                <p className="mt-1 text-[11px] text-zinc-500 text-right">
                  נשתמש במספר רק כדי לחזור אליך בנושא הזה.
                </p>
              </div>
            )}
          </div>

          <div className="p-3 border-t border-zinc-200 bg-white">
            <div className="flex gap-2 items-center">
              <Input
                dir="rtl"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="כתבו שאלה על הדשבורד…"
              />
              <Button type="button" onClick={() => void send()} disabled={sending || !text.trim()} className="gap-2">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-12 w-12 rounded-full shadow-lg bg-[linear-gradient(135deg,#7133da,#ff92ff)] text-white flex items-center justify-center hover:opacity-95"
          aria-label="פתח צ׳אט עזרה"
        >
          <MessageCircle className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

