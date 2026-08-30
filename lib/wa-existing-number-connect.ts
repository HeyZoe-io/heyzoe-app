/**
 * Detect when Embedded Signup / PARTNER_ADDED attached an existing WhatsApp
 * number (coexistence), even if `businesses.onboarding_type` was never set.
 *
 * Dashboard "connect to Meta" is always an existing-number flow. If the
 * onboarding path-choice was skipped, type stays null and the old code treated
 * that as "provision a new number" — WABA saved, display number not copied.
 */

export type WabaPhonePick = {
  id: string;
  display_phone_number?: string;
  status?: string;
};

export function shouldUseExistingNumberConnect(opts: {
  storedOnboardingType?: string | null;
  requestedOnboardingType?: string | null;
  phoneNumberIdFromClient?: string | null;
  metaPhoneCount?: number;
}): boolean {
  const requested = String(opts.requestedOnboardingType ?? "").trim();
  const stored = String(opts.storedOnboardingType ?? "").trim();
  if (requested === "coexistence" || stored === "coexistence") return true;
  if (String(opts.phoneNumberIdFromClient ?? "").trim()) return true;
  if (requested === "new_provisioned" || stored === "new_provisioned") return false;
  return (opts.metaPhoneCount ?? 0) > 0;
}

export function pickWabaPhone(
  numbers: WabaPhonePick[] | null | undefined,
  preferredId?: string | null
): { phoneNumberId: string; phoneDisplay: string | null } | null {
  const preferred = String(preferredId ?? "").trim();
  const list = Array.isArray(numbers) ? numbers : [];
  if (preferred) {
    const match = list.find((n) => n.id === preferred);
    const fallback = match ?? list[0];
    return {
      phoneNumberId: preferred,
      phoneDisplay: String(fallback?.display_phone_number ?? "").trim() || null,
    };
  }
  const connected = list.filter(
    (n) => String(n.status ?? "").trim().toUpperCase() === "CONNECTED"
  );
  const pick = connected[0] ?? list[0];
  if (!pick?.id) return null;
  return {
    phoneNumberId: pick.id,
    phoneDisplay: String(pick.display_phone_number ?? "").trim() || null,
  };
}
