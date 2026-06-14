"use client";

import { CornerUpLeft } from "lucide-react";
import {
  parseConversationMessageContent,
  WA_UNSUPPORTED_INBOUND_MODEL,
  type ParsedWaConversationMessage,
} from "@/lib/conversation-message-display";
import { dashboardDateLocale, type DashboardLang } from "@/lib/dashboard-lang";

const i18n = {
  he: {
    errorCode: "קוד שגיאה",
    unsupportedInbound: "תשובת מערכת — סוג הודעה נכנסת לא נתמך",
  },
  en: {
    errorCode: "Error code",
    unsupportedInbound: "System reply — unsupported inbound message type",
  },
} as const;

function formatTime(iso: string, lang: DashboardLang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(dashboardDateLocale(lang), { hour: "2-digit", minute: "2-digit" }).format(d);
}

function WaReplyButton({ label, url }: { label: string; url?: string }) {
  const inner = (
    <>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#027eb5]">{label}</span>
      <CornerUpLeft className="h-4 w-4 shrink-0 text-[#027eb5]/80" aria-hidden />
    </>
  );
  const className =
    "flex w-full items-center justify-between gap-2 border-t border-[#d1d7db] bg-white px-3 py-2.5 text-right first:border-t-0 hover:bg-[#f5f6f6]";
  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={className} dir="rtl">
        {inner}
      </a>
    );
  }
  return (
    <div className={className} dir="rtl">
      {inner}
    </div>
  );
}

function BubbleShell({
  from,
  children,
  time,
  interactive,
}: {
  from: "user" | "assistant";
  children: React.ReactNode;
  time?: string;
  interactive?: boolean;
}) {
  const outgoing = from === "assistant";
  const greenText = outgoing && !interactive;
  return (
    <div className={`flex w-full ${outgoing ? "justify-end" : "justify-start"}`}>
      <div
        dir="rtl"
        className={[
          "max-w-[min(100%,280px)] shadow-sm",
          greenText
            ? "rounded-lg rounded-br-none bg-[#dcf8c6] text-zinc-900"
            : "rounded-lg bg-white text-zinc-900",
          !greenText && !outgoing ? "rounded-bl-none" : "",
          !greenText && outgoing ? "rounded-br-none" : "",
        ].join(" ")}
      >
        {children}
        {time ? (
          <div className={`px-2 pb-1 pt-0 text-left text-[10px] leading-none text-zinc-500/90 ${outgoing ? "pe-2" : "ps-2"}`}>
            {time}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MessageBody({ parsed }: { parsed: ParsedWaConversationMessage }) {
  if (parsed.kind === "media") {
    const isVideo = parsed.isVideo;
    return (
      <div className="overflow-hidden">
        {parsed.url ? (
          <div className="bg-zinc-100">
            {isVideo ? (
              <video
                src={parsed.url}
                controls
                className="max-h-56 w-full bg-black object-contain"
                preload="metadata"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={parsed.url} alt="" className="max-h-56 w-full object-contain" />
            )}
          </div>
        ) : null}
        {parsed.caption ? (
          <p className="whitespace-pre-wrap px-2.5 py-2 text-sm leading-snug">{parsed.caption}</p>
        ) : null}
      </div>
    );
  }

  if (parsed.kind === "interactive") {
    return (
      <div className="overflow-hidden rounded-lg">
        {parsed.text ? (
          <p className="whitespace-pre-wrap px-2.5 py-2 text-sm leading-snug">{parsed.text}</p>
        ) : null}
        {parsed.buttons.length > 0 ? (
          <div className="border-t border-[#d1d7db]">
            {parsed.buttons.map((b, i) => (
              <WaReplyButton key={`${b.label}-${i}`} label={b.label} url={b.url} />
            ))}
          </div>
        ) : null}
        {parsed.footerHint ? (
          <p className="border-t border-[#d1d7db]/80 bg-[#f0f2f5] px-2.5 py-1.5 text-center text-[11px] text-zinc-500">
            {parsed.footerHint}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <p className="whitespace-pre-wrap px-2.5 py-2 text-sm leading-snug">{parsed.text}</p>
  );
}

export function WaConversationMessage({
  role,
  content,
  createdAt,
  errorCode,
  modelUsed,
  lang = "he",
}: {
  role: string;
  content: string;
  createdAt?: string;
  errorCode?: string | null;
  modelUsed?: string | null;
  lang?: DashboardLang;
}) {
  if (role === "event") return null;

  const t = i18n[lang];
  const from = role === "user" ? "user" : "assistant";
  const parsed = parseConversationMessageContent(content);
  const time = createdAt ? formatTime(createdAt, lang) : undefined;
  const interactive = parsed.kind === "interactive" || parsed.kind === "media";

  return (
    <div className="mb-2">
      <BubbleShell from={from} time={time} interactive={interactive}>
        <MessageBody parsed={parsed} />
      </BubbleShell>
      {from === "assistant" && errorCode ? (
        <p className="mt-0.5 text-end text-[10px] text-red-600">
          {t.errorCode}: {errorCode}
        </p>
      ) : null}
      {from === "assistant" && modelUsed === WA_UNSUPPORTED_INBOUND_MODEL ? (
        <p className="mt-0.5 text-end text-[10px] text-amber-700">{t.unsupportedInbound}</p>
      ) : null}
    </div>
  );
}
