import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  digitsForMarketingLineCompare,
  isZoeAdminWhatsAppPhone,
} from "@/lib/wa-inbound-unsupported";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/** חלון קצר: פלואו רגיל שולח כמה הודעות; הצפה אמיתית עוברת את זה מהר. */
export const WA_SESSION_FLOOD_WINDOW_MS = 90_000;
export const WA_SESSION_FLOOD_MAX_ASSISTANT = 12;

export function isSameWhatsAppPeer(a: string, b: string): boolean {
  const left = digitsForMarketingLineCompare(a);
  const right = digitsForMarketingLineCompare(b);
  return Boolean(left && right && left === right);
}

/**
 * הודעה נכנסת ממספר זואי האדמין (שיווק/התראות) או ממספר הערוץ עצמו —
 * מענה אוטומטי יוצר פינג־פונג בין שני בוטים / הד עצמי.
 */
export function shouldSkipStudioAutoReplyPeer(
  from: string,
  channelPhoneDisplay?: string | null
): boolean {
  if (isZoeAdminWhatsAppPhone(from)) return true;
  const display = String(channelPhoneDisplay ?? "").trim();
  if (display && isSameWhatsAppPeer(from, display)) return true;
  return false;
}

export function sessionAssistantFloodReachedFromCount(count: number): boolean {
  return Number.isFinite(count) && count >= WA_SESSION_FLOOD_MAX_ASSISTANT;
}

/**
 * IO: COUNT אחד על messages לפי אינדקס (slug, session_id, role, created_at).
 * ב־10x לקוחות זה שאילתה ממוקדת לכל inbound — זול מול הצפת WhatsApp.
 */
export async function sessionAssistantFloodReached(input: {
  admin: AdminClient;
  businessSlug: string;
  sessionId: string;
  now?: Date;
}): Promise<boolean> {
  const slug = String(input.businessSlug ?? "").trim().toLowerCase();
  const sessionId = String(input.sessionId ?? "").trim();
  if (!slug || !sessionId) return false;

  const now = input.now ?? new Date();
  const sinceIso = new Date(now.getTime() - WA_SESSION_FLOOD_WINDOW_MS).toISOString();

  const { count, error } = await input.admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("business_slug", slug)
    .eq("session_id", sessionId)
    .eq("role", "assistant")
    .gte("created_at", sinceIso);

  if (error) {
    console.error("[wa-bot-loop-guard] assistant flood count failed:", error.message, {
      slug,
      session_id: sessionId,
    });
    return false;
  }

  return sessionAssistantFloodReachedFromCount(typeof count === "number" ? count : 0);
}
