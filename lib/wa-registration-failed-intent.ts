/** זיהוי «ניסיתי להירשם ונכשל» — intent מפורש בלבד, לא על כל inbound. */

function normalizeRegistrationFailedText(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .replace(/\s+/g, " ");
}

function hasRegisterOrBookingContext(t: string): boolean {
  return /לה[יי]?רשם|הרשמ(?:ה|ות)?|לשריין|לשיבוץ|לקבוע\s+(?:שיעור|אימון)|\bregist|\bsign\s*up\b|\bbook(?:ing|ed)?\b/iu.test(
    t
  );
}

function hasFailureLanguage(t: string): boolean {
  return (
    /לא\s+הצלח(?:תי|נו|ת)|לא\s+מצליח(?:ה|ים)?|נכשל(?:ה)?|לא\s+עובד(?:ת)?|לא\s+נות(?:ן|נת|נים)|תקוע(?:ה)?|שגיא(?:ה|ות)|לא\s+עבר(?:ה)?/u.test(
      t
    ) ||
    /didn['’]?t\s+work|doesn['’]?t\s+work|fail(?:ed)?|unable|can['’]?t\s+(?:register|book|sign)|won['’]?t\s+let/i.test(
      t
    )
  );
}

function hasTriedToRegister(t: string): boolean {
  return (
    /ניס(?:יתי|ינו|תה|ית)\s+לה[יי]?רשם/u.test(t) ||
    /tried\s+to\s+(?:register|sign\s*up|book)/i.test(t) ||
    /לא\s+נרשם\s+לי/u.test(t) ||
    /לא\s+נרשמ[הת]י?\s+לי/u.test(t) ||
    /ההרשמ(?:ה)?\s+לא\s+(?:עבר(?:ה)?|עובד(?:ת)?|מצליח)/u.test(t)
  );
}

/**
 * הליד אומר שהרשמה/שיבוץ נכשלו — לא «רוצה להירשם», לא מערכת שעות, לא «מתי קבענו».
 */
export function isRegistrationFailedInquiry(raw: string): boolean {
  const t = normalizeRegistrationFailedText(raw);
  if (!t || t.length > 500) return false;

  if (
    /מתי\s+(?:יש|אפשר|ניתן)\s+(?:להגיע|לבוא|שיעור|אימון)|מערכת\s+ה?שעות|לוח\s+(?:ה)?שיעורים/u.test(t)
  ) {
    return false;
  }

  if (hasTriedToRegister(t)) return true;
  return hasRegisterOrBookingContext(t) && hasFailureLanguage(t);
}
