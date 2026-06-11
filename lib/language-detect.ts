export type DetectedMessageLanguage = "he" | "en" | "unknown";

function isHebrewLetter(code: number): boolean {
  return code >= 0x0590 && code <= 0x05ff;
}

function isEnglishLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/** Simple script detection for Hebrew vs English (no extra LLM call). */
export function detectMessageLanguage(text: string): DetectedMessageLanguage {
  const s = String(text ?? "");
  let he = 0;
  let en = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (isHebrewLetter(code)) he += 1;
    else if (isEnglishLetter(code)) en += 1;
  }
  const total = he + en;
  if (total === 0) return "unknown";
  if (he > en) return "he";
  if (en > he) return "en";
  return "unknown";
}
