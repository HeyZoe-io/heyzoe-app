"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isMarketingConversationsSlug } from "@/lib/marketing-whatsapp";

type SessionMessage = {
  role: string;
  content: string;
  created_at: string;
  error_code?: string | null;
};

type SessionSummary = {
  session_id: string;
  lastAt: string;
  count: number;
  isOpen: boolean;
  isPaused: boolean;
  phone: string;
};

export default function ConversationsClient({
  slug,
  initialSessions,
  apiScope = "dashboard",
}: {
  slug: string;
  initialSessions: SessionSummary[];
  /** dashboard = בעל עסק; admin = סופר-אדמין */
  apiScope?: "dashboard" | "admin";
}) {
  const apiPrefix = apiScope === "admin" ? "/api/admin" : "/api/dashboard";
  const queryScope = apiScope === "admin" ? "admin" : "dashboard";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [sessions, setSessions] = useState<SessionSummary[]>(initialSessions);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manualText, setManualText] = useState("");
  const [sending, setSending] = useState(false);
  const [pausing, setPausing] = useState<string | null>(null);

  function normalizePhoneForMatch(raw: string): string {
    const digits = String(raw ?? "").replace(/\D/g, "");
    if (!digits) return "";
    // +9725XXXXXXXX -> 05XXXXXXXX
    if (digits.startsWith("972") && digits.length >= 12) {
      const local = digits.slice(3);
      return local.startsWith("0") ? local : `0${local}`;
    }
    if (digits.startsWith("0")) return digits;
    // fallback: last 9 digits (e.g. 521234567)
    if (digits.length >= 9) return digits.slice(-9);
    return digits;
  }

  const phoneParam = (searchParams.get("phone") ?? "").trim();
  const normalizedFilter = useMemo(
    () => (phoneParam ? normalizePhoneForMatch(phoneParam) : ""),
    [phoneParam]
  );

  const visibleSessions = useMemo(() => {
    if (!normalizedFilter) return sessions;
    return sessions.filter((s) => {
      const a = normalizePhoneForMatch(s.phone);
      if (!a) return false;
      if (a === normalizedFilter) return true;
      // Compare last 9 digits if both have enough digits
      const a9 = a.replace(/\D/g, "").slice(-9);
      const f9 = normalizedFilter.replace(/\D/g, "").slice(-9);
      return a9 && f9 && a9 === f9;
    });
  }, [sessions, normalizedFilter]);

  const selected = visibleSessions.find((s) => s.session_id === selectedId) ?? null;

  const sessionsQuery = useQuery({
    queryKey: [queryScope, "conversations", slug],
    queryFn: async ({ signal }) => {
      const res = await fetch(`${apiPrefix}/conversations?slug=${encodeURIComponent(slug)}`, { signal });
      if (!res.ok) throw new Error(`failed_to_load_conversations:${res.status}`);
      const j = (await res.json()) as { sessions?: SessionSummary[] };
      return (j.sessions ?? []) as SessionSummary[];
    },
    initialData: initialSessions,
  });

  useEffect(() => {
    if (sessionsQuery.data) setSessions(sessionsQuery.data);
  }, [sessionsQuery.data]);

  const messagesQuery = useQuery({
    queryKey: [queryScope, "conversation_messages", slug, selectedId ?? ""],
    enabled: Boolean(selectedId),
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `${apiPrefix}/conversation-messages?slug=${encodeURIComponent(slug)}&session_id=${encodeURIComponent(
          selectedId ?? ""
        )}`,
        { signal }
      );
      if (!res.ok) throw new Error(`failed_to_load_conversation_messages:${res.status}`);
      const j = (await res.json()) as { messages?: SessionMessage[] };
      return (j.messages ?? []) as SessionMessage[];
    },
  });

  async function prefetchMessages(sessionId: string) {
    const sid = String(sessionId ?? "").trim();
    if (!sid) return;
    await queryClient.prefetchQuery({
      queryKey: [queryScope, "conversation_messages", slug, sid],
      queryFn: async ({ signal }) => {
        const res = await fetch(
          `${apiPrefix}/conversation-messages?slug=${encodeURIComponent(slug)}&session_id=${encodeURIComponent(sid)}`,
          { signal }
        );
        if (!res.ok) throw new Error(`failed_to_load_conversation_messages:${res.status}`);
        const j = (await res.json()) as { messages?: SessionMessage[] };
        return (j.messages ?? []) as SessionMessage[];
      },
    });
  }

  function formatDmy(value: string): string {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  }

  const selectedScrollKey = `${selected?.session_id ?? ""}:${messagesQuery.data?.length ?? 0}`;

  useEffect(() => {
    // Desktop: open the latest conversation by default. Mobile: keep closed until user clicks a phone number.
    try {
      const isDesktop = window.matchMedia?.("(min-width: 768px)")?.matches ?? false;
      if (isDesktop && !selectedId) setSelectedId(initialSessions[0]?.session_id ?? null);
    } catch {
      /* noop */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!normalizedFilter) return;
    // If current selection is not in the filtered list, pick first filtered session.
    if (selectedId && visibleSessions.some((s) => s.session_id === selectedId)) return;
    setSelectedId(visibleSessions[0]?.session_id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedFilter, visibleSessions.length]);

  useEffect(() => {
    const el = document.getElementById("hz-convo-messages");
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [selectedScrollKey]);

  function clearPhoneFilter() {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("phone");
    const q = sp.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }

  async function toggleBot(sessionId: string, nextPaused: boolean) {
    setPausing(sessionId);
    try {
      const url = nextPaused ? "/api/whatsapp/pause" : "/api/whatsapp/unpause";
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_slug: slug.trim().toLowerCase(),
          session_id: sessionId,
        }),
      });
      setSessions((prev) =>
        prev.map((s) =>
          s.session_id === sessionId ? { ...s, isPaused: nextPaused } : s
        )
      );
      queryClient.setQueryData<SessionSummary[]>([queryScope, "conversations", slug], (prev) =>
        (prev ?? []).map((s) => (s.session_id === sessionId ? { ...s, isPaused: nextPaused } : s))
      );
    } finally {
      setPausing(null);
    }
  }

  async function sendManual() {
    if (!selected || !manualText.trim()) return;
    setSending(true);
    try {
      const manualUrl =
        apiScope === "admin" && isMarketingConversationsSlug(slug)
          ? "/api/admin/marketing/manual-send"
          : "/api/whatsapp/manual-send";
      const manualBody =
        apiScope === "admin" && isMarketingConversationsSlug(slug)
          ? { session_id: selected.session_id, text: manualText.trim() }
          : {
              business_slug: slug,
              session_id: selected.session_id,
              text: manualText.trim(),
            };
      const res = await fetch(manualUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manualBody),
      });
      if (res.ok) {
        const nowIso = new Date().toISOString();
        const msg: SessionMessage = {
          role: "assistant",
          content: manualText.trim(),
          created_at: nowIso,
        };
        setSessions((prev) =>
          prev.map((s) =>
            s.session_id === selected.session_id
              ? {
                  ...s,
                  lastAt: nowIso,
                  count: s.count + 1,
                  isOpen: true,
                }
              : s
          )
        );
        queryClient.setQueryData<SessionMessage[]>(
          [queryScope, "conversation_messages", slug, selected.session_id],
          (prev) => [...(prev ?? []), msg]
        );
        queryClient.setQueryData<SessionSummary[]>([queryScope, "conversations", slug], (prev) =>
          (prev ?? []).map((s) =>
            s.session_id === selected.session_id
              ? { ...s, lastAt: nowIso, count: s.count + 1, isOpen: true }
              : s
          )
        );
        setManualText("");
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] overflow-x-hidden">
      <div className="space-y-2 rounded-2xl border border-[rgba(113,51,218,0.1)] bg-white p-3 max-h-[520px] overflow-y-auto overflow-x-hidden">
        {normalizedFilter ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-[rgba(113,51,218,0.12)] bg-[#faf7ff] px-3 py-2">
            <p className="text-xs text-zinc-700 text-right">
              מסונן לפי:{" "}
              <span className="font-semibold text-zinc-900">{phoneParam}</span>
            </p>
            <button
              type="button"
              onClick={clearPhoneFilter}
              className="rounded-full px-3 py-1 text-xs font-medium border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
            >
              ✕
            </button>
          </div>
        ) : null}

        {visibleSessions.map((s) => (
          <div
            key={s.session_id}
            className={`w-full text-right rounded-xl border px-3 py-2 flex items-center justify-between ${
              selectedId === s.session_id
                ? "border-[rgba(113,51,218,0.35)] bg-[#f0eaff]"
                : "border-[rgba(113,51,218,0.1)] bg-white hover:bg-[#faf7ff]"
            }`}
          >
            <div className="text-right">
              <p className="text-xs text-zinc-500">מספר טלפון</p>
              <button
                type="button"
                onClick={() => setSelectedId((prev) => (prev === s.session_id ? null : s.session_id))}
                onPointerDown={() => void prefetchMessages(s.session_id)}
                className="text-sm font-medium text-zinc-900 truncate max-w-[220px] underline underline-offset-4 decoration-zinc-300 hover:decoration-zinc-500"
              >
                {s.phone || "לא זמין"}
              </button>
              <p className="text-[11px] text-zinc-500">
                {s.count} הודעות · {formatDmy(s.lastAt)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-medium ${
                  s.isOpen
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-zinc-50 text-zinc-600 border border-zinc-200"
                }`}
              >
                {s.isOpen ? "פתוחה" : "סגורה"}
              </span>
              {s.isPaused && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                  בוט מושהה
                </span>
              )}
            </div>
          </div>
        ))}
        {visibleSessions.length === 0 && (
          <p className="text-xs text-zinc-500 text-right">
            {normalizedFilter ? "אין שיחות שתואמות למסנן זה." : "טרם התקבלו שיחות לעסק זה."}
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-[rgba(113,51,218,0.1)] bg-white p-3 flex flex-col gap-2 text-right overflow-x-hidden min-w-0">
        {selected ? (
          <>
            <div className="flex items-center justify-between mb-2">
              <div className="text-right">
                <p className="text-xs text-zinc-500">מספר טלפון</p>
                <p className="text-sm font-medium text-zinc-900">
                  {selected.phone || "לא זמין"}
                </p>
                <p className="text-[11px] text-zinc-500">
                  {selected.count} הודעות ·{" "}
                  {formatDmy(selected.lastAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggleBot(selected.session_id, !selected.isPaused)}
                disabled={pausing === selected.session_id}
                className={`rounded-full px-3 py-1 text-[11px] font-medium border ${
                  selected.isPaused
                    ? "border-emerald-400 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                    : "border-red-400 bg-red-50 text-red-800 hover:bg-red-100"
                } disabled:opacity-50`}
              >
                {pausing === selected.session_id
                  ? "מעבד..."
                  : selected.isPaused
                  ? "הפעל בוט"
                  : "עצור בוט"}
              </button>
            </div>

            <div
              id="hz-convo-messages"
              className="flex-1 rounded-2xl border border-[rgba(113,51,218,0.1)] bg-[#faf7ff] p-3 max-h-72 overflow-y-auto overflow-x-hidden"
            >
              {(messagesQuery.data ?? []).map((m, idx) => (
                <div
                  key={`${m.created_at}-${idx}`}
                  className={`mb-2 text-xs flex ${m.role === "user" ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={
                      "max-w-[85%] rounded-2xl px-3 py-2 border overflow-hidden " +
                      (m.role === "user"
                        ? "bg-white text-zinc-800 border-[rgba(113,51,218,0.1)]"
                        : "text-white border-[rgba(113,51,218,0.18)] bg-[linear-gradient(135deg,#7133da,#ff92ff)]")
                    }
                  >
                    <p className="text-[10px] opacity-80 mb-1">
                      {m.role === "user" ? "לקוח" : "הבוט"}
                    </p>
                    <p className="text-sm leading-snug break-words whitespace-pre-wrap">{m.content}</p>
                    {m.role !== "user" && m.error_code ? (
                      <p className="mt-1 text-[10px] opacity-80">
                        קוד שגיאה: {m.error_code}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            {selected.isPaused && (
              <div className="mt-2 space-y-2">
                <textarea
                  className="w-full rounded-xl border border-zinc-300 p-2 text-sm text-right placeholder:text-right"
                  rows={3}
                  placeholder="כתוב תשובה ידנית לוואטסאפ..."
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                />
                <button
                  type="button"
                  onClick={sendManual}
                  disabled={sending || !manualText.trim()}
                  className="w-full rounded-xl px-4 py-2 text-sm font-medium text-white disabled:opacity-50 bg-[linear-gradient(135deg,#7133da,#ff92ff)] hover:opacity-95"
                >
                  {sending ? "שולח..." : "שליחת הודעה ידנית"}
                </button>
              </div>
            )}
            {!selected.isPaused && (
              <p className="mt-2 text-[11px] text-zinc-500">
                כדי לענות ידנית ולמנוע מזואי לענות אוטומטית, לחץ על "עצור בוט". לא לשכוח להפעיל מחדש :)
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-zinc-500">
            בחר שיחה משמאל כדי לראות את ההודעות ולהפעיל עצירת בוט / מענה ידני.
          </p>
        )}
      </div>
    </div>
  );
}

