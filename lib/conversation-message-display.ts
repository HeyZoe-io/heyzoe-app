import { HEYZOE_MARKETING_CTA_SENT } from "@/lib/lp-analytics";
import { ZOE_WHATSAPP_MENU_FOOTER } from "@/lib/whatsapp-copy";

export type WaConversationButton = { label: string; url?: string };

export type ParsedWaConversationMessage =
  | { kind: "text"; text: string }
  | {
      kind: "interactive";
      text: string;
      buttons: WaConversationButton[];
      footerHint?: string;
    }
  | { kind: "media"; url: string; caption?: string; isVideo?: boolean };

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

function splitButtonsPipe(raw: string): string[] {
  return raw
    .split("|")
    .map((s) => s.trim())
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
  const footer = ZOE_WHATSAPP_MENU_FOOTER.trim();
  if (!footer || !t.includes(footer)) return { text: t };
  const without = t
    .replace(new RegExp(`\\n*${footer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n*`, "g"), "\n")
    .trim();
  return { text: without, footerHint: footer };
}

function asInteractive(
  text: string,
  buttons: WaConversationButton[]
): ParsedWaConversationMessage {
  const { text: body, footerHint } = extractFooterHint(text);
  if (buttons.length === 0) return { kind: "text", text: body || text };
  return { kind: "interactive", text: body, buttons, footerHint };
}

/** מפרק תוכן הודעה מה-DB לתצוגה דמוית וואטסאפ (כפתורים, מדיה, CTA). */
export function parseConversationMessageContent(raw: string): ParsedWaConversationMessage {
  let s = String(raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!s) return { kind: "text", text: "" };

  if (s.startsWith("[media]")) {
    const rest = s.slice("[media]".length).trim();
    const nl = rest.indexOf("\n\n");
    const url = (nl >= 0 ? rest.slice(0, nl) : rest).trim();
    const caption = nl >= 0 ? rest.slice(nl + 2).trim() : "";
    const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(url) || rest.toLowerCase().includes("video");
    return { kind: "media", url, caption: caption || undefined, isVideo };
  }

  if (s.startsWith(HEYZOE_MARKETING_CTA_SENT)) {
    s = s.slice(HEYZOE_MARKETING_CTA_SENT.length).trim();
    const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
    const last = lines[lines.length - 1] ?? "";
    const url = /^https?:\/\//i.test(last) ? last : undefined;
    const text = url ? lines.slice(0, -1).join("\n").trim() : s;
    return asInteractive(text, [{ label: "לחצו כאן", url }]);
  }

  const buttonsBlock = s.match(/\n?\[כפתורים:\s*([^\]]+)\]\s*$/);
  if (buttonsBlock) {
    const text = s.slice(0, buttonsBlock.index).trim();
    const buttons = splitButtonsPipe(buttonsBlock[1]!).map((label) => ({ label }));
    return asInteractive(text, buttons);
  }

  const singleButtons: WaConversationButton[] = [];
  let withoutSingle = s.replace(/\n?\[כפתור:\s*([^\]]+)\]\s*/g, (_, inner: string) => {
    singleButtons.push(parseButtonToken(inner));
    return "";
  }).trim();
  if (singleButtons.length > 0) {
    return asInteractive(withoutSingle, singleButtons);
  }

  const lines = s.split("\n");
  const { bodyLines, chips } = parseNumberedTail(lines);
  if (chips.length >= 2) {
    const body = bodyLines.join("\n").trim();
    return asInteractive(body, chips.map((label) => ({ label })));
  }

  if (chips.length === 1 && bodyLines.every((l) => !l.trim())) {
    return asInteractive("", chips.map((label) => ({ label })));
  }

  return { kind: "text", text: s };
}
