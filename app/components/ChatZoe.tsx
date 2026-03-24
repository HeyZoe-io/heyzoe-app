'use client';

/**
 * ChatZoe — צ'אט עם זואי
 * - מעבר פוקוס: לחיצה על שאלה מדהה את האחרות, השאלה הנבחרת עולה לראש (Framer Motion layout).
 * - תשובת העוזרת האחרונה מוחלפת בכל סיבוב (לא מצטברות בועות assistant).
 * - שאלות המשך: מסתירות את השאלה שזה עתה נשלחה.
 * - אפקט מכונת כתיבה: אות אחרי אות (מסונכרן לסטרים).
 * - הצעות תחתיות בסשן: רק אחרי שהתשובה מתחילה להופיע.
 * - עיצוב: כהה מינימליסטי עם גרדיאנט ורוד–סגול (#ff85cf → #bc74e9).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { usePathname } from 'next/navigation';
import {
  AnimatePresence,
  LayoutGroup,
  motion,
} from 'framer-motion';
import {
  formatUserFacingGeminiError,
  friendlyHttpErrorMessage,
} from '@/lib/gemini';
import { CHAT_STREAM_META, stripMarkdownDecorations } from '@/lib/zoe-shared';

/** מניעת שליחות כפולות מהירות (לחיצה כפולה / Enter+לחיצה) */
const DEDUPE_WINDOW_MS = 2200;

const DEFAULT_FOLLOWUPS = [
  'איפה אתם?',
  'מה המחיר?',
  'למי זה מתאים?',
  'איך נרשמים?',
] as const;

/** כפתור CTA — גרדיאנט בזווית קבועה + flex כדי שטקסט עברי יישב נכון ב-RTL */
const CTA_PRIMARY_CLASS =
  'flex w-full min-h-[3.25rem] items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-[15px] md:text-base font-semibold text-white shadow-lg shadow-fuchsia-500/20 hover:opacity-95 transition-opacity';

/** כפתור משני (שלח / נסו שוב) */
const CTA_COMPACT_CLASS =
  'inline-flex min-h-[2.75rem] min-w-[4.5rem] shrink-0 items-center justify-center rounded-2xl px-5 py-3 text-sm font-semibold text-white disabled:opacity-45 transition-opacity';

/** משך תנועת הפוקוס (~0.4s) */
const MOVE = { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const };
const FADE = { duration: 0.28, ease: [0.4, 0, 0.2, 1] as const };

type BusinessSnapshot = {
  slug: string;
  name: string;
  bot_name: string;
  service_name: string;
  address: string;
  trial_class: string;
  cta_text: string | null;
  cta_link: string | null;
  primary_color: string;
  secondary_color: string;
};

function ensureFourFollowUps(fu: string[]): string[] {
  const out = fu.map((s) => s.trim()).filter(Boolean).slice(0, 4);
  for (const d of DEFAULT_FOLLOWUPS) {
    if (out.length >= 4) break;
    if (!out.includes(d)) out.push(d);
  }
  return out.slice(0, 4);
}

function newId() {
  return crypto.randomUUID();
}

const SESSION_KEY = "heyzoe_session_id";

function ensureSessionId(): string {
  if (typeof window === "undefined") return crypto.randomUUID();
  const existing = window.localStorage.getItem(SESSION_KEY)?.trim();
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(SESSION_KEY, created);
  return created;
}

function visibleChatPart(buffer: string) {
  const i = buffer.indexOf(CHAT_STREAM_META);
  return i >= 0 ? buffer.slice(0, i) : buffer;
}

function parseStreamMeta(buffer: string): { cta_text: string | null; cta_link: string | null } {
  const i = buffer.indexOf(CHAT_STREAM_META);
  if (i < 0) return { cta_text: null, cta_link: null };
  try {
    const j = JSON.parse(buffer.slice(i + CHAT_STREAM_META.length)) as Record<string, unknown>;
    return {
      cta_text: (j.cta_text as string)?.trim() || null,
      cta_link: (j.cta_link as string)?.trim() || null,
    };
  } catch {
    return { cta_text: null, cta_link: null };
  }
}

