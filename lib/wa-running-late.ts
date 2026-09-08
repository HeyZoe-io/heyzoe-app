import { looksLikeLeadQuestion } from "@/lib/wa-split-answer";

/** אישור בלי ETA — כשאין מספר דקות בהודעה. */
export const RUNNING_LATE_ACK_MESSAGE = "אין בעיה בכלל! 🙂 אנחנו כאן.";

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

/** מספר דקות שהליד כתב («בעוד בערך 10 דק'») — לא ממציאים. */
export function extractRunningLateEtaMinutes(raw: string): number | null {
  const t = String(raw ?? "");
  const he = t.match(/בעוד\s+(?:בערך\s+|כ-?\s*)?(\d{1,2})\s*דק/iu);
  if (he) {
    const n = Number(he[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 90) return n;
  }
  const en = t.match(/\b(?:in|about)\s+(\d{1,2})\s*(?:min(?:ute)?s?)\b/iu);
  if (en) {
    const n = Number(en[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 90) return n;
  }
  return null;
}

/**
 * תבנית קבועה בלי Claude: אישור + אנחנו כאן + הד ל-ETA אם נכתב.
 * בלי «קח את הזמן» / «בטוח שזה יעבוד» / «עד עכשיו».
 */
export function buildRunningLateAck(raw: string): string {
  const minutes = extractRunningLateEtaMinutes(raw);
  if (minutes == null) return RUNNING_LATE_ACK_MESSAGE;
  return `אין בעיה בכלל! 🙂 אנחנו כאן, נראה אותך בעוד ${minutes} דקות.`;
}
