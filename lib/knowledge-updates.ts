import type { KnowledgeQaPair } from "@/lib/knowledge-qa";

/** Owner reply must land inside this window after the handoff. */
export const OWNER_REPLY_WINDOW_MS = 72 * 60 * 60 * 1000;
export const KNOWLEDGE_UPDATE_SESSION_MS = 24 * 60 * 60 * 1000;
export const KNOWLEDGE_UPDATE_LOOKBACK_DAYS = 30;
export const KNOWLEDGE_UPDATE_MAX_PER_BUSINESS = 3;
export const KNOWLEDGE_UPDATE_TEMPLATE = "zoe_knowledge_updates_v1";
export const KNOWLEDGE_UPDATE_LLM_BUDGET_USD = 3;

/**
 * Pilot recipient. "owners" is implemented and stays off until this changes.
 * Admin mode sends every business's suggestions to the Zoe Admin number only.
 */
export const KNOWLEDGE_UPDATES_RECIPIENT_MODE: KnowledgeUpdateRecipientMode = "admin";

export type KnowledgeUpdateRecipientMode = "admin" | "owners";

export type KnowledgeUpdateStatus =
  | "pending"
  | "sent"
  | "added"
  | "skipped"
  | "corrected"
  | "expired";

const IL_TZ = "Asia/Jerusalem";

export type IsraelClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
};

export function israelClock(now: Date): IsraelClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: IL_TZ,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour,
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

/** Tuesday at or after 10:30 Asia/Jerusalem. The hourly cron picks this up. */
export function knowledgeUpdateDue(now: Date): boolean {
  const clock = israelClock(now);
  if (clock.weekday !== "Tue") return false;
  return clock.hour > 10 || (clock.hour === 10 && clock.minute >= 30);
}

/** ISO week of the Asia/Jerusalem civil date. */
export function isoWeekKey(now: Date): string {
  const clock = israelClock(now);
  const utc = new Date(Date.UTC(clock.year, clock.month - 1, clock.day));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** The first owner message has to mention the question. A later message cannot replace it. */
export function ownerReplyAddressesQuestion(question: string, reply: string): boolean {
  const tokens = topicTokens(question);
  if (!tokens.length) return true;
  const hay = reply.toLowerCase();
  return tokens.some((token) => hay.includes(token));
}

export function pairHandoffWithOwnerReply(input: {
  eventAt: number;
  question?: string;
  replies: Array<{ at: number; text: string }>;
  windowMs?: number;
}): string | null {
  const windowMs = input.windowMs ?? OWNER_REPLY_WINDOW_MS;
  const hit = input.replies
    .filter((reply) => {
      const text = reply.text.trim();
      return text && reply.at >= input.eventAt && reply.at - input.eventAt <= windowMs;
    })
    .sort((a, b) => a.at - b.at);
  if (!hit.length) return null;
  const first = hit[0]!;
  if (input.question && !ownerReplyAddressesQuestion(input.question, first.text)) return null;
  const burstEnd = first.at + 2 * 60 * 60 * 1000;
  return hit
    .filter((reply) => reply.at <= burstEnd)
    .map((reply) => reply.text.trim())
    .join("\n");
}

export function acceptClassifiedPair(input: { general: boolean; oneOff: boolean }): boolean {
  return input.general && !input.oneOff;
}

const COVERAGE_STOP = new Set([
  "יש",
  "של",
  "את",
  "על",
  "עם",
  "גם",
  "לא",
  "כן",
  "זה",
  "זו",
  "או",
  "אם",
  "כל",
  "מה",
  "איך",
  "כמה",
  "אפשר",
  "ניתן",
  "אצלנו",
  "רק",
  "עוד",
  "אז",
  "כי",
  "אבל",
  "הוא",
  "היא",
  "הם",
  "אני",
  "אנחנו",
  "אליך",
  "אותך",
  "אליי",
  "אלי",
  "שלך",
  "שלי",
  "לך",
  "לנו",
  "אותי",
  "אותו",
  "אותה",
  "היי",
  "שלום",
  "the",
  "and",
  "for",
]);

function coverageTokens(text: string): string[] {
  const parts = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !COVERAGE_STOP.has(part));
  return [...new Set(parts)];
}

