import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export const CONTACT_PROCESSING_LOCK_TTL_SECONDS = 60;

export type ContactProcessingLockResult = {
  acquired: boolean;
  claimedUntil: string | null;
};

/**
 * Atomic per-contact lock for WhatsApp inbound processing.
 * Succeeds only when processing_claimed_until IS NULL or expired (< now).
 */
export async function acquireContactProcessingLock(
  contactId: string | number,
  ttlSeconds: number = CONTACT_PROCESSING_LOCK_TTL_SECONDS,
  admin: SupabaseClient = createSupabaseAdminClient()
): Promise<ContactProcessingLockResult> {
  const nowIso = new Date().toISOString();
  const claimedUntil = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  try {
    const { data, error } = await admin
      .from("contacts")
      .update({ processing_claimed_until: claimedUntil })
      .eq("id", contactId)
      .or(`processing_claimed_until.is.null,processing_claimed_until.lt.${nowIso}`)
      .select("id");

    if (error) {
      if (/processing_claimed_until|column|does not exist|schema cache/i.test(error.message)) {
        console.warn(
          "[wa-contact-processing-lock] column unavailable — fail-open (no lock):",
          error.message
        );
        return { acquired: true, claimedUntil: null };
      }
      console.error("[wa-contact-processing-lock] acquire failed:", error.message);
      return { acquired: false, claimedUntil: null };
    }

    const acquired = Array.isArray(data) && data.length > 0;
    return { acquired, claimedUntil: acquired ? claimedUntil : null };
  } catch (e) {
    console.error("[wa-contact-processing-lock] acquire exception:", e);
    return { acquired: false, claimedUntil: null };
  }
}

/** Release only if we still hold the exact claim (prevents clearing a newer handler's lock). */
export async function releaseContactProcessingLock(
  contactId: string | number,
  claimedUntil: string,
  admin: SupabaseClient = createSupabaseAdminClient()
): Promise<void> {
  try {
    const { error } = await admin
      .from("contacts")
      .update({ processing_claimed_until: null })
      .eq("id", contactId)
      .eq("processing_claimed_until", claimedUntil);
    if (error) {
      console.error("[wa-contact-processing-lock] release failed:", error.message);
    }
  } catch (e) {
    console.error("[wa-contact-processing-lock] release exception:", e);
  }
}
