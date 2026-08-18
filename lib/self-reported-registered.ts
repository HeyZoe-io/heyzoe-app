/**
 * Keyword detector: the lead says they already registered.
 * Does not set trial_registered (Arbox/link path). Used to suppress follow-ups.
 */

function normalizeSelfReportedRegisteredText(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/[\u200e\u200f\u202a-\u202e\ufeff]/g, "")
    .toLowerCase()
    .replace(/[!?….,;:"'׳״()[\]{}~`\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NEGATION_BEFORE_REGISTERED_RE =
  /(?:^|\s)(?:לא|עדיין\s+לא|טרם)\s+(?:כבר\s+)?נ[יי]?רשמ(?:תי|נו|ת)/u;

const NEGATION_EN_RE =
  /(?:^|\s)(?:not|haven't|have not|didn't|did not|haven't yet)\s+(?:already\s+)?(?:register|signed)/u;

/** First-person registered stems, including the lead spelling נירשמנו. */
const REGISTERED_FIRST_PERSON_RE = /נ[יי]?רשמ(?:תי|נו|ת)/u;

const POSITIVE_PHRASES = [
  "נרשמתי",
  "נרשמנו",
  "נרשמת",
  "נירשמתי",
  "נירשמנו",
  "כבר נרשמתי",
  "כבר נרשמנו",
  "כבר נרשמת",
  "נרשמנו לאפליקציה",
  "נרשמתי לאפליקציה",
  "כבר נרשמנו לאפליקציה",
  "כבר נרשמתי לאפליקציה",
  "כבר קיבלנו ונירשמנו",
  "כבר קיבלנו ונרשמנו",
  "כבר קיבלנו ונירשמנו לאפליקציה",
  "כבר קיבלנו ונרשמנו לאפליקציה",
  "already registered",
  "i already registered",
  "we already registered",
  "already signed up",
  "i already signed up",
];

export function matchesSelfReportedRegistered(raw: string): boolean {
  const t = normalizeSelfReportedRegisteredText(raw);
  if (!t || t.length > 400) return false;
  if (NEGATION_BEFORE_REGISTERED_RE.test(t)) return false;
  if (NEGATION_EN_RE.test(t)) return false;
  if (POSITIVE_PHRASES.some((p) => t === p || t.includes(p))) return true;
  if (!REGISTERED_FIRST_PERSON_RE.test(t)) return false;
  // Longer sentence with first-person stem, e.g. «סיימנו ונירשמנו באפליקציה».
  return true;
}