/** Drop a pair when the owner's answer is already in the knowledge the prompt reads. */
export function coveredByKnowledge(answer: string, knowledge: string): boolean {
  const tokens = coverageTokens(answer);
  if (tokens.length < 2) return false;
  const hay = knowledge.toLowerCase();
  const found = tokens.filter((token) => hay.includes(token)).length;
  return found / tokens.length >= 0.7;
}

export type ClassifiedPair = {
  leadKey: string;
  question: string;
  answer: string;
  cluster: string;
  general: boolean;
  oneOff: boolean;
};

export type SelectedCluster = {
  clusterKey: string;
  question: string;
  ownerAnswers: string[];
  leadCount: number;
};

const TOPIC_WEAK = new Set([
  "אימון",
  "אימונים",
  "שיעור",
  "שיעורים",
  "סטודיו",
  "בבקשה",
  "תודה",
  "רוצה",
  "אפשר",
  "אחד",
  "אחת",
  "אשמח",
]);

function topicTokens(text: string): string[] {
  return coverageTokens(text).filter((token) => !TOPIC_WEAK.has(token));
}

function sameTopic(a: string, b: string): boolean {
  const left = topicTokens(a);
  const right = topicTokens(b);
  if (!left.length || !right.length) {
    return a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
  }
  const rightSet = new Set(right);
  const shared = left.filter((token) => rightSet.has(token));
  if (shared.length >= 2) return true;
  const leftSet = new Set(left);
  return left.every((token) => rightSet.has(token)) || right.every((token) => leftSet.has(token));
}

export function readGroundingVerdict(text: string): {
  ok: boolean;
  reason: "ok" | "not_answer" | "not_grounded" | "unreadable";
} {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.search(/[{]/);
  if (start < 0) return { ok: false, reason: "unreadable" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(start));
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, reason: "unreadable" };
  const row = parsed as { answers?: unknown; grounded?: unknown };
  if (row.answers !== true) return { ok: false, reason: "not_answer" };
  if (row.grounded !== true) return { ok: false, reason: "not_grounded" };
  return { ok: true, reason: "ok" };
}

