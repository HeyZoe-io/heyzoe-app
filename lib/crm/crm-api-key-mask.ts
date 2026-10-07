const MASK_PREFIX = "••••";

export function crmApiKeyLast4(key: string | null | undefined): string | null {
  const trimmed = String(key ?? "").trim();
  if (!trimmed) return null;
  return trimmed.slice(-4);
}

export function crmApiKeyMaskLabel(last4: string | null | undefined): string | null {
  const tail = String(last4 ?? "").trim();
  if (!tail) return null;
  return `${MASK_PREFIX}${tail}`;
}

/** Empty or a mask placeholder. Must not replace the stored key. */
export function isCrmApiKeyMaskOrEmpty(value: unknown): boolean {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return true;
  if (/^[•*]/.test(trimmed)) return true;
  if (trimmed.startsWith(MASK_PREFIX)) return true;
  return false;
}

/**
 * Untouched, cleared, or masked input keeps the previous key.
 * Only a new non-empty value that is not a mask replaces it.
 */
export function resolveStoredCrmApiKey(incoming: unknown, previous: string | null | undefined): string | null {
  const prev = String(previous ?? "").trim();
  if (incoming === undefined || incoming === null || isCrmApiKeyMaskOrEmpty(incoming)) {
    return prev || null;
  }
  return String(incoming).trim();
}
