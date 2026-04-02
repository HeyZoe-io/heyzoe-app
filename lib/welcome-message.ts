/** פירוק/הרכבה של הודעת פתיחה: גוף (בועה) + צ'יפים (כפתורים) */

export function buildWelcomeMessageForStorage(intro: string, question: string, options: string[]): string {
  const trimmed = options.map((o) => o.trim()).filter(Boolean);
  const optLines = trimmed.map((o, i) => `${i + 1}. ${o}`);
  return [intro.trim(), question.trim(), ...optLines].filter(Boolean).join("\n");
}

function parseNumberedTail(lines: string[]): { bodyLines: string[]; chips: string[] } {
  const body = [...lines];
  const chips: string[] = [];
  while (body.length > 0) {
    const line = body[body.length - 1].trim();
    if (!line) {
      body.pop();
      continue;
    }
    const m = line.match(/^\d+\.\s*(.+)$/);
    if (m) {
      chips.unshift(m[1].trim());
      body.pop();
      continue;
    }
    break;
  }
  return { bodyLines: body, chips };
}

export function splitWelcomeForChat(
  fullWelcome: string,
  social: Record<string, unknown> | null | undefined
): { body: string; chips: string[] } {
  const s = social && typeof social === "object" && !Array.isArray(social) ? social : null;
  const intro = typeof s?.welcome_intro === "string" ? s.welcome_intro.trim() : "";
  const question = typeof s?.welcome_question === "string" ? s.welcome_question.trim() : "";
  const rawOpts = Array.isArray(s?.welcome_options) ? s.welcome_options : null;
  const optsFromSocial = rawOpts ? rawOpts.map((x) => String(x ?? "").trim()).filter(Boolean) : [];

  if (intro || question || optsFromSocial.length > 0) {
    const body = [intro, question].filter(Boolean).join("\n\n");
    const chips = optsFromSocial.length > 0 ? optsFromSocial : parseNumberedTail(fullWelcome.split("\n")).chips;
    return { body: body || fullWelcome.trim(), chips };
  }

  const lines = fullWelcome.split("\n");
  const { bodyLines, chips } = parseNumberedTail(lines);
  const body = bodyLines.join("\n").trim();
  return { body: body || fullWelcome.trim(), chips };
}
