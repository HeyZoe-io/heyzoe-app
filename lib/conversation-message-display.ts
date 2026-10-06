import { HEYZOE_MARKETING_CTA_SENT } from "@/lib/lp-analytics";
import { getZoeWhatsAppMenuFooter } from "@/lib/whatsapp-copy";
import { parseWaReactionLogContent } from "@/lib/wa-inbound-reaction";
import {
  hebrewUnsupportedInboundLabel,
  parseWaUnsupportedKind,
  WA_ZOE_ADMIN_TEMPLATE_MODEL as WA_ZOE_ADMIN_TEMPLATE_MODEL_VALUE,
} from "@/lib/wa-inbound-unsupported";
import { isWhatsAppAudioUrl } from "@/lib/whatsapp-media-limits";
import { sanitizeZoeOutboundLanguage } from "@/lib/zoe-text";

export type WaConversationButton = { label: string; url?: string };

export type ParsedWaConversationMessage =
  | { kind: "text"; text: string }
  | {
      kind: "interactive";
      text: string;
      buttons: WaConversationButton[];
      footerHint?: string;
    }
  | { kind: "media"; url: string; caption?: string; isVideo?: boolean; isAudio?: boolean }
  | { kind: "reaction"; emoji: string; quoted: string }
  | { kind: "unsupported"; title: string; detail: string };

function parseNumberedTail(lines: string[]): { bodyLines: string[]; chips: string[] } {
  const body = [...lines];
  const chips: string[] = [];
  while (body.length > 0) {
    const line = body[body.length - 1]?.trim() ?? "";
    if (!line) {
      body.pop();
      continue;
    }
    const m = line.match(/^\d+\.\s*(.+)$/);
    if (m) {
      chips.unshift(m[1].trim());
      body.pop();
      continue;
    }
    break;
  }
  return { bodyLines: body, chips };
}

function cleanButtonLabel(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/^[-*•]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .trim();
}

function splitButtonsPipe(raw: string): string[] {
  return raw
    .split("|")
    .map(cleanButtonLabel)
    .filter(Boolean);
}

function parseButtonToken(raw: string): WaConversationButton {
  const inner = String(raw ?? "").trim();
  const arrow = inner.match(/^(.+?)\s*→\s*(.+)$/);
  if (arrow) return { label: arrow[1].trim(), url: arrow[2].trim() };
  return { label: inner };
}

function extractFooterHint(text: string): { text: string; footerHint?: string } {
  const t = text.trim();
  for (const lang of ["he", "en", "ru"] as const) {
    const footer = getZoeWhatsAppMenuFooter(lang).trim();
    if (!footer || !t.includes(footer)) continue;
    const without = t
      .replace(new RegExp(`\\n*${footer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n*`, "g"), "\n")
      .trim();
    return { text: without, footerHint: footer };
  }
  return { text: t };
}

function asInteractive(
  text: string,
  buttons: WaConversationButton[],
  footerHintOverride?: string
): ParsedWaConversationMessage {
  const { text: body, footerHint } = extractFooterHint(text);
  if (buttons.length === 0) return { kind: "text", text: body || text };
  return { kind: "interactive", text: body, buttons, footerHint: footerHintOverride ?? footerHint };
}

function parsePlainButtonsSection(text: string): { text: string; buttons: WaConversationButton[] } | null {
  const lines = text.split("\n");
  const markerIdx = lines.findIndex((line) => {
    const normalized = line.trim().replace(/[:：]\s*$/, "");
    return normalized === "כפתורים" || normalized === "אפשרויות";
  });
  if (markerIdx < 0) return null;

  const before = lines.slice(0, markerIdx).join("\n").trim();
  const after = lines.slice(markerIdx + 1).map(cleanButtonLabel).filter(Boolean);
  if (after.length === 0) return null;

  const buttonLabels = after.flatMap((line) => splitButtonsPipe(line));
  if (buttonLabels.length === 0) return null;
  return { text: before, buttons: buttonLabels.map(parseButtonToken) };
}

