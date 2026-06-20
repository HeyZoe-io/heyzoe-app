"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, MoreVertical, Search, Send } from "lucide-react";
import { getContactStatusMeta, type ContactStatusKey } from "@/lib/contact-status";
import { parseConversationMessageContent } from "@/lib/conversation-message-display";
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
    selectConversation: "בחרו שיחה מהרשימה מימין כדי לצפות בהודעות.",
    searchPlaceholder: "חיפוש לפי שם או מספר…",
    chatsTitle: "שיחות",
    emptyChatTitle: "שמרו על קשר עם הלקוחות",
    emptyChatSubtitle: "בחרו שיחה מהרשימה כדי לצפות בהודעות, לעצור את הבוט או לשלוח מענה ידני.",
    messageCount: (n: number) => `${n} הודעות`,
    backToList: "חזרה לרשימה",
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
    selectConversation: "Select a conversation from the list on the right to view messages.",
    searchPlaceholder: "Search by name or number…",
    chatsTitle: "Chats",
    emptyChatTitle: "Keep in touch with your customers",
    emptyChatSubtitle: "Select a chat from the list to view messages, pause the bot, or send a manual reply.",
    messageCount: (n: number) => `${n} messages`,
    backToList: "Back to list",
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
const MESSAGES_STALE_MS = 180000;
const PREFETCH_TOP_N = 10;

function sessionLeadName(session: { fullName?: string | null }): string {
  return String(session.fullName ?? "").trim();
}

function sessionPhoneDisplay(session: { phone?: string }, unavailable: string): string {
  return String(session.phone ?? "").trim() || unavailable;
}

const AVATAR_COLORS = [
  "bg-[#25D366] text-white",
  "bg-[#128C7E] text-white",
  "bg-[#34B7F1] text-white",
  "bg-[#7F66FF] text-white",
  "bg-[#E91E63] text-white",
  "bg-[#FF9800] text-white",
];

function avatarColorClass(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash + seed.charCodeAt(i) * (i + 1)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[hash] ?? AVATAR_COLORS[0];
}

function avatarInitials(session: { fullName?: string | null; phone?: string }): string {
  const name = sessionLeadName(session);
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  const phone = String(session.phone ?? "").replace(/\D/g, "");
  return phone.slice(-2) || "?";
}

function messagePreviewText(content: string): string {
  const parsed = parseConversationMessageContent(content);
  if (parsed.kind === "text") return parsed.text.trim();
  if (parsed.kind === "interactive") return parsed.text.trim() || parsed.buttons[0]?.label || "";
  if (parsed.kind === "media") return parsed.caption?.trim() || (parsed.isVideo ? "🎥 וידאו" : "📷 תמונה");
  return "";
}

