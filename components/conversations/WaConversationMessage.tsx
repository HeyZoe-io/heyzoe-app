"use client";

import { CornerUpLeft } from "lucide-react";
import {
  parseConversationMessageForDashboard,
  WA_UNSUPPORTED_INBOUND_MODEL,
  WA_BUSINESS_APP_ECHO_MODEL,
  WA_ZOE_ADMIN_TEMPLATE_MODEL,
  type ParsedWaConversationMessage,
} from "@/lib/conversation-message-display";
import { dashboardDateLocale, type DashboardLang } from "@/lib/dashboard-lang";
import { parseModelUsed } from "@/lib/wa-reply-route";
import { deliveryStateLabelHebrew, type MessageDelivery } from "@/lib/wa-delivery-errors";

const i18n = {
  he: {
    errorCode: "קוד שגיאה",
    unsupportedInbound: "תשובת מערכת — סוג הודעה נכנסת לא נתמך",
    sentFromWhatsAppApp: "נשלח מאפליקציית WhatsApp",
    personalPause: "השהיה אוטומטית - הודעה אישית",
    sentFromZoeAdmin: "נשלח ממספר זואי",
  },
  en: {
    errorCode: "Error code",
    unsupportedInbound: "System reply — unsupported inbound message type",
    sentFromWhatsAppApp: "Sent from the WhatsApp app",
    personalPause: "Auto-paused - personal message",
    sentFromZoeAdmin: "Sent from the Zoe admin number",
  },
} as const;

const IL_TZ = "Asia/Jerusalem";

function TickIcon({ double, className }: { double: boolean; className: string }) {
  return (
    <svg viewBox="0 0 18 11" className={`h-[11px] w-[16px] ${className}`} aria-hidden fill="none">
      <path d="M1 6.2 4.2 9.4 11 1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      {double ? (
        <path d="M7.6 8.6 8.4 9.4 15.2 1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
    </svg>
  );
}

/** WhatsApp-style status for an outbound bubble. Failed shows the Hebrew reason on hover. */
export function WaDeliveryIndicator({ delivery, lang }: { delivery: MessageDelivery; lang: DashboardLang }) {
  const label =
    lang === "he"
      ? deliveryStateLabelHebrew(delivery.status)
      : delivery.status === "read"
        ? "Read"
        : delivery.status === "delivered"
          ? "Delivered"
          : delivery.status === "failed"
            ? "Failed"
            : "Sent";
  if (delivery.status === "failed") {
    const reason = delivery.error_text || label;
    return (
      <span
        className="inline-flex h-[14px] w-[14px] cursor-help items-center justify-center rounded-full bg-[#ea0038] text-[10px] font-bold leading-none text-white"
        title={reason}
        aria-label={`${label}: ${reason}`}
        role="img"
      >
        !
      </span>
    );
  }
  const color = delivery.status === "read" ? "text-[#53bdeb]" : "text-[#8696a0]";
  return (
    <span title={label} aria-label={label} role="img" className="inline-flex items-center">
      <TickIcon double={delivery.status !== "sent"} className={color} />
    </span>
  );
}

