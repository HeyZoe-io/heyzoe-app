import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const WA_REACTION_LOG_PREFIX = "[reaction]";
export const WA_UNSUPPORTED_REACTION_LOG = "[unsupported] reaction";
export const WA_INBOUND_REACTION_MODEL = "wa_inbound_reaction";

export type ParsedWaReactionLog = {
  emoji: string;
  quoted: string;
};

export function isWaReactionLogContent(raw: string): boolean {
  return parseWaReactionLogContent(raw) != null;
}

export function parseWaReactionLogContent(raw: string): ParsedWaReactionLog | null {
  const s = String(raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!s) return null;
  if (/^\[unsupported\]\s*reaction$/i.test(s)) return { emoji: "", quoted: "" };
  if (!s.startsWith(WA_REACTION_LOG_PREFIX)) return null;
  const rest = s.slice(WA_REACTION_LOG_PREFIX.length).replace(/^\s+/, "");
  const nl = rest.indexOf("\n");
  if (nl < 0) return { emoji: rest.trim(), quoted: "" };
  return { emoji: rest.slice(0, nl).trim(), quoted: rest.slice(nl + 1).trim() };
}

export function formatWaReactionLogContent(emoji: string, quoted: string): string {
  const em = String(emoji ?? "").trim();
  const q = String(quoted ?? "").trim();
  if (!em && !q) return WA_UNSUPPORTED_REACTION_LOG;
  return q ? `${WA_REACTION_LOG_PREFIX} ${em}\n${q}` : `${WA_REACTION_LOG_PREFIX} ${em}`.trim();
}

export function excerptForReactionQuote(raw: string): string {
  let s = String(raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!s || isWaReactionLogContent(s)) return "";
  if (/^\[unsupported\]/i.test(s)) return "";
  if (s.startsWith("[media]")) {
    const rest = s.slice("[media]".length).trim();
    const nl = rest.indexOf("\n\n");
    const caption = (nl >= 0 ? rest.slice(nl + 2) : "").trim();
    return (caption || "📷 תמונה").slice(0, 160);
  }
  if (s.startsWith("[image]")) return (s.slice("[image]".length).trim() || "📷 תמונה").slice(0, 160);
  if (s.startsWith("[video]")) return (s.slice("[video]".length).trim() || "🎥 וידאו").slice(0, 160);
  s = s.replace(/\n?\[כפתורים:[^\]]+\]\s*$/u, "").trim();
  s = s.replace(/\n?\[כפתור:[^\]]+\]\s*/gu, "").trim();
  s = s.replace(/\n?\[([^:\]\n]{1,80}):\s*https?:\/\/[^\]\s]+\]\s*$/iu, "").trim();
  return s.replace(/\s+/g, " ").trim().slice(0, 160);
}

export function foldConversationReactions<T extends { role: string; content: string }>(
  rows: T[]
): Array<T & { reactionEmoji?: string }> {
  const out: Array<T & { reactionEmoji?: string }> = [];
  for (const row of rows) {
    if (String(row.role ?? "").trim() === "event") {
      out.push(row);
      continue;
    }
    const reaction = parseWaReactionLogContent(row.content);
    if (!reaction) {
      out.push(row);
      continue;
    }
    let attached = false;
    for (let i = out.length - 1; i >= 0; i -= 1) {
      const prev = out[i]!;
      if (String(prev.role ?? "").trim() === "event") continue;
      if (parseWaReactionLogContent(prev.content)) continue;
      const emoji = reaction.emoji.trim();
      out[i] = emoji ? { ...prev, reactionEmoji: emoji } : prev;
      attached = true;
      break;
    }
    if (!attached) out.push(row);
  }
  return out;
}

/** הודעה אחרונה בשיחה שאפשר לצטט מתגובה — שאילתה ממוקדת לפי session. */
export async function fetchLastQuoteableSessionMessage(input: {
  businessSlug: string;
  sessionId: string;
}): Promise<string> {
  const businessSlug = String(input.businessSlug ?? "").trim().toLowerCase();
  const sessionId = String(input.sessionId ?? "").trim();
  if (!businessSlug || !sessionId) return "";
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("messages")
      .select("content, role")
      .eq("business_slug", businessSlug)
      .eq("session_id", sessionId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: false })
      .limit(8);
    if (error) {
      console.warn("[wa-inbound-reaction] quote lookup failed:", error.message);
      return "";
    }
    for (const row of data ?? []) {
      const excerpt = excerptForReactionQuote(String((row as { content?: string }).content ?? ""));
      if (excerpt) return excerpt;
    }
    return "";
  } catch (e) {
    console.warn("[wa-inbound-reaction] quote lookup exception:", e);
    return "";
  }
}
