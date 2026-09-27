/**
 * {{1}} for template sends.
 * Arbox first name wins when we have one. Otherwise the stored name's first
 * token, and only if it looks like a person's name. Null means skip the send.
 */

export const NO_VALID_TEMPLATE_NAME = "no_valid_name";

export type TemplateNameContact = {
  full_name?: string | null;
};

const BLOCKED_NAME_WORDS = [
  "studio",
  "סטודיו",
  "בעמ",
  "ltd",
  "shop",
  "חנות",
  "group",
  "team",
  "fitness",
  "gym",
  "official",
];

function firstToken(raw: string | null | undefined): string {
  return (
    String(raw ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)[0] ?? ""
  );
}

function normalizedToken(token: string): string {
  return token.toLowerCase().replace(/["'״׳`.]/g, "");
}

function isBusinessLikeToken(token: string): boolean {
  const n = normalizedToken(token);
  if (!n) return true;
  return BLOCKED_NAME_WORDS.some((word) => n === word || n.includes(word));
}

/** Stored-name token only. Arbox names are not run through this filter. */
export function isUsableStoredFirstName(token: string): boolean {
  const name = String(token ?? "").trim();
  if (!name) return false;
  if (/[_\d@]/.test(name)) return false;
  const chars = Array.from(name);
  if (chars.length < 2 || chars.length > 20) return false;
  if (isBusinessLikeToken(name)) return false;
  return true;
}

/**
 * 1. First token of `arboxFirstName` when that string is non-empty.
 * 2. Else the first token of `contact.full_name` if it passes the name filter.
 * 3. Else null — caller skips the send (`no_valid_name`).
 */
export function resolveTemplateFirstName(
  contact: TemplateNameContact | null | undefined,
  arboxFirstName?: string | null
): string | null {
  const fromArbox = firstToken(arboxFirstName);
  if (fromArbox) return fromArbox;
  const stored = firstToken(contact?.full_name);
  if (!isUsableStoredFirstName(stored)) return null;
  return stored;
}
