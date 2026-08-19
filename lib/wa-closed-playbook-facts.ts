import type {
  ClosedPlaybookCatalogService,
  ClosedPlaybookCategory,
  ClosedPlaybookKnowledge,
} from "@/lib/wa-closed-playbook-types";

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
  group: [/סדנ[הא]/u, /\bworkshop\b/i, /גיבוש/u, /אירוע\s+ל?חברה/u, /אירוע/u, /corporate\s+event/i],
};

const PROMO_TOPICS: { id: string; inbound: RegExp; promo: RegExp }[] = [
  { id: "trial", inbound: /ניסיון|נסיון|היכרות|הכרות|\btrial\b|\bintro\b/iu, promo: /ניסיון|נסיון|היכרות|הכרות|\btrial\b|\bintro\b/iu },
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
  if (category === "group") {
    for (const row of knowledge.salesFlowServices ?? []) {
      const desc = String(row.descriptionText ?? "").trim();
      const benefit = String(row.benefit ?? "").trim();
      for (const blob of [desc, benefit]) {
        if (blob && termsHit(blob, terms)) return leadFacingFactText(blob);
      }
    }
  }
  return null;
}

const GROUP_ORG_EVENT_INBOUND =
  /אירוע|חברה|גיבוש|משרד|צוות|corporate|team|workshop|סדנ/iu;
const GROUP_ORG_EVENT_CATALOG =
  /אירוע|גיבוש|corporate|מיוחד|חברה|צוות|משרד|private\s+event/iu;

function groupCatalogBlob(row: ClosedPlaybookCatalogService): string {
  return [row.name, row.descriptionText, row.benefit]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

function groupCatalogScore(row: ClosedPlaybookCatalogService, inbound: string): number {
  const blob = groupCatalogBlob(row);
  if (!blob) return 0;
  const inboundWantsOrgEvent = GROUP_ORG_EVENT_INBOUND.test(inbound);
  if (inboundWantsOrgEvent && /סדנ[הא]/u.test(blob) && !GROUP_ORG_EVENT_CATALOG.test(blob)) {
    return 0;
  }
  if (inboundWantsOrgEvent && !GROUP_ORG_EVENT_CATALOG.test(blob) && String(row.offerKind ?? "") !== "workshop") {
    return 0;
  }
  let score = 0;
  if (/אירוע/u.test(blob)) score += 4;
  if (/סדנ[הא]/u.test(blob)) score += 3;
  if (/גיבוש|corporate|\bworkshop\b/iu.test(blob)) score += 3;
  if (/מיוחד/u.test(blob)) score += 2;
  if (String(row.offerKind ?? "") === "workshop") score += 2;
  if (/(?:חברה|גיבוש|משרד|צוות)/u.test(inbound) && /(?:אירוע|סדנ|גיבוש|חברה|workshop)/iu.test(blob)) {
    score += 2;
  }
  return score;
}

/**
 * Unique catalog product for a group/org-event inbound.
 * Name + description + benefit + existing offerKind only — no catalog schema change.
 */
export function findMatchingGroupCatalogProduct(
  inbound: string,
  services: ClosedPlaybookCatalogService[] | null | undefined
): string | null {
  const list = (services ?? []).filter((row) => String(row.name ?? "").trim());
  if (!list.length) return null;
  const scored = list
    .map((row) => ({ name: String(row.name).trim(), score: groupCatalogScore(row, inbound) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  const top = scored[0]!.score;
  const winners = scored.filter((row) => row.score === top);
  if (winners.length !== 1) return null;
  return winners[0]!.name;
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
