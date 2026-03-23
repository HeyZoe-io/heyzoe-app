'use client';

import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { CHAT_STREAM_META, stripMarkdownDecorations } from '@/lib/zoe-shared';

const DEFAULT_FOLLOWUPS = [
  'איפה אתם?',
  'מה המחיר?',
  'למי זה מתאים?',
  'איך נרשמים?',
] as const;

type BusinessSnapshot = {
  slug: string;
  name: string;
  service_name: string;
  address: string;
  trial_class: string;
  cta_text: string | null;
  cta_link: string | null;
};

function ensureFourFollowUps(fu: string[]): string[] {
  const out = fu.map((s) => s.trim()).filter(Boolean).slice(0, 4);
  for (const d of DEFAULT_FOLLOWUPS) {
    if (out.length >= 4) break;
    if (!out.includes(d)) out.push(d);
  }
  return out.slice(0, 4);
}

function newId() { return crypto.randomUUID(); }

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
      cta_link: (j.cta_link as string)?.trim() || null 
    };
  } catch { return { cta_text: null, cta_link: null }; }
}

type AssistantMessage = {
  id: string; role: 'assistant'; content: string;
  ctaText: string | null; ctaLink: string | null;
  followUps: string[]; pending?: boolean; showActions?: boolean;
};
type UserMessage = { id: string; role: 'user'; content: string };
type ChatMessage = UserMessage | AssistantMessage;

function isAssistant(m: ChatMessage): m is AssistantMessage { return m.role === 'assistant'; }

const ctaPremiumClass = 'block w-full text-center bg-[#1a1a1a] text-white rounded-lg text-[15px] md:text-base font-semibold py-4 px-8 tracking-tight hover:bg-[#141414] transition-colors';
const followUpBtnClass = 'w-full text-right rounded-lg border-[0.5px] border-neutral-200 bg-white text-neutral-700 text-[15px] font-medium leading-snug py-3 px-5 hover:bg-neutral-50/90 disabled:opacity-50 transition-colors';

export default function ChatZoe({ slug }: { slug: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [followUps, setFollowUps] = useState<string[]>([...DEFAULT_FOLLOWUPS]);
  const [businessSnapshot, setBusinessSnapshot] = useState<BusinessSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const res = await fetch(`/api/business?slug=${encodeURIComponent(slug)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || 'bootstrap failed');

        const name = (data.name as string)?.trim() || '';
        const welcome = (data.welcome as string)?.trim() || `שלום, כאן זואי מ־${name || 'העסק'}. במה אפשר לעזור?`;
        const followups = ensureFourFollowUps((data.followups as string[]) || []);
        const ctaOk = data.cta_text && data.cta_link;

        setBusinessSnapshot({
          slug, name, service_name: data.service_name || name,
          address: data.address || '', trial_class: data.trial_class || '',
          cta_text: ctaOk ? data.cta_text : null, cta_link: ctaOk ? data.cta_link : null,
        });
        setFollowUps(followups);
        setMessages([{ id: newId(), role: 'assistant', content: welcome, ctaText: ctaOk ? data.cta_text : null, ctaLink: ctaOk ? data.cta_link : null, followUps: followups, showActions: true }]);
      } catch (e) {
        console.error('Bootstrap:', e);
        if (!cancelled) {
          setMessages([{ id: newId(), role: 'assistant', content: 'שלום, כאן זואי. במה אפשר לעזור?', ctaText: null, ctaLink: null, followUps: [...DEFAULT_FOLLOWUPS], showActions: true }]);
        }
      } finally { if (!cancelled) setReady(true); }
    }
    void bootstrap();
    return () => { cancelled = true; };
  }, [slug]);

  const sendText = async (raw: string) => {
    const text = raw.trim();
    if (!text || loading) return;
    // UX: לאחר שליחה מנקים את שדה הקלט כדי שהמשתמש לא יראה את מה שכבר נשלח.
    setInput('');
    const pendingId = newId();
    flushSync(() => { setMessages(prev => [...prev, { id: newId(), role: 'user', content: text }]); });
    setLoading(true);
    setMessages(prev => [...prev, { id: pendingId, role: 'assistant', content: '', ctaText: null, ctaLink: null, followUps, pending: true, showActions: false }]);

    const patchAssistant = (patch: Partial<AssistantMessage> & { id: string }) => {
      setMessages(prev => prev.map(m => m.id === patch.id && isAssistant(m) ? { ...m, ...patch } : m));
    };

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, slug, business: businessSnapshot }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'בעיה בחיבור לזואי');
      }

      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let acc = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          const display = stripMarkdownDecorations(visibleChatPart(acc));
          patchAssistant({ id: pendingId, content: display, pending: display.length === 0 });
        }
        const meta = parseStreamMeta(acc);
        patchAssistant({ id: pendingId, content: stripMarkdownDecorations(visibleChatPart(acc)), pending: false, showActions: true, ctaText: meta.cta_text || businessSnapshot?.cta_text || null, ctaLink: meta.cta_link || businessSnapshot?.cta_link || null });
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message ? error.message : 'בעיה בחיבור לזואי';
      patchAssistant({
        id: pendingId,
        content: message,
        pending: false,
        showActions: true,
        ctaText: businessSnapshot?.cta_text || null,
        ctaLink: businessSnapshot?.cta_link || null
      });
    } finally { setLoading(false); }
  };

  if (!ready) return <div className="flex flex-col items-center justify-center min-h-[320px] gap-3 text-neutral-400"><div className="h-8 w-8 rounded-full border-2 border-neutral-200 border-t-neutral-500 animate-spin" /><p className="text-sm">טוענים את זואי…</p></div>;

  return (
    <div className="flex flex-col h-full w-full max-w-lg mx-auto">
      <div className="flex-1 px-1 py-2 overflow-y-auto space-y-10 min-h-[300px] max-h-[min(70vh,520px)]">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'user' ? (
              <div className="max-w-[85%] px-4 py-2.5 rounded-full bg-neutral-800 text-white text-[15px]">{m.content}</div>
            ) : (
              <div className="max-w-[94%] w-full flex flex-col gap-0">
                <div dir="rtl" className="text-[15px] md:text-[16px] leading-relaxed text-right text-neutral-800 whitespace-pre-wrap">
                  {m.pending ? <span className="flex gap-1.5 justify-end animate-pulse"><span className="h-2 w-2 rounded-full bg-neutral-300" /></span> : m.content}
                </div>
                {isAssistant(m) && !m.pending && m.showActions !== false && (
                  <div className="mt-9 flex flex-col gap-2 w-full" dir="rtl">
                    {m.ctaText && m.ctaLink && <a href={m.ctaLink} target="_blank" rel="noopener noreferrer" className={ctaPremiumClass}>{m.ctaText}</a>}
                    {m.followUps.map((q) => <button key={q} type="button" disabled={loading} onClick={() => void sendText(q)} className={followUpBtnClass}>{q}</button>)}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="pt-3 mt-1 border-t border-neutral-100 flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendText(input)} placeholder="הקלידו כאן…" className="flex-1 py-2.5 px-4 border border-neutral-200 rounded-full text-right" dir="rtl" />
        <button type="button" onClick={() => sendText(input)} disabled={loading} className="bg-neutral-900 text-white px-5 py-2.5 rounded-full">שלח</button>
      </div>
    </div>
  );
}