type AssistantMessage = {
  id: string;
  role: 'assistant';
  content: string;
  ctaText: string | null;
  ctaLink: string | null;
  followUps: string[];
  pending?: boolean;
  showActions?: boolean;
};
type UserMessage = { id: string; role: 'user'; content: string };
type ChatMessage = UserMessage | AssistantMessage;

function isAssistant(m: ChatMessage): m is AssistantMessage {
  return m.role === 'assistant';
}

function removeLatestAssistantReply(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= 1) return messages;
  const last = messages[messages.length - 1];
  if (isAssistant(last)) return messages.slice(0, -1);
  return messages;
}

function filterFollowUpsForActiveQuestion(followUps: string[], activeQuestion: string): string[] {
  const q = activeQuestion.trim();
  if (!q) return followUps;
  return followUps.filter((item) => item.trim() !== q);
}

/** מכונת כתיבה: חשיפת תו אחד בכל פעם לכיוון target (עומד בקצב סטרים). */
const TYPEWRITER_MS = 20;

function useRevealToTarget(target: string, messageKey: string | undefined) {
  const [n, setN] = useState(0);

  useEffect(() => {
    queueMicrotask(() => setN(0));
  }, [messageKey]);

  useEffect(() => {
    if (!messageKey || target.length === 0) return;
    if (n >= target.length) return;
    const t = window.setTimeout(() => setN((x) => Math.min(x + 1, target.length)), TYPEWRITER_MS);
    return () => clearTimeout(t);
  }, [target, n, messageKey]);

  if (!messageKey) return '';
  return target.slice(0, n);
}

