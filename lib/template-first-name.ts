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
  "חברה",
  "inc",
  "llc",
];

/** ASCII quotes, Hebrew geresh/gershayim, and curly quotes. Dots so ltd. matches ltd. */
const QUOTE_OR_DOT = /["'״׳`´.\u05F3\u05F4\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u201F\u2032\u2033\uFF07\u00B4]/g;

function nameTokens(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function capitalizeLowerLatin(token: string): string {
  if (!/^[a-z]+$/.test(token)) return token;
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function firstToken(raw: string | null | undefined): string {
  return capitalizeLowerLatin(nameTokens(raw)[0] ?? "");
}

function normalizedToken(token: string): string {
  return token.toLowerCase().replace(QUOTE_OR_DOT, "");
}

function isBusinessLikeToken(token: string): boolean {
  const n = normalizedToken(token);
  if (!n) return true;
  return BLOCKED_NAME_WORDS.some((word) => {
    if (word.length <= 3) return n === word;
    return n === word || n.includes(word);
  });
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
 * 1. First token of `arboxFirstName` when that string is non-empty (unfiltered).
 * 2. Else the first token of `contact.full_name`, unless any token of that
 *    full stored name is a business word.
 * 3. Else null — caller skips the send (`no_valid_name`).
 */
export function resolveTemplateFirstName(
  contact: TemplateNameContact | null | undefined,
  arboxFirstName?: string | null
): string | null {
  const fromArbox = firstToken(arboxFirstName);
  if (fromArbox) return fromArbox;
  const tokens = nameTokens(contact?.full_name);
  if (tokens.some((token) => isBusinessLikeToken(token))) return null;
  const stored = tokens[0] ?? "";
  if (!isUsableStoredFirstName(stored)) return null;
  return capitalizeLowerLatin(stored);
}
