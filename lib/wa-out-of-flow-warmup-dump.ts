/**
 * מחוץ לפלואו מכירה המודל לפעמים מעתיק שאלת חימום + כפתורים לטקסט (עם «|»).
 * במקום זה: שאלת מנוי, ואם רוצים התאמת ניסיון — לכתוב «בואו נתחיל» (פותח את הפלואו עם כפתורים).
 */

export const OUT_OF_FLOW_MEMBER_OR_TRIAL_INVITE =
  "יש לך מנוי קיים אצלנו, או שמדובר באימון ניסיון?\nרוצה שנתאים עבורך אימון ניסיון? אם כן נא לכתוב לי ״בואו נתחיל״ ונעשה זאת יחד!";

type WarmupStepLike = { question?: string | null; options?: string[] | null };

export type WarmupDumpConfig = {
  experience_question?: string | null;
  experience_options?: string[] | null;
  opening_extra_steps?: WarmupStepLike[] | null;
  experience_question_workshop?: string | null;
  experience_options_workshop?: string[] | null;
  opening_extra_steps_workshop?: WarmupStepLike[] | null;
  experience_question_course?: string | null;
  experience_options_course?: string[] | null;
  opening_extra_steps_course?: WarmupStepLike[] | null;
};

type WarmupMenu = { question: string; options: string[] };

function cleanLabel(raw: string): string {
  return String(raw ?? "").trim();
}

function pushMenu(out: WarmupMenu[], question: string | null | undefined, options: string[] | null | undefined): void {
  const opts = (options ?? []).map(cleanLabel).filter(Boolean);
  if (opts.length < 2) return;
  out.push({ question: cleanLabel(question ?? ""), options: opts });
}

function pushSteps(out: WarmupMenu[], steps: WarmupStepLike[] | null | undefined): void {
  for (const step of steps ?? []) pushMenu(out, step.question, step.options);
}

export function collectWarmupMenus(cfg: WarmupDumpConfig | null | undefined): WarmupMenu[] {
  if (!cfg) return [];
  const out: WarmupMenu[] = [];
  pushMenu(out, cfg.experience_question, cfg.experience_options);
  pushSteps(out, cfg.opening_extra_steps);
  pushMenu(out, cfg.experience_question_workshop, cfg.experience_options_workshop);
  pushSteps(out, cfg.opening_extra_steps_workshop);
  pushMenu(out, cfg.experience_question_course, cfg.experience_options_course);
  pushSteps(out, cfg.opening_extra_steps_course);
  return out;
}

function norm(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[?!.,:;"'״׳]/gu, "")
    .replace(/\s+/g, " ");
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function replyDumpsWarmupMenuAsText(text: string, cfg: WarmupDumpConfig | null | undefined): boolean {
  const menus = collectWarmupMenus(cfg);
  const n = norm(text);
  if (!n || !menus.length) return false;
  const hasPipe = text.includes("|");
  for (const menu of menus) {
    const hits = menu.options.map(norm).filter((o) => o.length >= 2 && n.includes(o));
    if (hits.length < 2) continue;
    const q = norm(menu.question);
    if (q && n.includes(q)) return true;
    if (hasPipe) return true;
  }
  return false;
}

function tidyAck(raw: string): string {
  let s = String(raw ?? "");
  s = s.replace(/בואי\s+נתחיל[יה]?[!?.]*\s*/gu, "");
  s = s.replace(/בואו\s+נתחיל[!?.]*\s*/gu, "");
  s = s.replace(/\s*\|\s*/g, " ");
  s = s.replace(/[ \t]{2,}/g, " ");
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.replace(/\s+([!?.,])/g, "$1");
  return s.trim();
}

function ackHasWords(raw: string): boolean {
  return /[\u0590-\u05FF]{2,}/u.test(raw);
}

/** null = אין העתקת תפריט חימום, משאירים את התשובה. */
export function rewriteOutOfFlowWarmupTextDump(
  text: string,
  cfg: WarmupDumpConfig | null | undefined
): string | null {
  if (!replyDumpsWarmupMenuAsText(text, cfg)) return null;
  let s = String(text ?? "");
  for (const menu of collectWarmupMenus(cfg)) {
    const labels = menu.options.filter((o) => o.length >= 2);
    if (labels.length >= 2) {
      const alt = labels.map(escapeRegExp).join("|");
      const pipeRe = new RegExp(`(?:${alt})(?:\\s*\\|\\s*(?:${alt}))+`, "gu");
      s = s.replace(pipeRe, "");
    }
    const q = menu.question.trim();
    if (q) {
      const idx = s.indexOf(q);
      if (idx >= 0) s = s.slice(0, idx);
    }
  }
  const ack = tidyAck(s);
  if (!ackHasWords(ack)) return OUT_OF_FLOW_MEMBER_OR_TRIAL_INVITE;
  if (ack.includes(OUT_OF_FLOW_MEMBER_OR_TRIAL_INVITE)) return ack;
  return `${ack}\n\n${OUT_OF_FLOW_MEMBER_OR_TRIAL_INVITE}`;
}
