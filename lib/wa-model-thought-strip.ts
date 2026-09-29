/** Drops model THOUGHT lines before a free-text WhatsApp reply is sent. */

export type ThoughtStripLog = {
  businessSlug: string;
  conversationId: string;
};

const THOUGHT_LINE_RES = [
  /^\[\s*THOUGHT\s*\]\s*:?\s*([\s\S]*)$/u,
  /^\(\s*THOUGHT\s*\)\s*:?\s*([\s\S]*)$/u,
  /^<\s*THOUGHT\s*>\s*:?\s*([\s\S]*)$/u,
  /^THOUGHT\b\s*:?\s*([\s\S]*)$/u,
  /^Thought\s*:\s*([\s\S]*)$/u,
];

function thoughtLineRest(line: string): string | null {
  const trimmed = line.trim();
  for (const re of THOUGHT_LINE_RES) {
    const match = trimmed.match(re);
    if (match) return match[1] ?? "";
  }
  return null;
}

function stripTaggedThoughtBlocks(text: string): string {
  return text
    .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<thought\b[^>]*>[\s\S]*?<\/thought>/gi, "");
}

/**
 * Removes THOUGHT / Thought: lines and tagged thought blocks.
 * A header-only line also drops the following block until a blank line.
 * Leaves Hebrew replies and the lowercase word "thought" inside a sentence.
 */
export function stripModelThoughtLeak(text: string, log?: ThoughtStripLog): string {
  const original = String(text ?? "").replace(/\r\n/g, "\n");
  const withoutTags = stripTaggedThoughtBlocks(original);
  const lines = withoutTags.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const rest = thoughtLineRest(lines[i] ?? "");
    if (rest === null) {
      kept.push(lines[i] ?? "");
      continue;
    }
    if (!rest.trim()) {
      i += 1;
      while (i < lines.length && (lines[i] ?? "").trim() !== "") i += 1;
    }
  }
  const stripped = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const before = original.replace(/\n{3,}/g, "\n\n").trim();
  if (stripped !== before) {
    console.warn("[zoe] stripped THOUGHT leak", {
      business_slug: log?.businessSlug ?? "",
      conversation_id: log?.conversationId ?? "",
    });
  }
  return stripped;
}
