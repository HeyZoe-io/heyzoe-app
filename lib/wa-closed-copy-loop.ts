import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const WINDOW_MS = 24 * 60 * 60 * 1000;

export function closedCopyKey(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * One indexed read of the last assistant row for this session.
 * Call only when a closed copy is about to be sent.
 */
export async function lastClosedOutboundRepeats(input: {
  admin: Admin;
  businessSlug: string;
  sessionId: string;
  text: string;
}): Promise<boolean> {
  const key = closedCopyKey(input.text);
  if (!key || !input.sessionId) return false;
  const { data, error } = await input.admin
    .from("messages")
    .select("content, created_at")
    .eq("business_slug", input.businessSlug)
    .eq("session_id", input.sessionId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[closed-copy-loop] last outbound read failed:", error.message);
    return false;
  }
  const row = data?.[0] as { content?: unknown; created_at?: unknown } | undefined;
  if (!row) return false;
  const at = new Date(String(row.created_at ?? "")).getTime();
  if (!Number.isFinite(at) || Date.now() - at > WINDOW_MS) return false;
  return closedCopyKey(String(row.content ?? "")) === key;
}
