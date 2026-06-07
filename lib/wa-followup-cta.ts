import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { WaIdleFollowupCta } from "@/lib/whatsapp";
import { resolveWaFollowupRegistrationCta } from "@/lib/wa-followup-registration-cta";

/** כפתור תשובה בפולואפ — מפעיל מחדש את פלואו המכירה (כמו טקסט «אשמח לפרטים»). */
export const WA_FOLLOWUP_RESTART_BUTTON_LABEL = "אשמח לפרטים";

const EARLY_FOLLOWUP_SESSION_PHASES = new Set([
  "opening",
  "warmup",
  "schedule_date",
  "schedule_time",
]);

/** לידים שלא הגיעו ל-CTA — כפתור «אשמח לפרטים» במקום קישור הרשמה. */
export function shouldWaFollowupUseRestartButton(sessionPhase: string | null | undefined): boolean {
  const phase = String(sessionPhase ?? "")
    .trim()
    .toLowerCase();
  if (!phase) return true;
  return EARLY_FOLLOWUP_SESSION_PHASES.has(phase);
}

/**
 * כפתור פולואפ: שלבים מוקדמים → reply «אשמח לפרטים»; שלב CTA → קישור הרשמה.
 */
export async function resolveWaFollowupCta(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  business_slug: string;
  session_ids: string[];
  social_links?: unknown;
  session_phase?: string | null;
}): Promise<WaIdleFollowupCta | null> {
  if (shouldWaFollowupUseRestartButton(input.session_phase)) {
    return { mode: "reply", label: WA_FOLLOWUP_RESTART_BUTTON_LABEL };
  }

  const registration = await resolveWaFollowupRegistrationCta(input);
  if (!registration) return null;
  return { mode: "url", label: registration.label, url: registration.url };
}
