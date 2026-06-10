import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

/** 26 שעות אחרי הודעת הליד האחרונה — ללא «נרשמתי» (trial_registered) */
export const WA_NO_RESPONSE_AFTER_MS = 26 * 60 * 60 * 1000;

export type WaNoResponseContactGate = {
  opted_out?: boolean | null;
  not_relevant_at?: string | null;
  trial_registered?: boolean | null;
  session_phase?: string | null;
};

export function waNoResponseEligible(contact: WaNoResponseContactGate): boolean {
  if (contact.opted_out === true) return false;
  if (contact.not_relevant_at) return false;
  if (contact.trial_registered === true) return false;
  if (String(contact.session_phase ?? "").trim() === "registered") return false;
  return true;
}

export function isIdleAfterLastUserMessage(
  lastUserAtIso: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  const raw = String(lastUserAtIso ?? "").trim();
  if (!raw) return false;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) && nowMs - t >= WA_NO_RESPONSE_AFTER_MS;
}

export async function fetchLastUserMessageAt(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business_slug: string;
  session_ids: string[];
}): Promise<string | null> {
  const sessionIds = input.session_ids.filter(Boolean);
  if (!sessionIds.length) return null;
  const { data, error } = await input.admin
    .from("messages")
    .select("created_at")
    .eq("business_slug", input.business_slug.trim().toLowerCase())
    .in("session_id", sessionIds)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[wa-no-response] fetchLastUserMessageAt:", error.message);
    return null;
  }
  const at = data?.created_at ? String(data.created_at) : "";
  return at || null;
}
