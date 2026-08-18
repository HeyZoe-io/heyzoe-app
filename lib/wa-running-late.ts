import { looksLikeLeadQuestion } from "@/lib/wa-split-answer";

/** אישור קצר לאיחור / «אני בדרך» — בלי Claude. */
export const RUNNING_LATE_ACK_MESSAGE = "בסדר גמור אנחנו כאן.";

const LATE_RE =
  /איחר(?:תי|נו|ה|ת)|מאחר(?:ת|ים|ות)?(?:\s|$)|נאלצ(?:תי|ת|נו)\s+לאחר|חייבת\s+לאחר|running\s+late/iu;
const ON_THE_WAY_RE = /(?:אני|אנחנו)\s+בדרך|בדרך\s+אלי(?:כם|נו)|on\s+my\s+way/iu;
const JOIN_SOON_RE =
  /אצטרף|אגיע(?:\s+כאשר|\s+כש|\s+בעוד)|בעוד\s+.{0,24}דק/iu;

/**
 * עדכון «מאחרת / בדרך / אצטרף בעוד כמה דקות» בלי שאלה.
 * לא דחיית שיעור (matchesClassRescheduleUpdate) ולא שאלת הגעה.
 */
export function matchesRunningLateStatusUpdate(raw: string): boolean {
  const t = String(raw ?? "").trim();
  if (!t || t.length > 600) return false;
  if (looksLikeLeadQuestion(t)) return false;
  const late = LATE_RE.test(t);
  const onTheWay = ON_THE_WAY_RE.test(t);
  const joinSoon = JOIN_SOON_RE.test(t);
  if (late && (onTheWay || joinSoon || /לא\s+מוותר/u.test(t))) return true;
  if (onTheWay && joinSoon) return true;
  return false;
}
