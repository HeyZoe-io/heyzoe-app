/** True when searchUser is still needed to fill user and/or studio profile id. */
export function needsArboxUserSearch(cached: {
  userId?: string | null;
  profileId?: string | null;
}): boolean {
  return !String(cached.userId ?? "").trim() || !String(cached.profileId ?? "").trim();
}