function formatTime(iso: string, lang: DashboardLang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(dashboardDateLocale(lang), {
    timeZone: IL_TZ,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** YYYY-MM-DD לפי לוח ישראל — לקיבוץ הודעות לפי יום */
export function conversationDayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  if (!y || !m || !day) return "";
  return `${y}-${m}-${day}`;
}

function addCalendarDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return "";
  const utc = new Date(Date.UTC(y, m - 1, d + delta));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
}

export function formatConversationDayLabel(iso: string, lang: DashboardLang): string {
  const key = conversationDayKey(iso);
  if (!key) return "";
  const today = conversationDayKey(new Date().toISOString());
  if (key === today) return lang === "he" ? "היום" : "Today";
  if (key === addCalendarDays(today, -1)) return lang === "he" ? "אתמול" : "Yesterday";
  const d = new Date(iso);
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat(dashboardDateLocale(lang), {
    timeZone: IL_TZ,
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(d);
}

export function WaConversationDaySeparator({
  iso,
  lang = "he",
}: {
  iso: string;
  lang?: DashboardLang;
}) {
  const label = formatConversationDayLabel(iso, lang);
  if (!label) return null;
  return (
    <div className="mb-2 flex justify-center py-1" role="separator">
      <span className="rounded-[7.5px] bg-[#e1f2fb] px-3 py-[5px] text-[12.5px] font-medium leading-none text-[#54656f] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
        {label}
      </span>
    </div>
  );
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
  reactionEmoji,
  delivery,
  lang,
}: {
  from: "user" | "assistant";
  children: React.ReactNode;
  time?: string;
  interactive?: boolean;
  reactionEmoji?: string;
  delivery?: MessageDelivery;
  lang: DashboardLang;
}) {
  const outgoing = from === "assistant";
  const greenText = outgoing && !interactive;
  const bubbleClass = outgoing
    ? greenText
      ? "rounded-lg rounded-bl-none bg-[#d9fdd3] text-[#111b21]"
      : "rounded-lg rounded-bl-none bg-white text-[#111b21]"
    : "rounded-lg rounded-br-none bg-white text-[#111b21]";
  return (
    <div className={`flex w-full ${outgoing ? "justify-start" : "justify-end"}`} dir="rtl">
      <div dir="rtl" className={`relative max-w-[min(100%,320px)] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] ${bubbleClass}`}>
        {children}
        {time || (outgoing && delivery) ? (
          <div className="flex items-center justify-end gap-1 px-2 pb-1 pt-0 text-[11px] leading-none text-[#667781]">
            {time ? <span>{time}</span> : null}
            {outgoing && delivery ? <WaDeliveryIndicator delivery={delivery} lang={lang} /> : null}
          </div>
        ) : null}
        {reactionEmoji ? (
          <span
            className={`absolute ${outgoing ? "left-1" : "right-1"} -bottom-2 rounded-full bg-white px-1 text-[15px] leading-none shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]`}
          >
            {reactionEmoji}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function MessageBody({ parsed }: { parsed: ParsedWaConversationMessage }) {
  if (parsed.kind === "media") {
    const isVideo = parsed.isVideo;
    const isAudio = parsed.isAudio;
    return (
      <div className="overflow-hidden">
        {parsed.url ? (
          <div className="bg-zinc-100">
            {isAudio ? (
              <audio src={parsed.url} controls preload="metadata" className="w-full" />
            ) : isVideo ? (
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
        ) : (
          <p className="whitespace-pre-wrap px-2.5 py-2 text-sm leading-snug text-[#54656f]">
            {isAudio ? "🎤 נשלחה הקלטה" : isVideo ? "🎥 נשלח סרטון" : "📷 נשלחה תמונה"}
          </p>
        )}
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

  if (parsed.kind === "reaction") {
    return (
      <div className="px-2.5 py-2">
        {parsed.quoted ? (
          <p className="mb-1 whitespace-pre-wrap border-r-2 border-[#d1d7db] pr-2 text-[13px] leading-snug text-[#667781]">
            {parsed.quoted}
          </p>
        ) : null}
        <p className="text-[22px] leading-none">{parsed.emoji || "♡"}</p>
      </div>
    );
  }

  if (parsed.kind === "unsupported") {
    return (
      <div className="px-2.5 py-2">
        <p className="text-sm leading-snug text-[#54656f]">{parsed.title}</p>
        {parsed.detail ? (
          <p className="mt-0.5 text-[11px] leading-snug text-[#8696a0]">{parsed.detail}</p>
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
  reactionEmoji,
  delivery,
}: {
  role: string;
  content: string;
  createdAt?: string;
  errorCode?: string | null;
  modelUsed?: string | null;
  lang?: DashboardLang;
  reactionEmoji?: string;
  delivery?: MessageDelivery | null;
}) {
  const t = i18n[lang];
  const modelEarly = parseModelUsed(modelUsed).model;
  if (role === "event") {
    if (modelEarly !== "wa_personal_pause") return null;
    return <p className="mb-2 text-center text-[11px] leading-tight text-amber-700">{t.personalPause}</p>;
  }

  const from = role === "user" ? "user" : "assistant";
  const parsed = parseConversationMessageForDashboard({
    role,
    content,
    createdAt,
    modelUsed,
  });
  const model = parseModelUsed(modelUsed).model;
  const time = createdAt ? formatTime(createdAt, lang) : undefined;
  const interactive = parsed.kind === "interactive" || parsed.kind === "media";

  return (
    <div className={`mb-2 ${reactionEmoji ? "mb-4" : ""}`}>
      <BubbleShell
        from={from}
        time={time}
        interactive={interactive}
        reactionEmoji={reactionEmoji}
        delivery={delivery ?? undefined}
        lang={lang}
      >
        <MessageBody parsed={parsed} />
      </BubbleShell>
      {from === "assistant" && delivery?.status === "failed" ? (
        <p className="mt-0.5 text-end text-[10px] text-red-600" dir="rtl">
          {delivery.error_text}
        </p>
      ) : null}
      {from === "assistant" && errorCode ? (
        <p className="mt-0.5 text-end text-[10px] text-red-600">
          {t.errorCode}: {errorCode}
        </p>
      ) : null}
      {from === "assistant" && model === WA_UNSUPPORTED_INBOUND_MODEL ? (
        <p className="mt-0.5 text-end text-[10px] text-amber-700">{t.unsupportedInbound}</p>
      ) : null}
      {from === "assistant" && model === WA_BUSINESS_APP_ECHO_MODEL ? (
        <p className="mt-0.5 text-end text-[10px] text-amber-700">{t.sentFromWhatsAppApp}</p>
      ) : null}
      {model === WA_ZOE_ADMIN_TEMPLATE_MODEL ? (
        <p className="mt-0.5 text-end text-[10px] text-amber-700">{t.sentFromZoeAdmin}</p>
      ) : null}
    </div>
  );
}
