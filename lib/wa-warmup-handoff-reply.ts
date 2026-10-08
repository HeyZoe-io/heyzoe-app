/**
 * Scripted warmup reply written by the business as a hand-off to staff
 * (e.g. «מועבר לנציג»). Zoe must not continue the sales flow after it.
 */
const HANDOFF_REPLY_RE =
  /(?:מועבר|מועברת|מועברים|מעבירה|מעבירים|נעביר|אעביר)\s+(?:אותך\s+|אותכם\s+)?(?:ל|אל\s+)?(?:ה)?נציג|נציג(?:ה)?\s+(?:אנושי(?:ת)?\s+)?(?:יחזור|תחזור|יצור|ייצור|תיצור|יחזרו|יצרו)|\b(?:transferring|forwarding|passing)\s+you\s+to\s+(?:a|an|our)\s+(?:agent|representative|team\s+member)\b/iu;

export function isWarmupHandoffReply(text: string | null | undefined): boolean {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return false;
  return HANDOFF_REPLY_RE.test(s);
}
