import type { ClosedPlaybookCategory, ClosedPlaybookKnowledge } from "@/lib/wa-closed-playbook-types";

const TOPIC_TERMS: Record<
  Exclude<ClosedPlaybookCategory, "discount" | "coach_owner">,
  RegExp[]
> = {
  reschedule: [
    /דח[יהו]/u,
    /החלפ/u,
    /שינוי\s+מועד/u,
    /לשנות\s+מועד/u,
    /להעביר\s+שיעור/u,
    /reschedule/i,
    /postpone/i,
    /\bswap\b/i,
  ],
  cancellation: [/ביטול/u, /לבטל/u, /\bcancel(?:lation)?\b/i],
  freeze: [/הקפא/u, /קפיא/u, /\bfreeze\b/i],
  refund: [/החזר/u, /\brefund\b/i, /כסף\s+בחזרה/u],
  medical: [/פציע/u, /\binjur/i, /שיקום/u, /\brehab\b/i],
  complaint: [/תלונ/u, /\bcomplaint\b/i],
  group: [/סדנ[הא]/u, /\bworkshop\b/i, /גיבוש/u, /אירוע\s+חברה/u, /corporate\s+event/i],
};

const PROMO_TOPICS: { id: string; inbound: RegExp; promo: RegExp }[] = [
  { id: "trial", inbound: /ניסיון|היכרות|\btrial\b|\bintro\b/iu, promo: /ניסיון|היכרות|\btrial\b|\bintro\b/iu },
  { id: "membership", inbound: /מנוי|\bmembership\b|חודש/iu, promo: /מנוי|\bmembership\b|חודש/iu },
  { id: "punch", inbound: /כרטיסי[יה]|\bpunch\s*card\b/iu, promo: /כרטיסי[יה]|\bpunch\s*card\b/iu },
  { id: "private", inbound: /שיעור\s+פרטי|אימון\s+פרטי|\bprivate\b/iu, promo: /פרטי|\bprivate\b/iu },
  { id: "workshop", inbound: /סדנ[הא]|\bworkshop\b/iu, promo: /סדנ[הא]|\bworkshop\b/iu },
];

function termsHit(text: string, terms: RegExp[]): boolean {
  return terms.some((re) => re.test(text));
}

/** Quoted spans are the lead-facing copy (same contract as FACT_QUOTE_RULES). */
export function leadFacingFactText(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  const parts: string[] = [];
  const re = /["\u201c\u201d\u201e«»״]([^"\u201c\u201d\u201e«»״]+)["\u201c\u201d\u201e«»״]/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const inner = String(m[1] ?? "").trim();
    if (inner) parts.push(inner);
  }
  if (parts.length) return parts.join("\n");
  return t;
}

function qaCoversTopic(
  pair: { question?: string | null; answer?: string | null },
  terms: RegExp[]
): string | null {
  const question = String(pair.question ?? "").trim();
  const answer = String(pair.answer ?? "").trim();
  if (!answer) return null;
  const blob = `${question}\n${answer}`;
  if (!termsHit(blob, terms)) return null;
  return leadFacingFactText(answer);
}

function firstMatchingLine(blob: string, terms: RegExp[]): string | null {
  const text = String(blob ?? "").trim();
  if (!text) return null;
  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (termsHit(trimmed, terms)) return leadFacingFactText(trimmed);
  }
  return null;
}

/**
 * Heuristic per-topic lookup over existing free-text knowledgeQa / traits / FAQ.
 * Not a typed slot. Cancel vs freeze vs refund use separate term sets.
 */
export function lookupPlaybookFact(
  category: ClosedPlaybookCategory,
  knowledge: ClosedPlaybookKnowledge | null | undefined
): string | null {
  if (!knowledge || category === "discount" || category === "coach_owner") return null;
  const terms = TOPIC_TERMS[category];
  if (!terms?.length) return null;

  for (const pair of knowledge.knowledgeQa ?? []) {
    const hit = qaCoversTopic(pair, terms);
    if (hit) return hit;
  }
  for (const line of knowledge.traits ?? []) {
    const trimmed = String(line ?? "").trim();
    if (!trimmed) continue;
    if (termsHit(trimmed, terms)) return leadFacingFactText(trimmed);
  }
  const fromFaq = firstMatchingLine(knowledge.faqsText ?? "", terms);
  if (fromFaq) return fromFaq;
  const fromMemberships = firstMatchingLine(knowledge.membershipsAndCardsText ?? "", terms);
  if (fromMemberships) return fromMemberships;
  return null;
}

function inboundPromoTopics(inbound: string): string[] {
  return PROMO_TOPICS.filter((x) => x.inbound.test(inbound)).map((x) => x.id);
}

/**
 * Only return a promo that matches the topic the lead is negotiating about.
 * Generic "give me a discount" with no product → not relevant (do not dump any promo).
 * Non-empty promotionsText is treated as currently listed (no date field exists).
 */
export function findRelevantActivePromo(
  inbound: string,
  promotionsText: string | null | undefined
): string | null {
  const promo = String(promotionsText ?? "").trim();
  if (!promo) return null;
  const topics = inboundPromoTopics(inbound);
  if (topics.length === 0) return null;
  const matching = topics.filter((id) => {
    const row = PROMO_TOPICS.find((x) => x.id === id);
    return row ? row.promo.test(promo) : false;
  });
  if (matching.length === 0) return null;
  return leadFacingFactText(promo);
}
