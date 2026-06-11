import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { detectMessageLanguage } from "@/lib/language-detect";
import type { WaIdleFollowupCta } from "@/lib/whatsapp";
import { resolveWaFollowupRegistrationCta } from "@/lib/wa-followup-registration-cta";

/** כפתור תשובה בפולואפ — מפעיל מחדש את פלואו המכירה (כמו טקסט «אשמח לפרטים»). */
export const WA_FOLLOWUP_RESTART_BUTTON_LABEL_HE = "אשמח לפרטים";
export const WA_FOLLOWUP_RESTART_BUTTON_LABEL_EN = "More info please";

/** @deprecated Prefer resolveWaFollowupRestartButtonLabel — Hebrew default for backward compat. */
export const WA_FOLLOWUP_RESTART_BUTTON_LABEL = WA_FOLLOWUP_RESTART_BUTTON_LABEL_HE;

const EARLY_FOLLOWUP_SESSION_PHASES = new Set([
  "opening",
  "warmup",
  "schedule_date",
  "schedule_time",
]);

function contentLangFromSocialLinks(social_links?: unknown): "he" | "en" {
  const sl =
    social_links && typeof social_links === "object" && !Array.isArray(social_links)
      ? (social_links as Record<string, unknown>)
      : {};
  const welcomeIntro = typeof sl.welcome_intro === "string" ? sl.welcome_intro.trim() : "";
  const rawSf = sl.sales_flow;
  const sf =
    rawSf && typeof rawSf === "object" && !Array.isArray(rawSf)
      ? (rawSf as Record<string, unknown>)
      : {};
  const greetingOpener = typeof sf.greeting_opener === "string" ? sf.greeting_opener.trim() : "";
  const sample = welcomeIntro || greetingOpener;
  if (!sample) return "he";
  return detectMessageLanguage(sample) === "en" ? "en" : "he";
}

/** Label for follow-up restart button — Hebrew or English from business content in DB. */
export function resolveWaFollowupRestartButtonLabel(social_links?: unknown): string {
  return contentLangFromSocialLinks(social_links) === "en"
    ? WA_FOLLOWUP_RESTART_BUTTON_LABEL_EN
    : WA_FOLLOWUP_RESTART_BUTTON_LABEL_HE;
}

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
    return { mode: "reply", label: resolveWaFollowupRestartButtonLabel(input.social_links) };
  }

  const registration = await resolveWaFollowupRegistrationCta(input);
  if (!registration) return null;
  return { mode: "url", label: registration.label, url: registration.url };
}
