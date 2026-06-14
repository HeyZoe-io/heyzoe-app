"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { getContactStatusMeta, type ContactStatusKey } from "@/lib/contact-status";
import { WaConversationMessage } from "@/components/conversations/WaConversationMessage";
import { sortSessionsByRecentActivity } from "@/lib/conversations-sessions";
import { isMarketingConversationsSlug } from "@/lib/marketing-whatsapp";
import { isZoeAdminAllConversationsSlug } from "@/lib/zoe-admin-conversations";
import {
  dashboardDateLocale,
  dashboardDir,
  dashboardLangFromParam,
  type DashboardLang,
} from "@/lib/dashboard-lang";

const i18n = {
  he: {
    pageTitle: (slug: string) => `שיחות ל-${slug}`,
    pageSubtitle: "רשימת השיחות, עצירת בוט ומענה ידני ללקוחות",
    filteredBy: "מסונן לפי:",
    phoneLabel: "מספר טלפון",
    leadLabel: "ליד",
    unavailable: "לא זמין",
    messagesMeta: (count: number, date: string) => `${count} הודעות · ${date}`,
    botPaused: "בוט מושהה",
    emptyFilter: "אין שיחות שתואמות למסנן זה.",
    emptyAdmin: "אין שיחות מתועדות במערכת.",
    emptyMarketing:
      "לא נמצאו שיחות בקו השיווקי. נסו «כל השיחות» מהתפריט — ייתכן שההודעות נשמרו תחת עסק אחר.",
    emptyBusiness: "טרם התקבלו שיחות לעסק זה.",
    processing: "מעבד...",
    resumeBot: "הפעל בוט",
    pauseBot: "עצור בוט",
    leadPhoneFallback: "מספר הליד",
    windowExpired: (phone: string) =>
      `לא ניתן לשלוח הודעה לאחר 24 שעות. ניתן ליצור קשר מהמספר שלכם: ${phone}`,
    manualPlaceholder: "כתוב תשובה ידנית לוואטסאפ...",
    sendManual: "שליחת הודעה ידנית",
    sending: "שולח...",
    pauseHint:
      'כדי לענות ידנית ולמנוע מזואי לענות אוטומטית, לחץ על "עצור בוט". לא לשכוח להפעיל מחדש :)',
    selectConversation: "בחר שיחה משמאל כדי לראות את ההודעות ולהפעיל עצירת בוט / מענה ידני.",
  },
  en: {
    pageTitle: (slug: string) => `Conversations — ${slug}`,
    pageSubtitle: "Conversation list, pause bot, and manual replies to customers",
    filteredBy: "Filtered by:",
    phoneLabel: "Phone number",
    leadLabel: "Lead",
    unavailable: "Unavailable",
    messagesMeta: (count: number, date: string) => `${count} messages · ${date}`,
    botPaused: "Bot Paused",
    emptyFilter: "No conversations match this filter.",
    emptyAdmin: "No conversations recorded in the system.",
    emptyMarketing:
      "No conversations found on the marketing line. Try «All Conversations» from the menu — messages may be stored under another business.",
    emptyBusiness: "No conversations received for this business yet.",
    processing: "Processing...",
    resumeBot: "Resume Bot",
    pauseBot: "Pause Bot",
    leadPhoneFallback: "lead number",
    windowExpired: (phone: string) =>
      `Cannot send a message after 24 hours. You can reach out from your number: ${phone}`,
    manualPlaceholder: "Write a manual WhatsApp reply...",
    sendManual: "Send Manual Message",
    sending: "Sending...",
    pauseHint:
      'To reply manually and prevent Zoe from auto-replying, click "Pause Bot". Remember to resume when done :)',
    selectConversation: "Select a conversation on the left to view messages and pause the bot / reply manually.",
  },
} as const;

type SessionMessage = {
  role: string;
  content: string;
  created_at: string;
  error_code?: string | null;
  model_used?: string | null;
};

