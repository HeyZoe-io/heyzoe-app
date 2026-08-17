export type SettingsPresencePayload = {
  client_id?: string;
  user_id?: string;
  name?: string;
  online_at?: string;
  is_admin?: boolean;
};

export function presenceIsAdmin(row: SettingsPresencePayload): boolean {
  return row.is_admin === true;
}

export function presenceDedupeKey(row: SettingsPresencePayload): string {
  return String(row.user_id ?? "").trim() || String(row.client_id ?? "").trim();
}

export function pickEarliestPresence(rows: SettingsPresencePayload[]): SettingsPresencePayload | null {
  return (
    [...rows].sort((a, b) => {
      const at = String(a.online_at ?? "");
      const bt = String(b.online_at ?? "");
      if (at !== bt) return at.localeCompare(bt);
      return String(a.client_id ?? "").localeCompare(String(b.client_id ?? ""));
    })[0] ?? null
  );
}

export function uniqueOtherEditorNames(rows: SettingsPresencePayload[], fallbackName: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of rows) {
    const dedupeKey = presenceDedupeKey(row);
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    names.push(String(row.name ?? "").trim() || fallbackName);
  }
  return names;
}

/**
 * Concurrent-edit popup:
 * - Two regular users → both see it.
 * - Admin + regular user → only the admin sees it (the customer is not notified).
 */
export function resolvePresencePopup(opts: {
  currentUserIsAdmin: boolean;
  otherPresences: SettingsPresencePayload[];
  fallbackName: string;
}): { show: boolean; editorNames: string[] } {
  const others = opts.otherPresences;
  if (!others.length) return { show: false, editorNames: [] };

  const otherAdminPresent = others.some(presenceIsAdmin);
  if (!opts.currentUserIsAdmin && otherAdminPresent) {
    return { show: false, editorNames: [] };
  }

  const editorNames = uniqueOtherEditorNames(others, opts.fallbackName);
  return { show: editorNames.length > 0, editorNames };
}