/** Split a model cluster when the questions are not about the same thing. */
export function coherentTopicGroups(pairs: ClassifiedPair[]): ClassifiedPair[][] {
  const remaining = pairs.slice();
  const groups: ClassifiedPair[][] = [];
  while (remaining.length) {
    const seed = remaining.shift()!;
    const group = [seed];
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = remaining.length - 1; i >= 0; i -= 1) {
        const candidate = remaining[i]!;
        if (group.some((row) => sameTopic(row.question, candidate.question))) {
          group.push(candidate);
          remaining.splice(i, 1);
          grew = true;
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

function representativeQuestion(questions: string[]): string {
  const counts = new Map<string, { n: number; raw: string }>();
  for (const question of questions) {
    const key = question.replace(/\s+/g, " ").trim();
    if (!key) continue;
    const row = counts.get(key) ?? { n: 0, raw: question.trim() };
    row.n += 1;
    counts.set(key, row);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.raw.length - b.raw.length)[0]?.raw ?? "";
}

export function selectWeeklySuggestions(
  pairs: ClassifiedPair[],
  knowledge: string,
  maxPerBusiness = KNOWLEDGE_UPDATE_MAX_PER_BUSINESS
): SelectedCluster[] {
  const groups = new Map<string, ClassifiedPair[]>();
  for (const pair of pairs) {
    if (!acceptClassifiedPair(pair)) continue;
    if (coveredByKnowledge(pair.answer, knowledge)) continue;
    const key = pair.cluster.replace(/\s+/g, " ").trim();
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(pair);
    groups.set(key, list);
  }
  const selected: SelectedCluster[] = [];
  for (const [clusterKey, group] of groups) {
    for (const topic of coherentTopicGroups(group)) {
      const leads = new Set(topic.map((pair) => pair.leadKey).filter(Boolean));
      if (leads.size < 2) continue;
      const question = representativeQuestion(topic.map((pair) => pair.question));
      selected.push({
        clusterKey: `${clusterKey}:${question}`.slice(0, 120),
        question,
        ownerAnswers: [...new Set(topic.map((pair) => pair.answer.trim()).filter(Boolean))],
        leadCount: leads.size,
      });
    }
  }
  selected.sort((a, b) => b.leadCount - a.leadCount || a.clusterKey.localeCompare(b.clusterKey, "he"));
  return selected.slice(0, maxPerBusiness);
}

export type KnowledgeReviewReason =
  | "passed"
  | "personal"
  | "one-off favor or private"
  | "single lead"
  | "already covered"
  | "not grounded"
  | "other";

export type KnowledgePairLabel = {
  reason: KnowledgeReviewReason;
  clusterKey: string;
};

/** Same decisions as selectWeeklySuggestions, one label per pair. */
export function labelKnowledgePairs(
  pairs: ClassifiedPair[],
  knowledge: string,
  maxPerBusiness = KNOWLEDGE_UPDATE_MAX_PER_BUSINESS
): KnowledgePairLabel[] {
  const labels: KnowledgePairLabel[] = pairs.map((pair) => {
    const cluster = pair.cluster.replace(/\s+/g, " ").trim();
    if (!pair.general && !(pair.oneOff && !cluster)) return { reason: "personal", clusterKey: "" };
    if (!pair.general || !cluster) return { reason: "other", clusterKey: "" };
    if (pair.oneOff) return { reason: "one-off favor or private", clusterKey: "" };
    if (coveredByKnowledge(pair.answer, knowledge)) return { reason: "already covered", clusterKey: "" };
    return { reason: "other", clusterKey: "" };
  });

  const groups = new Map<string, Array<{ pair: ClassifiedPair; index: number }>>();
  pairs.forEach((pair, index) => {
    if (!acceptClassifiedPair(pair)) return;
    const cluster = pair.cluster.replace(/\s+/g, " ").trim();
    if (!cluster || coveredByKnowledge(pair.answer, knowledge)) return;
    const list = groups.get(cluster) ?? [];
    list.push({ pair, index });
    groups.set(cluster, list);
  });

  const selected: Array<{ leadCount: number; clusterKey: string; indexes: number[] }> = [];
  for (const [cluster, group] of groups) {
    for (const topic of coherentTopicGroups(group.map((row) => row.pair))) {
      const leads = new Set(topic.map((pair) => pair.leadKey).filter(Boolean));
      const indexes = topic.map((pair) => group.find((row) => row.pair === pair)!.index);
      if (leads.size < 2) {
        for (const index of indexes) labels[index] = { reason: "single lead", clusterKey: "" };
        continue;
      }
      const question = representativeQuestion(topic.map((pair) => pair.question));
      selected.push({
        leadCount: leads.size,
        clusterKey: `${cluster}:${question}`.slice(0, 120),
        indexes,
      });
    }
  }
  selected.sort((a, b) => b.leadCount - a.leadCount || a.clusterKey.localeCompare(b.clusterKey, "he"));
  const kept = new Set(selected.slice(0, maxPerBusiness).flatMap((row) => row.indexes));
  for (const row of selected) {
    for (const index of row.indexes) {
      labels[index] = kept.has(index)
        ? { reason: "passed", clusterKey: row.clusterKey }
        : { reason: "other", clusterKey: "" };
    }
  }
  return labels;
}

export type KnowledgeUpdateSendDecision =
  | "not_due"
  | "already"
  | "empty"
  | "template"
  | "send_admin"
  | "send_owners";

export function sendDecision(input: {
  due: boolean;
  alreadySent: boolean;
  count: number;
  templateApproved: boolean;
  mode: KnowledgeUpdateRecipientMode;
}): KnowledgeUpdateSendDecision {
  if (!input.due) return "not_due";
  if (input.alreadySent) return "already";
  if (input.count <= 0) return "empty";
  if (!input.templateApproved) return "template";
  return input.mode === "owners" ? "send_owners" : "send_admin";
}

export function deliverTargets(input: {
  decision: KnowledgeUpdateSendDecision;
  adminPhone: string;
  ownerPhones: string[];
}): string[] {
  if (input.decision === "send_admin") {
    const phone = input.adminPhone.replace(/\D/g, "");
    return phone ? [phone] : [];
  }
  if (input.decision === "send_owners") {
    return [...new Set(input.ownerPhones.map((phone) => phone.replace(/\D/g, "")).filter((phone) => phone.length >= 11))];
  }
  return [];
}

const PII_EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PII_PHONE = /(?:\+?972[-\s]?|0)5\d[-\s]?\d{3}[-\s]?\d{4}/g;
const PII_LONG_NUMBER = /\b\d{7,}\b/g;

export function maskPii(text: string): string {
  return String(text ?? "")
    .replace(PII_EMAIL, "[email]")
    .replace(PII_PHONE, "[phone]")
    .replace(PII_LONG_NUMBER, "[number]");
}

export function normalizeKnowledgeText(text: string): string {
  return String(text ?? "")
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function appendKnowledgeQa(
  existing: KnowledgeQaPair[],
  pair: KnowledgeQaPair
): { pairs: KnowledgeQaPair[]; added: boolean } {
  const question = normalizeKnowledgeText(pair.question);
  const answer = normalizeKnowledgeText(pair.answer);
  if (!question || !answer) return { pairs: existing, added: false };
  const already = existing.some(
    (row) => normalizeKnowledgeText(row.question) === question && normalizeKnowledgeText(row.answer) === answer
  );
  if (already) return { pairs: existing, added: false };
  return { pairs: [...existing, { question, answer }], added: true };
}

export type InboundKnowledgeAction = "none" | "open" | "add" | "skip" | "fix" | "correct" | "ignore";

export function inboundAction(input: {
  text: string;
  interactiveId?: string | null;
  kind?: string | null;
  senderIsPilot: boolean;
  session: { active: boolean; awaitingCorrection: boolean; summarySent: boolean } | null;
}): { handled: boolean; action: InboundKnowledgeAction } {
  if (!input.senderIsPilot) return { handled: false, action: "none" };
  const text = input.text.trim();
  const id = String(input.interactiveId ?? "").trim();
  const kind = String(input.kind ?? "").trim();
  const fromButton = kind === "button_reply" || kind === "template_button" || id.startsWith("kw_");
  const which =
    id === "kw_add" || (fromButton && text === "להוסיף")
      ? "add"
      : id === "kw_skip" || (fromButton && text === "לדלג")
        ? "skip"
        : id === "kw_fix" || (fromButton && text === "לתקן")
          ? "fix"
          : kind === "template_button" && text === "מתחילים"
            ? "open"
            : null;

  if (which === "open") return { handled: true, action: "open" };
  if (which && input.session?.active && !input.session.summarySent) {
    return { handled: true, action: which };
  }
  if (which) return { handled: true, action: "ignore" };
  if (input.session?.active && input.session.awaitingCorrection && !input.session.summarySent && text && !fromButton) {
    return { handled: true, action: "correct" };
  }
  return { handled: false, action: "none" };
}

export function shouldWriteKnowledge(action: InboundKnowledgeAction, status: string): boolean {
  if (action !== "add" && action !== "correct") return false;
  return status === "sent" || status === "pending";
}

export function suggestionCardText(input: {
  businessName: string;
  question: string;
  knowledgeText: string;
}): string {
  return `${input.businessName}\nהשאלה: ${input.question}\nהידע שיתווסף: ${input.knowledgeText}`;
}

export function summaryText(counts: { added: number; skipped: number; corrected: number }): string {
  return `סיימנו.\nנוספו: ${counts.added}\nדולגו: ${counts.skipped}\nתוקנו: ${counts.corrected}`;
}

export const KNOWLEDGE_UPDATE_TEMPLATE_BODY =
  "*זמן עדכוני המידע לעסק שלך!*\nיש כמה שאלות ששאלו אותי לאחרונה, ואני רוצה לוודא מולך האם להכניס אותן לידע הקבוע שלי. זה ניסוי חדש, אז אולי בהתחלה אשאל דברים קצת מוזרים 😅 אבל בני האנוש שלי יעברו על התשובות וישכללו אותי מפעם לפעם! לוחצים על הכפתור ומתחילים!";

export function sessionActive(expiresAt: string | null | undefined, now: Date): boolean {
  const expires = Date.parse(String(expiresAt ?? ""));
  return Number.isFinite(expires) && expires > now.getTime();
}