export default function ChatZoe({ slug }: { slug: string }) {
  const pathname = usePathname() ?? '';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [followUps, setFollowUps] = useState<string[]>([...DEFAULT_FOLLOWUPS]);
  const [businessSnapshot, setBusinessSnapshot] = useState<BusinessSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootRetryToken, setBootRetryToken] = useState(0);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [lastSubmittedText, setLastSubmittedText] = useState('');
  /**
   * שאלה בלחיצה — לפני sendText, כדי לאפשר יציאה של צ'יפים אחרים ואז מעבר layout לכותרת.
   */
  const [preSendFocus, setPreSendFocus] = useState<string | null>(null);

  const sendTextRef = useRef<(raw: string) => Promise<void>>(async () => {});
  /** מונע שני fetch bootstrap במקביל (למשל React Strict Mode) */
  const bootstrapAbortRef = useRef<AbortController | null>(null);
  /** מונע שני שליחות לצ'אט לפני ש־loading מתעדכן */
  const chatInFlightRef = useRef(false);
  const lastSendRef = useRef<{ text: string; at: number } | null>(null);

  useEffect(() => {
    setSessionId(ensureSessionId());
  }, []);

  const primaryColor = businessSnapshot?.primary_color || "#ff85cf";
  const secondaryColor = businessSnapshot?.secondary_color || "#bc74e9";
  const gradientStyle = {
    backgroundImage: `linear-gradient(105deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
  };

  useEffect(() => {
    let cancelled = false;
    bootstrapAbortRef.current?.abort();
    const ac = new AbortController();
    bootstrapAbortRef.current = ac;

    setReady(false);
    setBootError(null);

    async function bootstrap() {
      let showedQuickUi = false;
      const sid = sessionId || ensureSessionId();
      try {
        const quickRes = await fetch(
          `/api/business/quick?slug=${encodeURIComponent(slug)}`,
          { signal: ac.signal }
        );
        if (!cancelled && !ac.signal.aborted && quickRes.ok) {
          const q = (await quickRes.json()) as Record<string, unknown>;
          const name = typeof q.name === 'string' ? q.name.trim() : '';
          const botName =
            typeof q.bot_name === "string" && q.bot_name.trim() ? q.bot_name.trim() : "זואי";
          const instantWelcome =
            (typeof q.welcome === "string" && q.welcome.trim()) ||
            `שלום, כאן ${botName} מ־${name || 'העסק'}. במה אוכל לעזור?`;
          const fu = [...DEFAULT_FOLLOWUPS];
          const ctaOk = q.cta_text && q.cta_link;
          setBusinessSnapshot({
            slug,
            name,
            bot_name: botName,
            service_name: (typeof q.service_name === 'string' && q.service_name.trim()) || name,
            address: typeof q.address === 'string' ? q.address : '',
            trial_class: typeof q.trial_class === 'string' ? q.trial_class : '',
            cta_text: ctaOk ? (q.cta_text as string) : null,
            cta_link: ctaOk ? (q.cta_link as string) : null,
            primary_color: (typeof q.primary_color === "string" && q.primary_color.trim()) || "#ff85cf",
            secondary_color: (typeof q.secondary_color === "string" && q.secondary_color.trim()) || "#bc74e9",
          });
          setFollowUps(fu);
          setMessages([
            {
              id: newId(),
              role: 'assistant',
              content: instantWelcome,
              ctaText: ctaOk ? (q.cta_text as string) : null,
              ctaLink: ctaOk ? (q.cta_link as string) : null,
              followUps: fu,
              showActions: true,
            },
          ]);
          setReady(true);
          showedQuickUi = true;
        }

        const res = await fetch(`/api/business?slug=${encodeURIComponent(slug)}&session_id=${encodeURIComponent(sid)}`, {
          signal: ac.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled || ac.signal.aborted) return;

        if (!res.ok) {
          if (!showedQuickUi) {
            const payload = data as { error?: string; missing?: string[] };
            let msg =
              typeof payload.error === 'string'
                ? payload.error
                : friendlyHttpErrorMessage(res.status);
            if (Array.isArray(payload.missing) && payload.missing.length > 0) {
              msg = `${msg}\n\nחסר: ${payload.missing.join(' · ')}`;
            }
            setBusinessSnapshot(null);
            setMessages([]);
            setBootError(msg);
          }
          return;
        }

        const name = (data.name as string)?.trim() || '';
        const welcome = (data.welcome as string)?.trim();
        const rawFollowups = (data.followups as string[]) || [];
        if (!welcome) {
          if (!showedQuickUi) {
            setBusinessSnapshot(null);
            setMessages([]);
            setBootError('לא התקבלה ברכה מהשרת. נסו שוב.');
          }
          return;
        }

        const followups = ensureFourFollowUps(rawFollowups);
        const ctaOk = data.cta_text && data.cta_link;

        setBusinessSnapshot({
          slug,
          name,
          bot_name: ((data.bot_name as string) || "זואי").trim() || "זואי",
          service_name: (data.service_name as string) || name,
          address: (data.address as string) || '',
          trial_class: (data.trial_class as string) || '',
          cta_text: ctaOk ? data.cta_text : null,
          cta_link: ctaOk ? data.cta_link : null,
          primary_color: ((data.primary_color as string) || "#ff85cf").trim() || "#ff85cf",
          secondary_color: ((data.secondary_color as string) || "#bc74e9").trim() || "#bc74e9",
        });
        setFollowUps(followups);
        setMessages([
          {
            id: newId(),
            role: 'assistant',
            content: welcome,
            ctaText: ctaOk ? data.cta_text : null,
            ctaLink: ctaOk ? data.cta_link : null,
            followUps: followups,
            showActions: true,
          },
        ]);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        console.error('Bootstrap:', e);
        if (!cancelled && !ac.signal.aborted && !showedQuickUi) {
          setBusinessSnapshot(null);
          setMessages([]);
          setBootError('לא הצלחנו לטעון את העמוד. בדקו חיבור ונסו שוב.');
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [slug, bootRetryToken, sessionId]);

  const retryBootstrap = useCallback(() => {
    setBootError(null);
    setReady(false);
    setBootRetryToken((n) => n + 1);
  }, []);

  const patchAssistant = useCallback((patch: Partial<AssistantMessage> & { id: string }) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === patch.id && isAssistant(m) ? { ...m, ...patch } : m))
    );
  }, []);

  const sendText = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || loading || chatInFlightRef.current) return;

      const now = Date.now();
      const prev = lastSendRef.current;
      if (prev && prev.text === text && now - prev.at < DEDUPE_WINDOW_MS) {
        return;
      }
      lastSendRef.current = { text, at: now };

      chatInFlightRef.current = true;
      setInput('');
      setLastSubmittedText(text);

      const pendingId = newId();

      flushSync(() => {
        setMessages((prevMsgs) => {
          const trimmed = removeLatestAssistantReply(prevMsgs);
          return [...trimmed, { id: newId(), role: 'user', content: text }];
        });
        setPreSendFocus(null);
      });

      setLoading(true);
      setMessages((prev) => [
        ...prev,
        {
          id: pendingId,
          role: 'assistant',
          content: '',
          ctaText: null,
          ctaLink: null,
          followUps,
          pending: true,
          showActions: false,
        },
      ]);

      const failFriendly = (userMessage: string) => {
        patchAssistant({
          id: pendingId,
          content: userMessage,
          pending: false,
          showActions: true,
          ctaText: businessSnapshot?.cta_text || null,
          ctaLink: businessSnapshot?.cta_link || null,
        });
      };

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            slug,
            business: businessSnapshot,
            pathname,
            session_id: sessionId || ensureSessionId(),
          }),
        });

        if (!response.ok) {
          await response.json().catch(() => ({}));
          failFriendly(friendlyHttpErrorMessage(response.status));
          return;
        }

        if (!response.body) {
          failFriendly(friendlyHttpErrorMessage(502));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let acc = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          const display = stripMarkdownDecorations(visibleChatPart(acc));
          patchAssistant({
            id: pendingId,
            content: display,
            pending: display.length === 0,
          });
        }
        acc += decoder.decode();
        const meta = parseStreamMeta(acc);
        const finalText = stripMarkdownDecorations(visibleChatPart(acc));
        patchAssistant({
          id: pendingId,
          content: finalText || formatUserFacingGeminiError(new Error('empty stream')),
          pending: false,
          showActions: true,
          ctaText: meta.cta_text || businessSnapshot?.cta_text || null,
          ctaLink: meta.cta_link || businessSnapshot?.cta_link || null,
        });
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        if (err.name === 'AbortError') {
          patchAssistant({
            id: pendingId,
            content: 'הבקשה בוטלה.',
            pending: false,
            showActions: true,
            ctaText: businessSnapshot?.cta_text || null,
            ctaLink: businessSnapshot?.cta_link || null,
          });
          return;
        }
        const net =
          err.message === 'Failed to fetch' || /network|load failed/i.test(err.message);
        failFriendly(
          net
            ? 'בעיית רשת — בדקו את החיבור ונסו שוב.'
            : formatUserFacingGeminiError(err)
        );
      } finally {
        chatInFlightRef.current = false;
        setLoading(false);
      }
    },
    [loading, slug, pathname, businessSnapshot, followUps, patchAssistant, sessionId]
  );

  useEffect(() => {
    sendTextRef.current = sendText;
  }, [sendText]);

  /** לחיצה על צ'יפ: קודם אנימציה, אחר כך שליחה */
  const onSuggestionPick = useCallback((q: string) => {
    if (loading || preSendFocus) return;
    setPreSendFocus(q);
  }, [loading, preSendFocus]);

  useEffect(() => {
    if (!preSendFocus) return;
    const q = preSendFocus;
    const t = window.setTimeout(() => {
      void sendTextRef.current(q);
    }, 420);
    return () => clearTimeout(t);
  }, [preSendFocus]);

  const welcomeAssistant = useMemo(
    () => messages.find((m) => isAssistant(m)) as AssistantMessage | undefined,
    [messages]
  );

  const lastUser = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i] as UserMessage;
    }
    return null;
  }, [messages]);

  const lastAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (isAssistant(messages[i])) return messages[i] as AssistantMessage;
    }
    return null;
  }, [messages]);

  const inSession = lastUser !== null;

  const displayedAnswer = useRevealToTarget(
    lastAssistant?.content ?? '',
    lastAssistant?.id
  );

  const visibleFollowUpsForMessage = useCallback(
    (m: AssistantMessage) => filterFollowUpsForActiveQuestion(m.followUps, lastSubmittedText),
    [lastSubmittedText]
  );

  const exploreFollowUps = welcomeAssistant?.followUps ?? followUps;
  const sessionBottomFollowUps = lastAssistant
    ? visibleFollowUpsForMessage(lastAssistant)
    : [];

  /** הצעות תחתית רק אחרי שהתשובה מתחילה להופיע (אות ראשון במכונת הכתיבה) */
  const showSessionBottomChips =
    inSession &&
    sessionBottomFollowUps.length > 0 &&
    displayedAnswer.length >= 1;

  const shellClass = useMemo(
    () =>
      `flex flex-col h-full w-full max-w-lg mx-auto rounded-2xl md:rounded-3xl overflow-hidden border border-white/10 bg-gradient-to-b from-[#1a1025]/95 via-[#120c18] to-[#0a070d] shadow-[0_24px_80px_rgba(188,116,233,0.12)]`,
    []
  );

  const headerQuestionText = inSession ? lastUser!.content : null;
  /** בזמן בחירת שאלה חדשה מהתחתית — הכותרת מציגה את השאלה הנוכחית בלי layoutId כדי לא להתנגש עם הצ'יפ הנע */
  const headerSharesLayoutId =
    !preSendFocus || preSendFocus === lastUser?.content;

  const chipSurfaceClass =
    'w-full text-start rounded-xl border-[0.5px] border-white/15 bg-white/5 text-neutral-100 text-[15px] font-medium leading-snug py-3 px-4 hover:bg-white/10 disabled:opacity-45';

  const logCtaClick = useCallback((ctaType: string) => {
    const sid = sessionId || ensureSessionId();
    void fetch("/api/conversions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_slug: slug,
        session_id: sid,
        type: ctaType,
      }),
    }).catch((e) => console.error("[ChatZoe] conversion logging failed:", e));
  }, [sessionId, slug]);

  if (!ready) {
    return (
      <div
        dir="rtl"
        lang="he"
        className={`flex flex-col items-center justify-center min-h-[320px] gap-3 rounded-2xl border border-white/10 bg-[#120c18] text-white/50`}
      >
        <div
          className="h-9 w-9 rounded-full border-2 border-white/20 border-t-[#ff85cf] animate-spin"
          aria-hidden
        />
        <p className="text-sm">טוענים את זואי…</p>
      </div>
    );
  }

  if (bootError) {
    return (
      <div
        className={`flex flex-col items-center justify-center min-h-[320px] gap-4 px-6 rounded-2xl border border-white/10 bg-[#120c18]`}
        dir="rtl"
        lang="he"
      >
        <p className="text-sm text-neutral-200 max-w-sm leading-relaxed whitespace-pre-line text-start">
          {bootError}
        </p>
        <button
          type="button"
          onClick={retryBootstrap}
          className={CTA_PRIMARY_CLASS}
          style={gradientStyle}
        >
          נסו שוב
        </button>
      </div>
    );
  }

  return (
    <div dir="rtl" lang="he" className={shellClass}>
      <div className="h-1 w-full shrink-0" style={gradientStyle} aria-hidden />

      <LayoutGroup id="chat-zoe-layout">
        <div className="flex flex-1 flex-col min-h-0">
          <div className="flex-1 px-3 py-3 md:px-4 md:py-4 overflow-y-auto min-h-[280px] max-h-[min(70vh,520px)] scroll-smooth flex flex-col gap-4 md:gap-5">
            {/* שאלה נבחרת בראש — לפני כניסה לסשן (אחרי לחיצה על צ'יפ בפתיחה) */}
            <AnimatePresence initial={false} mode="popLayout">
              {!inSession && preSendFocus && (
                <motion.div
                  key="pre-header"
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={MOVE}
                  className="flex justify-end shrink-0"
                >
                  <motion.div
                    layoutId="active-question"
                    transition={MOVE}
                    dir="rtl"
                    lang="he"
                    className={`max-w-[88%] md:max-w-[85%] px-4 py-2.5 rounded-2xl text-[15px] leading-snug text-start text-white bg-white/10 border border-white/15 backdrop-blur-sm`}
                  >
                    {preSendFocus}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* כותרת שאלה נוכחית (בסשן) */}
            <AnimatePresence initial={false} mode="popLayout">
              {inSession && headerQuestionText && (
                <motion.div
                  key={lastUser!.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={MOVE}
                  className="flex justify-end shrink-0"
                >
                  {headerSharesLayoutId ? (
                    <motion.div
                      layoutId="active-question"
                      transition={MOVE}
                      dir="rtl"
                      lang="he"
                      className={`max-w-[88%] md:max-w-[85%] px-4 py-2.5 rounded-2xl text-[15px] leading-snug text-start text-white bg-white/10 border border-white/15 backdrop-blur-sm`}
                    >
                      {headerQuestionText}
                    </motion.div>
                  ) : (
                    <div
                      dir="rtl"
                      lang="he"
                      className={`max-w-[88%] md:max-w-[85%] px-4 py-2.5 rounded-2xl text-[15px] leading-snug text-start text-white bg-white/10 border border-white/15 backdrop-blur-sm`}
                    >
                      {headerQuestionText}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* מסך פתיחה: ברכה + CTA; צ'יפים נפרדים — נעלמים כשבוחרים שאלה (הכותרת למעלה) */}
            <AnimatePresence mode="popLayout" initial={false}>
              {!inSession && welcomeAssistant && !preSendFocus && (
                <motion.div
                  key="explore"
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={FADE}
                  className="flex flex-col gap-4 md:gap-5"
                >
                  <div
                    dir="rtl"
                    lang="he"
                    className="text-[15px] md:text-[16px] leading-relaxed text-start text-neutral-100/95 whitespace-pre-wrap"
                  >
                    {welcomeAssistant.content}
                  </div>

                  {welcomeAssistant.ctaText && welcomeAssistant.ctaLink && (
                    <a
                      href={welcomeAssistant.ctaLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => logCtaClick("cta_click_welcome")}
                      dir="rtl"
                      lang="he"
                      className={CTA_PRIMARY_CLASS}
                      style={gradientStyle}
                    >
                      {welcomeAssistant.ctaText}
                    </a>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {!inSession && welcomeAssistant && !preSendFocus && (
              <div className="flex flex-col gap-2 w-full" dir="rtl">
                <AnimatePresence initial={false} mode="popLayout">
                  {exploreFollowUps.map((q) => (
                    <motion.button
                      key={q}
                      type="button"
                      layout
                      exit={{ opacity: 0, y: 4 }}
                      transition={FADE}
                      disabled={loading || !!preSendFocus}
                      onClick={() => onSuggestionPick(q)}
                      whileTap={{ scale: 0.99 }}
                      className={chipSurfaceClass}
                    >
                      {q}
                    </motion.button>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {/* תשובה + צ'יפים תחתונים (סשן) */}
            {inSession && lastAssistant && (
              <div className="flex flex-col gap-4 flex-1 min-h-0">
                <motion.div
                  layout
                  dir="rtl"
                  lang="he"
                  className="text-[15px] md:text-[16px] leading-relaxed text-start text-neutral-100/95 whitespace-pre-wrap min-h-[1.5rem]"
                >
                  {lastAssistant.pending && displayedAnswer.length === 0 ? (
                    <span className="inline-flex items-center gap-2 justify-end w-full text-white/50 text-sm">
                      <span className="flex gap-1" aria-hidden>
                        <span className="h-1.5 w-1.5 rounded-full bg-[#ff85cf] animate-pulse" />
                        <span className="h-1.5 w-1.5 rounded-full bg-[#bc74e9] animate-pulse [animation-delay:120ms]" />
                        <span className="h-1.5 w-1.5 rounded-full bg-[#ff85cf] animate-pulse [animation-delay:240ms]" />
                      </span>
                      זואי מקלידה…
                    </span>
                  ) : (
                    <>
                      {displayedAnswer}
                      {(lastAssistant.pending || displayedAnswer.length < lastAssistant.content.length) && (
                        <motion.span
                          animate={{ opacity: [1, 0.2, 1] }}
                          transition={{ duration: 0.9, repeat: Infinity }}
                          className="inline-block w-2 h-4 ms-0.5 align-middle bg-gradient-to-b from-[#ff85cf] to-[#bc74e9] rounded-sm"
                          aria-hidden
                        />
                      )}
                    </>
                  )}
                </motion.div>

                {isAssistant(lastAssistant) &&
                  !lastAssistant.pending &&
                  lastAssistant.showActions !== false &&
                  lastAssistant.ctaText &&
                  lastAssistant.ctaLink && (
                    <motion.a
                      layout
                      href={lastAssistant.ctaLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => logCtaClick("cta_click_reply")}
                      dir="rtl"
                      lang="he"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={FADE}
                      className={CTA_PRIMARY_CLASS}
                      style={gradientStyle}
                    >
                      {lastAssistant.ctaText}
                    </motion.a>
                  )}

                <div className="flex flex-col gap-2 w-full mt-auto pt-2" dir="rtl">
                  <AnimatePresence initial={false} mode="popLayout">
                    {showSessionBottomChips &&
                      sessionBottomFollowUps
                        .filter((q) => !preSendFocus || q === preSendFocus)
                        .map((q) => {
                          const isFocus = preSendFocus === q;
                          if (isFocus) {
                            return (
                              <motion.button
                                key={q}
                                type="button"
                                layoutId="active-question"
                                transition={MOVE}
                                disabled
                                className={chipSurfaceClass}
                              >
                                {q}
                              </motion.button>
                            );
                          }
                          return (
                            <motion.button
                              key={q}
                              type="button"
                              layout
                              exit={{ opacity: 0, y: 4 }}
                              disabled={loading || !!preSendFocus}
                              onClick={() => onSuggestionPick(q)}
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ ...FADE, delay: 0.04 }}
                              whileTap={{ scale: 0.99 }}
                              className={chipSurfaceClass}
                            >
                              {q}
                            </motion.button>
                          );
                        })}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>

          <div className="shrink-0 px-3 pb-3 md:px-4 md:pb-4 pt-2 border-t border-white/10" dir="rtl" lang="he">
            <div className="flex flex-row-reverse gap-2 items-stretch">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && void sendText(input)}
                placeholder="הקלידו כאן…"
                className="flex-1 min-w-0 py-3 px-4 rounded-2xl text-[15px] text-start text-white placeholder:text-white/35 bg-white/5 border border-white/15 focus:outline-none focus:ring-2 focus:ring-[#bc74e9]/40"
                dir="rtl"
                lang="he"
                aria-label="הודעה לזואי"
              />
              <button
                type="button"
                onClick={() => void sendText(input)}
                disabled={loading}
                dir="rtl"
                lang="he"
                className={CTA_COMPACT_CLASS}
                style={gradientStyle}
              >
                שלח
              </button>
            </div>
          </div>
        </div>
      </LayoutGroup>
    </div>
  );
}