/** מפרק תוכן הודעה מה-DB לתצוגה דמוית וואטסאפ (כפתורים, מדיה, CTA). */
export function parseConversationMessageContent(raw: string): ParsedWaConversationMessage {
  let s = String(raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!s) return { kind: "text", text: "" };

  const reaction = parseWaReactionLogContent(s);
  if (reaction) return { kind: "reaction", emoji: reaction.emoji, quoted: reaction.quoted };

  const unsupportedKind = parseWaUnsupportedKind(s);
  if (unsupportedKind != null) {
    const label = hebrewUnsupportedInboundLabel(unsupportedKind);
    return { kind: "unsupported", title: label.title, detail: label.detail };
  }

  if (s.startsWith("[video]")) {
    const caption = s.slice("[video]".length).trim();
    return { kind: "media", url: "", caption: caption || undefined, isVideo: true };
  }
  if (s.startsWith("[image]")) {
    const caption = s.slice("[image]".length).trim();
    return { kind: "media", url: "", caption: caption || undefined, isVideo: false };
  }

  if (s.startsWith("[media]")) {
    const rest = s.slice("[media]".length).trim();
    const nl = rest.indexOf("\n\n");
    const url = (nl >= 0 ? rest.slice(0, nl) : rest).trim();
    const caption = nl >= 0 ? rest.slice(nl + 2).trim() : "";
    if (!/^https?:\/\//i.test(url) && /^(video|image)$/i.test(url)) {
      return {
        kind: "media",
        url: "",
        caption: caption || undefined,
        isVideo: /^video$/i.test(url),
      };
    }
    const isAudio = isWhatsAppAudioUrl(url);
    const isVideo =
      !isAudio && (/\.(mp4|mov|webm)(\?|$)/i.test(url) || rest.toLowerCase().includes("video"));
    return { kind: "media", url, caption: caption || undefined, isVideo, isAudio };
  }

  const withoutFooter = extractFooterHint(s);
  const displaySource = withoutFooter.footerHint ? withoutFooter.text : s;

  if (s.startsWith(HEYZOE_MARKETING_CTA_SENT)) {
    s = s.slice(HEYZOE_MARKETING_CTA_SENT.length).trim();
    const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
    const last = lines[lines.length - 1] ?? "";
    const url = /^https?:\/\//i.test(last) ? last : undefined;
    const text = url ? lines.slice(0, -1).join("\n").trim() : s;
    return asInteractive(text, [{ label: "לחצו כאן", url }]);
  }

  const buttonsBlock = displaySource.match(/\n?\[כפתורים:\s*([^\]]+)\]\s*$/);
  if (buttonsBlock) {
    const text = displaySource.slice(0, buttonsBlock.index).trim();
    const buttons = splitButtonsPipe(buttonsBlock[1]!).map((label) => ({ label }));
    return asInteractive(text, buttons, withoutFooter.footerHint);
  }

  const ctaBlock = displaySource.match(/\n?\[([^:\]\n]{1,80}):\s*(https?:\/\/[^\]\s]+)\]\s*$/i);
  if (ctaBlock) {
    const text = displaySource.slice(0, ctaBlock.index).trim();
    return asInteractive(text, [{ label: cleanButtonLabel(ctaBlock[1]!), url: ctaBlock[2]!.trim() }], withoutFooter.footerHint);
  }

  const singleButtons: WaConversationButton[] = [];
  const withoutSingle = displaySource
    .replace(/\n?\[כפתור(?:\s+תשובה)?:\s*([^\]]+)\]\s*/g, (_, inner: string) => {
      singleButtons.push(parseButtonToken(inner));
      return "";
    })
    .trim();
  if (singleButtons.length > 0) {
    return asInteractive(withoutSingle, singleButtons, withoutFooter.footerHint);
  }

  const plainButtons = parsePlainButtonsSection(displaySource);
  if (plainButtons) {
    return asInteractive(plainButtons.text, plainButtons.buttons, withoutFooter.footerHint);
  }

  const lines = displaySource.split("\n");
  const { bodyLines, chips } = parseNumberedTail(lines);
  if (chips.length >= 2) {
    const body = bodyLines.join("\n").trim();
    return asInteractive(body, chips.map((label) => ({ label })), withoutFooter.footerHint);
  }

  if (chips.length === 1 && bodyLines.every((l) => !l.trim())) {
    return asInteractive("", chips.map((label) => ({ label })), withoutFooter.footerHint);
  }

  return { kind: "text", text: s };
}

