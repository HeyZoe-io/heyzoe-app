import { normalizeCrmType } from "@/lib/crm/types";

export const ARBOX_MANAGE_USER_PROFILE_BASE = "https://manage.arboxapp.com/user-profile";

const PROFILE_LINK_ID_RE = /\/user-profile\/(\d+)/;

/** Digits from searchUser `profile_link` (full URL). Null on missing/garbage. */
export function extractArboxProfileIdFromLink(link: unknown): string | null {
  const raw = String(link ?? "").trim();
  if (!raw) return null;
  const m = PROFILE_LINK_ID_RE.exec(raw);
  const id = m?.[1]?.trim() ?? "";
  return id || null;
}

/**
 * Deep-link to the Arbox manage user-profile card.
 * Uses the studio-specific profile id (contacts.arbox_profile_id), not arbox_user_id.
 */
export function buildArboxUserProfileUrl(input: {
  crmType?: unknown;
  arboxProfileId?: unknown;
}): string | null {
  if (normalizeCrmType(input.crmType) !== "arbox") return null;
  const id = String(input.arboxProfileId ?? "").trim();
  if (!id) return null;
  return `${ARBOX_MANAGE_USER_PROFILE_BASE}/${encodeURIComponent(id)}`;
}