function truncatePreview(text: string, max = 52): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function SessionAvatar({ session }: { session: { fullName?: string | null; phone?: string; session_id: string } }) {
  const seed = sessionLeadName(session) || session.phone || session.session_id;
  return (
    <div
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-medium ${avatarColorClass(seed)}`}
      aria-hidden
    >
      {avatarInitials(session)}
    </div>
  );
}

function SessionContactStatusDot({
  statusKey,
  lang,
}: {
  statusKey: ContactStatusKey | null | undefined;
  lang: DashboardLang;
}) {
  if (!statusKey) return null;
  const meta = getContactStatusMeta(lang)[statusKey];
  return (
    <span
      className={`inline-flex max-w-full truncate rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight ${meta.badgeClass}`}
      title={meta.tooltip}
    >
      {meta.label}
    </span>
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
  const [searchQuery, setSearchQuery] = useState("");
  const [isDesktop, setIsDesktop] = useState(true);
  const [lastMessagePreview, setLastMessagePreview] = useState<Record<string, string>>({});

  function normalizePhoneForMatch(raw: string): string {
    const digits = String(raw ?? "").replace(/\D/g, "");
    if (!digits) return "";
    if (digits.startsWith("972") && digits.length >= 12) {
      const local = digits.slice(3);
      return local.startsWith("0") ? local : `0${local}`;
    }
    if (digits.startsWith("0")) return digits;
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
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? list.filter((s) => {
          const name = sessionLeadName(s).toLowerCase();
          const phone = sessionPhoneDisplay(s, "").toLowerCase();
          return name.includes(q) || phone.includes(q);
        })
      : list;
    return sortSessionsByRecentActivity(filtered);
  }, [sessions, normalizedFilter, searchQuery]);

  const selected = visibleSessions.find((s) => s.session_id === selectedId) ?? null;

  function slugForSession(sessionId: string): string {
    const sess = visibleSessions.find((s) => s.session_id === sessionId);
    return (sess?.source_slug ?? slug).trim().toLowerCase();
  }

  const messagesSlug = selectedId ? slugForSession(selectedId) : slug.trim().toLowerCase();

  const fetchConversationMessages = useCallback(
    async (sessionSlug: string, sessionId: string, signal?: AbortSignal): Promise<SessionMessage[]> => {
      const res = await fetch(
        `${apiPrefix}/conversation-messages?slug=${encodeURIComponent(sessionSlug)}&session_id=${encodeURIComponent(sessionId)}`,
        { signal }
      );
      if (!res.ok) throw new Error(`failed_to_load_conversation_messages:${res.status}`);
      const j = (await res.json()) as { messages?: SessionMessage[] };
      return (j.messages ?? []) as SessionMessage[];
    },
    [apiPrefix]
  );

  const prefetchMessages = useCallback(
    (sessionId: string, sessionSlug: string) => {
      const sid = String(sessionId ?? "").trim();
      const prefetchSlug = String(sessionSlug || slug).trim().toLowerCase();
      if (!sid || !prefetchSlug) return;
      void queryClient.prefetchQuery({
        queryKey: [queryScope, "conversation_messages", prefetchSlug, sid],
        queryFn: ({ signal }) => fetchConversationMessages(prefetchSlug, sid, signal),
        staleTime: MESSAGES_STALE_MS,
      });
    },
    [queryClient, queryScope, fetchConversationMessages, slug]
  );

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
    queryFn: ({ signal }) => fetchConversationMessages(messagesSlug, selectedId ?? "", signal),
    staleTime: MESSAGES_STALE_MS,
  });

  const prefetchedSessionsRef = useRef(new Set<string>());

  useEffect(() => {
    for (const s of visibleSessions.slice(0, PREFETCH_TOP_N)) {
      if (prefetchedSessionsRef.current.has(s.session_id)) continue;
      prefetchedSessionsRef.current.add(s.session_id);
      prefetchMessages(s.session_id, s.source_slug ?? slug);
    }
  }, [visibleSessions, slug, prefetchMessages]);

  function formatDmy(value: string): string {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat(dashboardDateLocale(lang), {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  }

  function formatListTime(value: string): string {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return new Intl.DateTimeFormat(dashboardDateLocale(lang), {
        hour: "2-digit",
        minute: "2-digit",
      }).format(d);
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      d.getFullYear() === yesterday.getFullYear() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getDate() === yesterday.getDate();
    if (isYesterday) return lang === "he" ? "אתמול" : "Yesterday";
    return new Intl.DateTimeFormat(dashboardDateLocale(lang), {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }).format(d);
  }

  function sessionDisplayTitle(session: SessionSummary): string {
    return sessionLeadName(session) || sessionPhoneDisplay(session, t.unavailable);
  }

  function sessionPreviewLine(session: SessionSummary): string {
    const cached = lastMessagePreview[session.session_id];
    if (cached) return cached;
    return t.messageCount(session.count);
  }

  const selectedScrollKey = `${selected?.session_id ?? ""}:${messagesQuery.data?.length ?? 0}`;

  useEffect(() => {
    try {
      const mq = window.matchMedia?.("(min-width: 768px)");
      const apply = () => setIsDesktop(mq?.matches ?? true);
      apply();
      mq?.addEventListener?.("change", apply);
      if (mq?.matches && !selectedId) setSelectedId(initialSessions[0]?.session_id ?? null);
      return () => mq?.removeEventListener?.("change", apply);
    } catch {
      /* noop */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId || !messagesQuery.data?.length) return;
    const last = messagesQuery.data[messagesQuery.data.length - 1];
    const preview = truncatePreview(messagePreviewText(String(last?.content ?? "")));
    if (!preview) return;
    setLastMessagePreview((prev) =>
      prev[selectedId] === preview ? prev : { ...prev, [selectedId]: preview }
    );
  }, [messagesQuery.data, selectedId]);

  useEffect(() => {
    if (!normalizedFilter) return;
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

  const showListPanel = isDesktop || !selectedId;
  const showChatPanel = isDesktop || Boolean(selectedId);
  const messagesLoading = Boolean(selectedId) && messagesQuery.isFetching && messagesQuery.data === undefined;

  return (
    <div dir={dashboardDir(lang)} className="flex h-[calc(100dvh-9.5rem)] min-h-[520px] flex-col">
      {/* dir=rtl keeps chat list on the right and chat pane on the left (WhatsApp Web RTL) */}
      <div
        dir="rtl"
        className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-[#e9edef] bg-white shadow-[0_2px_8px_rgba(11,20,26,0.08)]"
      >
        {showListPanel ? (
          <aside
            dir={dashboardDir(lang)}
            className="flex w-full shrink-0 flex-col border-[#e9edef] bg-white md:w-[380px] md:border-e"
          >
            <header className="flex h-[59px] shrink-0 items-center justify-between bg-[#f0f2f5] px-4">
              <h2 className="text-[19px] font-normal text-[#111b21]">{t.chatsTitle}</h2>
              <button
                type="button"
                className="rounded-full p-2 text-[#54656f] hover:bg-[#e9edef]"
                aria-label={t.searchPlaceholder}
              >
                <MoreVertical className="h-5 w-5" aria-hidden />
              </button>
            </header>

            <div className="shrink-0 bg-white px-3 pb-2 pt-3">
              <div className="flex items-center gap-3 rounded-lg bg-[#f0f2f5] px-3 py-[7px]">
                <Search className="h-[18px] w-[18px] shrink-0 text-[#54656f]" aria-hidden />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t.searchPlaceholder}
                  className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-[#111b21] placeholder:text-[#667781] focus:outline-none"
                  dir={dashboardDir(lang)}
                />
              </div>
            </div>

            {normalizedFilter ? (
              <div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-lg border border-[#d1d7db] bg-[#f0f2f5] px-3 py-2">
                <p className={`min-w-0 truncate text-xs text-[#54656f] ${textAlignClass}`}>
                  {t.filteredBy}{" "}
                  <span className="font-medium text-[#111b21]">{phoneParam}</span>
                </p>
                <button
                  type="button"
                  onClick={clearPhoneFilter}
                  className="shrink-0 rounded-full px-2 py-0.5 text-xs text-[#54656f] hover:bg-[#e9edef]"
                >
                  ✕
                </button>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
              {visibleSessions.map((s) => {
                const active = selectedId === s.session_id;
                const hasName = Boolean(sessionLeadName(s));
                const phone = sessionPhoneDisplay(s, t.unavailable);
                const title = hasName ? sessionLeadName(s) : phone;
                return (
                  <button
                    key={s.session_id}
                    type="button"
                    onClick={() => setSelectedId(s.session_id)}
                    onMouseEnter={() => prefetchMessages(s.session_id, s.source_slug ?? slug)}
                    onFocus={() => prefetchMessages(s.session_id, s.source_slug ?? slug)}
                    onPointerDown={() => prefetchMessages(s.session_id, s.source_slug ?? slug)}
                    className={`flex w-full items-center gap-3 border-b border-[#f0f2f5] px-3 py-3 transition-colors hover:bg-[#f5f6f6] ${
                      active ? "bg-[#f0f2f5]" : "bg-white"
                    }`}
                  >
                    <SessionAvatar session={s} />
                    <div className={`min-w-0 flex-1 ${textAlignClass}`}>
                      <p className="truncate text-[17px] leading-tight text-[#111b21]">{title}</p>
                      <p className="mt-0.5 truncate text-[14px] text-[#667781]">
                        {hasName ? (
                          <span dir="ltr" className="inline-block">
                            {phone}
                          </span>
                        ) : (
                          sessionPreviewLine(s)
                        )}
                      </p>
                      {hasName ? (
                        <p className="mt-0.5 truncate text-[13px] text-[#8696a0]">{sessionPreviewLine(s)}</p>
                      ) : null}
                      {s.source_name ? (
                        <p className="mt-0.5 truncate text-[11px] text-[#25D366]">{s.source_name}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 self-start pt-0.5">
                      <span className="text-[12px] text-[#667781]">{formatListTime(s.lastAt)}</span>
                      <SessionContactStatusDot statusKey={s.contactStatus} lang={lang} />
                      {s.isPaused ? (
                        <span className="text-[10px] font-medium text-amber-700">{t.botPaused}</span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
              {visibleSessions.length === 0 ? (
                <p className={`px-4 py-6 text-sm text-[#667781] ${textAlignClass}`}>{emptyMessage}</p>
              ) : null}
            </div>
          </aside>
        ) : null}

        {showChatPanel ? (
          <section dir={dashboardDir(lang)} className="flex min-w-0 flex-1 flex-col bg-[#f0f2f5]">
            {selected ? (
              <>
                <header className="flex h-[59px] shrink-0 items-center justify-between gap-3 border-b border-[#e9edef] bg-[#f0f2f5] px-3 md:px-4">
                  <div className="flex min-w-0 items-center gap-3">
                    {!isDesktop ? (
                      <button
                        type="button"
                        onClick={() => setSelectedId(null)}
                        className="rounded-full p-2 text-[#54656f] hover:bg-[#e9edef]"
                        aria-label={t.backToList}
                      >
                        <ArrowRight className="h-5 w-5" aria-hidden />
                      </button>
                    ) : null}
                    <SessionAvatar session={selected} />
                    <div className={`min-w-0 ${textAlignClass}`}>
                      <p className="truncate text-[16px] text-[#111b21]">{sessionDisplayTitle(selected)}</p>
                      <p className="truncate text-[13px] text-[#667781]">
                        {sessionLeadName(selected) ? (
                          <span dir="ltr" className="inline-block">
                            {sessionPhoneDisplay(selected, t.unavailable)}
                          </span>
                        ) : (
                          t.messagesMeta(selected.count, formatDmy(selected.lastAt))
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (stopBotDisabled) return;
                      void toggleBot(selected.session_id, !selected.isPaused);
                    }}
                    disabled={pausing === selected.session_id || stopBotDisabled}
                    title={stopBotDisabled ? stopBotDisabledText : undefined}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50 ${
                      selected.isPaused
                        ? "bg-[#25D366] text-white hover:bg-[#20bd5a]"
                        : "border border-[#ea0038] bg-white text-[#ea0038] hover:bg-[#fff5f5]"
                    }`}
                  >
                    {pausing === selected.session_id
                      ? t.processing
                      : selected.isPaused
                        ? t.resumeBot
                        : t.pauseBot}
                  </button>
                </header>

                {stopBotDisabled ? (
                  <p className={`shrink-0 bg-[#fff8e6] px-4 py-2 text-[12px] leading-relaxed text-amber-800 ${textAlignClass}`}>
                    {stopBotDisabledText}
                  </p>
                ) : null}

                <div
                  id="hz-convo-messages"
                  className="wa-chat-wallpaper min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-[4%] py-3 md:px-[6%]"
                >
                  {messagesLoading ? (
                    <div className="flex animate-pulse flex-col gap-3" aria-hidden>
                      <div className="flex w-full justify-end">
                        <div className="h-12 w-52 rounded-lg rounded-br-none bg-white/80" />
                      </div>
                      <div className="flex w-full justify-start">
                        <div className="h-16 w-64 rounded-lg rounded-bl-none bg-[#d9fdd3]/80" />
                      </div>
                      <div className="flex w-full justify-end">
                        <div className="h-10 w-40 rounded-lg rounded-br-none bg-white/80" />
                      </div>
                    </div>
                  ) : (
                    (messagesQuery.data ?? []).map((m, idx) => (
                      <WaConversationMessage
                        key={`${m.created_at}-${idx}`}
                        role={m.role}
                        content={m.content}
                        createdAt={m.created_at}
                        errorCode={m.error_code}
                        modelUsed={m.model_used}
                        lang={lang}
                      />
                    ))
                  )}
                </div>

                {selected.isPaused ? (
                  <footer className="shrink-0 border-t border-[#e9edef] bg-[#f0f2f5] px-3 py-2 md:px-4">
                    <div className="flex items-end gap-2">
                      <div className="min-w-0 flex-1 rounded-lg bg-white px-3 py-2 shadow-sm">
                        <textarea
                          className={`max-h-32 min-h-[42px] w-full resize-none border-0 bg-transparent text-[15px] text-[#111b21] focus:outline-none ${textAlignClass} ${placeholderAlignClass}`}
                          rows={1}
                          placeholder={t.manualPlaceholder}
                          value={manualText}
                          onChange={(e) => setManualText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              void sendManual();
                            }
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => void sendManual()}
                        disabled={sending || !manualText.trim()}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white transition-opacity hover:bg-[#20bd5a] disabled:opacity-40"
                        aria-label={t.sendManual}
                      >
                        <Send className="h-5 w-5" aria-hidden />
                      </button>
                    </div>
                  </footer>
                ) : (
                  <p className={`shrink-0 border-t border-[#e9edef] bg-[#f0f2f5] px-4 py-2.5 text-[12px] text-[#667781] ${textAlignClass}`}>
                    {t.pauseHint}
                  </p>
                )}
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center border-b border-[#e9edef] bg-[#f0f2f5] px-6 text-center">
                <div className="mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-[#e9edef]">
                  <svg viewBox="0 0 24 24" className="h-12 w-12 text-[#25D366]" aria-hidden>
                    <path
                      fill="currentColor"
                      d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.33 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2m.01 1.67c2.2 0 4.26.86 5.82 2.42a8.183 8.183 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23-1.48 0-2.93-.39-4.19-1.15l-.3-.17-3.12.82.83-3.04-.2-.32a8.233 8.233 0 0 1-1.26-4.38c.01-4.54 3.7-8.24 8.25-8.24"
                    />
                  </svg>
                </div>
                <h3 className="text-[32px] font-light text-[#41525d]">{t.emptyChatTitle}</h3>
                <p className="mt-3 max-w-md text-[14px] leading-relaxed text-[#667781]">{t.emptyChatSubtitle}</p>
                <p className="sr-only">{t.selectConversation}</p>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
