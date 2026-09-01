export type DetectedMessageLanguage = "he" | "en" | "ru" | "unknown";

function isHebrewLetter(code: number): boolean {
  return code >= 0x0590 && code <= 0x05ff;
}

function isEnglishLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/** Cyrillic (Russian / related) — BMP block only, no extra LLM call. */
function isCyrillicLetter(code: number): boolean {
  return code >= 0x0400 && code <= 0x04ff;
}

/** Simple script detection for Hebrew vs English vs Russian (no extra LLM call). */
export function detectMessageLanguage(text: string): DetectedMessageLanguage {
  const s = String(text ?? "");
  let he = 0;
  let en = 0;
  let ru = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (isHebrewLetter(code)) he += 1;
    else if (isCyrillicLetter(code)) ru += 1;
    else if (isEnglishLetter(code)) en += 1;
  }
  const total = he + en + ru;
  if (total === 0) return "unknown";
  const max = Math.max(he, en, ru);
  const winners = [
    he === max ? "he" : null,
    en === max ? "en" : null,
    ru === max ? "ru" : null,
  ].filter(Boolean);
  if (winners.length !== 1) return "unknown";
  return winners[0] as "he" | "en" | "ru";
}

export function pickByDetectedLanguage<T>(
  lang: DetectedMessageLanguage | undefined,
  copies: { he: T; en: T; ru: T }
): T {
  if (lang === "en") return copies.en;
  if (lang === "ru") return copies.ru;
  return copies.he;
}