/**
 * לפני 10:45 (שעון ישראל) ב-5.10.2026 השליחה כיווצה כל רצף רווחים, כולל שורה ריקה.
 * עד 11:30 נשמרו ירידות שורה, ועדיין כווצו רווחים רגילים כפולים.
 */
const SESSION_NEWLINES_PRESERVED_FROM_MS = Date.parse("2026-10-05T07:45:00.000Z");
const SESSION_AUTHORED_SPACES_PRESERVED_FROM_MS = Date.parse("2026-10-05T08:30:00.000Z");

const AS_SENT_SKIP_MODELS = new Set([
  "wa_business_app",
  "lead_template",
  WA_ZOE_ADMIN_TEMPLATE_MODEL_VALUE,
]);

/** טקסט סשן כפי ש-Meta קיבלה — בלי סימני הכיוון הבלתי נראים. */
export function conversationTextAsSent(text: string, sentAtIso?: string | null): string {
  const prepared = sanitizeZoeOutboundLanguage(text);
  const sentAt = sentAtIso ? Date.parse(sentAtIso) : Number.NaN;
  if (!Number.isFinite(sentAt)) return prepared;
  if (sentAt < SESSION_NEWLINES_PRESERVED_FROM_MS) {
    return prepared.replace(/\s{2,}/g, " ").replace(/\s+([.,!?])/g, "$1");
  }
  if (sentAt < SESSION_AUTHORED_SPACES_PRESERVED_FROM_MS) {
    return prepared.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([.,!?])/g, "$1");
  }
  return prepared;
}

/** בועת הדשבורד: מה שנשמר בלוג, אחרי אותו עיבוד שיצא לוואטסאפ. */
export function parseConversationMessageForDashboard(input: {
  role: string;
  content: string;
  createdAt?: string | null;
  modelUsed?: string | null;
}): ParsedWaConversationMessage {
  const parsed = parseConversationMessageContent(input.content);
  if (input.role !== "assistant") return parsed;
  const model = String(input.modelUsed ?? "").trim();
  if (AS_SENT_SKIP_MODELS.has(model)) return parsed;
  const asSent = (value: string) => conversationTextAsSent(value, input.createdAt);
  if (parsed.kind === "text") return { ...parsed, text: asSent(parsed.text) };
  if (parsed.kind === "interactive") {
    return {
      ...parsed,
      text: asSent(parsed.text),
      ...(parsed.footerHint ? { footerHint: asSent(parsed.footerHint) } : {}),
    };
  }
  return parsed;
}

/** model_used ב-messages — תשובת «סוג הודעה לא נתמך» מ-webhook. */
export const WA_UNSUPPORTED_INBOUND_MODEL = "unsupported_inbound_type";

/** model_used ב-messages — הודעה שנשלחה מאפליקציית WhatsApp Business (לא מזואי). */
export const WA_BUSINESS_APP_ECHO_MODEL = "wa_business_app";

/** model_used — טמפלייט שנשלח ממספר זואי אדמין (שוחזר כי Meta לא מעבירה גוף WABA→WABA). */
export const WA_ZOE_ADMIN_TEMPLATE_MODEL = WA_ZOE_ADMIN_TEMPLATE_MODEL_VALUE;