type SessionSummary = {
  session_id: string;
  lastAt: string;
  count: number;
  isOpen: boolean;
  isPaused: boolean;
  phone: string;
  fullName?: string | null;
  contactStatus?: ContactStatusKey | null;
  /** טאב זואי אדמין — «כל השיחות» */
  source_slug?: string;
  source_name?: string;
};

const WHATSAPP_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

function sessionLeadName(session: { fullName?: string | null }): string {
  return String(session.fullName ?? "").trim();
}

function sessionPhoneDisplay(session: { phone?: string }, unavailable: string): string {
  return String(session.phone ?? "").trim() || unavailable;
}

function SessionContactStatusBadge({
  statusKey,
  lang,
}: {
  statusKey: ContactStatusKey | null | undefined;
  lang: DashboardLang;
}) {
  if (!statusKey) return <span className="text-[11px] text-zinc-400">—</span>;
  const meta = getContactStatusMeta(lang)[statusKey];
  return (
    <Badge className={`text-[11px] font-medium px-3 py-1 ${meta.badgeClass}`} title={meta.tooltip}>
      {meta.label}
    </Badge>
  );
}

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
  const lang = dashboardLangFromParam(searchParams.get("lang"));
  const t = i18n[lang];
  const textAlignClass = lang === "en" ? "text-left" : "text-right";
  const placeholderAlignClass = lang === "en" ? "placeholder:text-left" : "placeholder:text-right";

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
    const list = normalizedFilter
      ? sessions.filter((s) => {
          const a = normalizePhoneForMatch(s.phone);
          if (!a) return false;
          if (a === normalizedFilter) return true;
          const a9 = a.replace(/\D/g, "").slice(-9);
          const f9 = normalizedFilter.replace(/\D/g, "").slice(-9);
          return a9 && f9 && a9 === f9;
        })
      : sessions;
    return sortSessionsByRecentActivity(list);
  }, [sessions, normalizedFilter]);

  const selected = visibleSessions.find((s) => s.session_id === selectedId) ?? null;

  function slugForSession(sessionId: string): string {
    const sess = visibleSessions.find((s) => s.session_id === sessionId);
    return (sess?.source_slug ?? slug).trim().toLowerCase();
  }

  const messagesSlug = selectedId ? slugForSession(selectedId) : slug.trim().toLowerCase();

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
    if (sessionsQuery.data) setSessions(sortSessionsByRecentActivity(sessionsQuery.data));
  }, [sessionsQuery.data]);

  const messagesQuery = useQuery({
    queryKey: [queryScope, "conversation_messages", messagesSlug, selectedId ?? ""],
    enabled: Boolean(selectedId),
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `${apiPrefix}/conversation-messages?slug=${encodeURIComponent(messagesSlug)}&session_id=${encodeURIComponent(
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
    const prefetchSlug = slugForSession(sid);
    await queryClient.prefetchQuery({
      queryKey: [queryScope, "conversation_messages", prefetchSlug, sid],
      queryFn: async ({ signal }) => {
        const res = await fetch(
          `${apiPrefix}/conversation-messages?slug=${encodeURIComponent(prefetchSlug)}&session_id=${encodeURIComponent(sid)}`,
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
    return new Intl.DateTimeFormat(dashboardDateLocale(lang), {
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
    const bizSlug = slugForSession(sessionId);
    try {
      const url = nextPaused ? "/api/whatsapp/pause" : "/api/whatsapp/unpause";
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_slug: bizSlug,
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
        apiScope === "admin" && isMarketingConversationsSlug(messagesSlug)
          ? "/api/admin/marketing/manual-send"
          : "/api/whatsapp/manual-send";
      const manualBody =
        apiScope === "admin" && isMarketingConversationsSlug(messagesSlug)
          ? { session_id: selected.session_id, text: manualText.trim() }
          : {
              business_slug: messagesSlug,
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
          sortSessionsByRecentActivity(
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
          )
        );
        queryClient.setQueryData<SessionMessage[]>(
          [queryScope, "conversation_messages", messagesSlug, selected.session_id],
          (prev) => [...(prev ?? []), msg]
        );
        queryClient.setQueryData<SessionSummary[]>([queryScope, "conversations", slug], (prev) =>
          sortSessionsByRecentActivity(
            (prev ?? []).map((s) =>
              s.session_id === selected.session_id
                ? { ...s, lastAt: nowIso, count: s.count + 1, isOpen: true }
                : s
            )
          )
        );
        setManualText("");
      }
    } finally {
      setSending(false);
    }
  }

  const lastUserMessageAt = useMemo(() => {
    const selectedMessages = messagesQuery.data ?? [];
    for (let i = selectedMessages.length - 1; i >= 0; i -= 1) {
      const msg = selectedMessages[i];
      if (String(msg?.role ?? "").trim() !== "user") continue;
      const createdAt = String(msg.created_at ?? "").trim();
      const ts = new Date(createdAt).getTime();
      if (Number.isFinite(ts)) return ts;
    }
    return null;
  }, [messagesQuery.data]);
  const manualReplyWindowExpired =
    lastUserMessageAt != null && Date.now() - lastUserMessageAt > WHATSAPP_REPLY_WINDOW_MS;
  const stopBotDisabled = Boolean(selected && !selected.isPaused && manualReplyWindowExpired);
  const stopBotDisabledText = selected
    ? t.windowExpired(selected.phone || t.leadPhoneFallback)
    : "";

  const emptyMessage = normalizedFilter
    ? t.emptyFilter
    : isZoeAdminAllConversationsSlug(slug)
      ? t.emptyAdmin
      : isMarketingConversationsSlug(slug)
        ? t.emptyMarketing
        : t.emptyBusiness;

  return (
    <div className="space-y-6" dir={dashboardDir(lang)}>
      <div className="hz-wave hz-wave-1">
        <h1 className={`text-2xl font-semibold text-zinc-900 ${textAlignClass}`}>{t.pageTitle(slug)}</h1>
        <p className={`text-sm text-zinc-600 ${textAlignClass}`}>{t.pageSubtitle}</p>
      </div>

      <div className="hz-wave hz-wave-2 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] overflow-x-hidden">
      <div className="space-y-2 rounded-2xl border border-[rgba(113,51,218,0.1)] bg-white p-3 max-h-[520px] overflow-y-auto overflow-x-hidden">
        {normalizedFilter ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-[rgba(113,51,218,0.12)] bg-[#faf7ff] px-3 py-2">
            <p className={`text-xs text-zinc-700 ${textAlignClass}`}>
              {t.filteredBy}{" "}
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
            className={`w-full ${textAlignClass} rounded-xl border px-3 py-2 flex items-center justify-between ${
              selectedId === s.session_id
                ? "border-[rgba(113,51,218,0.35)] bg-[#f0eaff]"
                : "border-[rgba(113,51,218,0.1)] bg-white hover:bg-[#faf7ff]"
            }`}
          >
            <div className={textAlignClass}>
              <p className="text-xs text-zinc-500">{sessionLeadName(s) ? t.leadLabel : t.phoneLabel}</p>
              <button
                type="button"
                onClick={() => setSelectedId((prev) => (prev === s.session_id ? null : s.session_id))}
                onPointerDown={() => void prefetchMessages(s.session_id)}
                className="text-sm font-medium text-zinc-900 truncate max-w-[220px] underline underline-offset-4 decoration-zinc-300 hover:decoration-zinc-500"
              >
                {sessionLeadName(s) || sessionPhoneDisplay(s, t.unavailable)}
              </button>
              {sessionLeadName(s) ? (
                <p className="text-[11px] text-zinc-600">{sessionPhoneDisplay(s, t.unavailable)}</p>
              ) : null}
              <p className="text-[11px] text-zinc-500">
                {s.source_name ? (
                  <span className="block text-[10px] text-[#7133da]">{s.source_name}</span>
                ) : null}
                {t.messagesMeta(s.count, formatDmy(s.lastAt))}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <SessionContactStatusBadge statusKey={s.contactStatus} lang={lang} />
              {s.isPaused && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                  {t.botPaused}
                </span>
              )}
            </div>
          </div>
        ))}
        {visibleSessions.length === 0 && (
          <p className={`text-xs text-zinc-500 ${textAlignClass}`}>{emptyMessage}</p>
        )}
      </div>

      <div className={`rounded-2xl border border-[rgba(113,51,218,0.1)] bg-white p-3 flex flex-col gap-2 ${textAlignClass} overflow-x-hidden min-w-0`}>
        {selected ? (
          <>
            <div className="flex items-center justify-between mb-2">
              <div className={textAlignClass}>
                {sessionLeadName(selected) ? (
                  <>
                    <p className="text-xs text-zinc-500">{t.leadLabel}</p>
                    <p className="text-sm font-medium text-zinc-900">{sessionLeadName(selected)}</p>
                    <p className="text-[11px] text-zinc-600">{sessionPhoneDisplay(selected, t.unavailable)}</p>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-zinc-500">{t.phoneLabel}</p>
                    <p className="text-sm font-medium text-zinc-900">{sessionPhoneDisplay(selected, t.unavailable)}</p>
                  </>
                )}
                <p className="text-[11px] text-zinc-500">
                  {t.messagesMeta(selected.count, formatDmy(selected.lastAt))}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (stopBotDisabled) return;
                  void toggleBot(selected.session_id, !selected.isPaused);
                }}
                disabled={pausing === selected.session_id || stopBotDisabled}
                title={stopBotDisabled ? stopBotDisabledText : undefined}
                className={`rounded-full px-3 py-1 text-[11px] font-medium border ${
                  selected.isPaused
                    ? "border-emerald-400 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                    : "border-red-400 bg-red-50 text-red-800 hover:bg-red-100"
                } disabled:opacity-50`}
              >
                {pausing === selected.session_id
                  ? t.processing
                  : selected.isPaused
                  ? t.resumeBot
                  : t.pauseBot}
              </button>
            </div>
            {stopBotDisabled ? (
              <p className={`mb-2 ${textAlignClass} text-[11px] leading-relaxed text-amber-700`}>
                {stopBotDisabledText}
              </p>
            ) : null}

            <div
              id="hz-convo-messages"
              className="flex-1 rounded-xl border border-[#d1d7db] bg-[#e5ddd5] p-3 max-h-72 overflow-y-auto overflow-x-hidden"
            >
              {(messagesQuery.data ?? []).map((m, idx) => (
                <WaConversationMessage
                  key={`${m.created_at}-${idx}`}
                  role={m.role}
                  content={m.content}
                  createdAt={m.created_at}
                  errorCode={m.error_code}
                  modelUsed={m.model_used}
                  lang={lang}
                />
              ))}
            </div>

            {selected.isPaused && (
              <div className="mt-2 space-y-2">
                <textarea
                  className={`w-full rounded-xl border border-zinc-300 p-2 text-sm ${textAlignClass} ${placeholderAlignClass}`}
                  rows={3}
                  placeholder={t.manualPlaceholder}
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                />
                <button
                  type="button"
                  onClick={sendManual}
                  disabled={sending || !manualText.trim()}
                  className="w-full rounded-xl px-4 py-2 text-sm font-medium text-white disabled:opacity-50 bg-[#128c7e] hover:bg-[#0f7a6e]"
                >
                  {sending ? t.sending : t.sendManual}
                </button>
              </div>
            )}
            {!selected.isPaused && (
              <p className="mt-2 text-[11px] text-zinc-500">{t.pauseHint}</p>
            )}
          </>
        ) : (
          <p className="text-xs text-zinc-500">{t.selectConversation}</p>
        )}
      </div>
      </div>
    </div>
  );
}

