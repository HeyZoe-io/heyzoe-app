const GREETING_PREFIX_RE = /^(?:היי+|הי|אהלן|שלום|hey|hi)\s+/iu;

const OWNER_ADDRESSED_INTRO_RE =
  /^(?:היי+|הי|אהלן|שלום|hey|hi)\s+([\p{L}]{2,20})\s+(?:זה|כאן|מ)\s+([\p{L}'׳]{2,24}(?:\s+[\p{L}'׳]{2,24})?)\s*[.!?]*$/iu;

const SKIP_ADDRESSED_NAMES = new Set([
  "פרטים",
  "ניסיון",
  "אימון",
  "שיעור",
  "תודה",
  "אפשר",
  "אשמח",
  "בוקר",
  "ערב",
  "שלום",
]);

export type OwnerAddressedGreeting = {
  ownerName: string;
  leadName: string;
};

function foldName(raw: string): string {
  return String(raw ?? "")
    .replace(/[׳'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * «אהלן יגאל זה דוד» / «היי יגאל כאן דוד» — פנייה למאמן בשמו + הצגת הליד.
 * לא «אהלן אשמח לפרטים» ולא שאלת אימון.
 */
export function parseOwnerAddressedGreeting(text: string): OwnerAddressedGreeting | null {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 72 || !GREETING_PREFIX_RE.test(t)) return null;
  const m = t.match(OWNER_ADDRESSED_INTRO_RE);
  if (!m) return null;
  const ownerName = foldName(m[1] ?? "");
  const leadName = foldName(m[2] ?? "");
  if (!ownerName || !leadName) return null;
  if (SKIP_ADDRESSED_NAMES.has(ownerName) || SKIP_ADDRESSED_NAMES.has(leadName)) return null;
  if (ownerName === leadName) return null;
  return { ownerName, leadName };
}

export function isOwnerAddressedGreeting(text: string): boolean {
  return parseOwnerAddressedGreeting(text) != null;
}

/** כאן {bot}, הבוטית של {owner} — לא נציגת האקדמיה. */
export function buildOwnerAddressedGreetingReply(
  botName: string,
  parsed: OwnerAddressedGreeting
): string {
  const bot = String(botName ?? "").trim() || "זואי";
  return `היי ${parsed.leadName}! כאן ${bot}, הבוטית של ${parsed.ownerName}. איך אפשר לעזור?`;
}

const ACADEMY_RECEPTIONIST_RE =
  /אני\s+\S{1,20}[,]?\s+(?:ה)?נציג(?:ת|ה)(?:\s+השירות)?\s+של\s+האקדמיה/iu;

/**
 * תשובת מודל שמציגה את זואי כנציגת אקדמיה נפרדת.
 * האקדמיה רק לנושאים מנהלתיים — לא בברכת זהות.
 */
export function rewriteAcademyReceptionistIdentity(
  text: string,
  botName: string,
  ownerFallbackName?: string
): string {
  const raw = String(text ?? "").trim();
  if (!raw || !ACADEMY_RECEPTIONIST_RE.test(raw)) return raw;
  const bot = String(botName ?? "").trim() || "זואי";
  const owner = String(ownerFallbackName ?? "").trim();
  const identity = owner
    ? `כאן ${bot}, הבוטית של ${owner}.`
    : `כאן ${bot}, הבוטית של העסק.`;
  return `היי! ${identity} איך אפשר לעזור?`;
}
