/**
 * {{1}} for template sends.
 * Arbox first name wins when it passes the shared sanitizer. An email, URL,
 * phone, or any digit is invalid and does not fall through (the caller skips).
 * trial_reminder uses resolveTrialReminderFirstName instead.
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

/** Email, URL, phone, "@", or any digit (including a handle like iilan6857). */
export function isRejectedFirstNameToken(token: string): boolean {
  const name = String(token ?? "").trim();
  if (!name) return true;
  if (/[0-9@]/.test(name)) return true;
  if (/:\/\//.test(name) || /^www\./i.test(name)) return true;
  return false;
}

/** Stored-name token only. Arbox names are not run through the business-word filter. */
export function isUsableStoredFirstName(token: string): boolean {
  const name = String(token ?? "").trim();
  if (!name) return false;
  if (isRejectedFirstNameToken(name)) return false;
  if (/_/.test(name)) return false;
  const chars = Array.from(name);
  if (chars.length < 2 || chars.length > 20) return false;
  if (isBusinessLikeToken(name)) return false;
  return true;
}

export const TRIAL_REMINDER_NAME_FALLBACK = "🙂";

function storedContactFirstName(contact: TemplateNameContact | null | undefined): string | null {
  const tokens = nameTokens(contact?.full_name);
  if (tokens.some((token) => isBusinessLikeToken(token))) return null;
  const stored = tokens[0] ?? "";
  if (!isUsableStoredFirstName(stored)) return null;
  return capitalizeLowerLatin(stored);
}

/**
 * 1. First token of `arboxFirstName` when it passes the shared sanitizer.
 * 2. An invalid Arbox token does not fall through — the caller skips (`no_valid_name`).
 * 3. Else the stored contact name, when that token looks like a person's name.
 * 4. Else null.
 */
export function resolveTemplateFirstName(
  contact: TemplateNameContact | null | undefined,
  arboxFirstName?: string | null
): string | null {
  const fromArbox = firstToken(arboxFirstName);
  if (fromArbox) {
    if (isRejectedFirstNameToken(fromArbox)) return null;
    return fromArbox;
  }
  return storedContactFirstName(contact);
}

/**
 * trial_reminder only. Invalid Arbox name falls through to the HeyZoe contact
 * name, then "🙂". Never returns null.
 */
export function resolveTrialReminderFirstName(
  contact: TemplateNameContact | null | undefined,
  arboxFirstName?: string | null
): string {
  const fromArbox = firstToken(arboxFirstName);
  if (fromArbox && !isRejectedFirstNameToken(fromArbox)) return fromArbox;
  return storedContactFirstName(contact) ?? TRIAL_REMINDER_NAME_FALLBACK;
}
