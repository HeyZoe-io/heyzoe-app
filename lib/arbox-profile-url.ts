import { normalizeCrmType } from "@/lib/crm/types";

export const ARBOX_MANAGE_USER_PROFILE_BASE = "https://manage.arboxapp.com/user-profile";

/**
 * Deep-link to the Arbox manage user-profile card.
 * Same path for leads and members — only the stored contacts.arbox_user_id differs.
 * Returns null when the business is not Arbox or the id is missing (no fetch, no broken link).
 */
export function buildArboxUserProfileUrl(input: {
  crmType?: unknown;
  arboxUserId?: unknown;
}): string | null {
  if (normalizeCrmType(input.crmType) !== "arbox") return null;
  const id = String(input.arboxUserId ?? "").trim();
  if (!id) return null;
  return `${ARBOX_MANAGE_USER_PROFILE_BASE}/${encodeURIComponent(id)}`;
}
