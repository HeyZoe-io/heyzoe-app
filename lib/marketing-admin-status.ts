import { computeContactStatus, type ContactStatusKey } from "@/lib/contact-status";
import type { LeadRow } from "@/lib/leads-types";

/** סטטוס-על. עומד בפני עצמו כשלא רלוונטי, ומצטרף לכל סטטוס משני כשרלוונטי. */
export const MARKETING_RELEVANCE = ["relevant", "not_relevant"] as const;
export type MarketingRelevance = (typeof MARKETING_RELEVANCE)[number];

/**
 * סטטוס משני. חי רק יחד עם «רלוונטי».
 * `in_process` הוא «ליד חדש» (קודם הוצג כ«בתהליך»).
 */
export const MARKETING_STAGE_STATUSES = [
  "in_process",
  "requires_call",
  "followup",
  "no_response",
  "not_interested",
  "registered",
] as const;
export type MarketingStage = (typeof MARKETING_STAGE_STATUSES)[number];

/** עמודות דף הלידים של זואי אדמין. «הסר» נשאר לבד — זו בקשת וואטסאפ, לא סטטוס CRM. */
export const MARKETING_ADMIN_COLUMNS = [
  "in_process",
  "requires_call",
  "followup",
  "no_response",
  "not_interested",
  "registered",
  "not_relevant",
  "opted_out",
] as const;
export type MarketingAdminColumn = (typeof MARKETING_ADMIN_COLUMNS)[number];

const STAGE_SET = new Set<string>(MARKETING_STAGE_STATUSES);
const COLUMN_SET = new Set<string>(MARKETING_ADMIN_COLUMNS);

const STAGE_RANK: Record<MarketingStage, number> = {
  in_process: 0,
  requires_call: 1,
  followup: 2,
  no_response: 3,
  not_interested: 4,
  registered: 5,
};

export function isMarketingRelevance(v: unknown): v is MarketingRelevance {
  return v === "relevant" || v === "not_relevant";
}

export function isMarketingStage(v: unknown): v is MarketingStage {
  return typeof v === "string" && STAGE_SET.has(v);
}

export function isMarketingAdminColumn(v: unknown): v is MarketingAdminColumn {
  return typeof v === "string" && COLUMN_SET.has(v);
}

export function marketingStageLabel(stage: MarketingStage): string {
  switch (stage) {
    case "requires_call":
      return "דורש שיחה";
    case "followup":
      return "פולואפ";
    case "no_response":
      return "ללא מענה";
    case "not_interested":
      return "לא מעוניין";
    case "registered":
      return "נרשם";
    case "in_process":
    default:
      return "ליד חדש";
  }
}

export function marketingAdminColumnLabel(column: MarketingAdminColumn): string {
  if (column === "not_relevant") return "לא רלוונטי";
  if (column === "opted_out") return "הסר";
  return marketingStageLabel(column);
}

export function marketingAdminColumnHeaderClass(column: MarketingAdminColumn): string {
  switch (column) {
    case "requires_call":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "followup":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "no_response":
      return "border-red-200 bg-red-50 text-red-800";
    case "not_interested":
      return "border-rose-200 bg-rose-50 text-rose-800";
    case "registered":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "not_relevant":
      return "border-slate-300 bg-slate-100 text-slate-800";
    case "opted_out":
      return "border-zinc-300 bg-zinc-100 text-zinc-700";
    case "in_process":
    default:
      return "border-indigo-200 bg-indigo-50 text-indigo-800";
  }
}

/** תווית מלאה: «רלוונטי + ללא מענה», או «לא רלוונטי» / «הסר» לבד. */
export function formatMarketingAdminStatusLabel(input: {
  relevance?: MarketingRelevance | null;
  stage?: MarketingStage | null;
  column?: MarketingAdminColumn | null;
}): string {
  const column = input.column;
  if (column === "not_relevant" || input.relevance === "not_relevant") return "לא רלוונטי";
  if (column === "opted_out") return "הסר";
  const stage = input.stage ?? (isMarketingStage(column) ? column : "in_process");
  return `רלוונטי + ${marketingStageLabel(stage)}`;
}

export function marketingAdminStatusRank(input: {
  relevance?: MarketingRelevance | null;
  stage?: MarketingStage | null;
}): number {
  if (input.relevance === "not_relevant") return 6;
  return STAGE_RANK[input.stage ?? "in_process"];
}

/**
 * שורה שמורה בהערות. `status = not_relevant` הישן נקרא כרלוונטיות, בלי למחוק סטטוס משני אם יש.
 */
export function splitStoredMarketingStatus(input: {
  status?: string | null;
  relevance?: string | null;
  hasNote: boolean;
}): { relevance: MarketingRelevance; stage: MarketingStage } | null {
  if (!input.hasNote) return null;
  const rawStatus = String(input.status ?? "").trim();
  const relevance: MarketingRelevance =
    input.relevance === "not_relevant" || rawStatus === "not_relevant" ? "not_relevant" : "relevant";
  const stage: MarketingStage = isMarketingStage(rawStatus) ? rawStatus : "in_process";
  return { relevance, stage };
}

export function marketingAdminColumnStopsFollowups(column: MarketingAdminColumn): boolean {
  return (
    column === "not_relevant" ||
    column === "not_interested" ||
    column === "registered" ||
    column === "no_response" ||
    column === "requires_call" ||
    column === "opted_out"
  );
}

/** עמודת פייפליין ישנה → העמודה החדשה. */
export function mapLegacyPipelineToAdminColumn(status: string | null | undefined): MarketingAdminColumn | null {
  switch (String(status ?? "").trim()) {
    case "in_process":
    case "template":
    case "active":
    case "none":
      return "in_process";
    case "requires_call":
    case "human_followup":
    case "human_requested":
    case "registered_human_requested":
      return status === "registered_human_requested" ? "registered" : "requires_call";
    case "followup":
      return "followup";
    case "no_response":
      return "no_response";
    case "not_interested":
      return "not_interested";
    case "registered":
      return "registered";
    case "not_relevant":
      return "not_relevant";
    case "opted_out":
      return "opted_out";
    default:
      return null;
  }
}

function mapComputedToAdminColumn(status: ContactStatusKey | null): MarketingAdminColumn {
  switch (status) {
    case "opted_out":
      return "opted_out";
    case "not_relevant":
      return "not_relevant";
    case "not_interested":
      return "not_interested";
    case "registered":
    case "registered_human_requested":
      return "registered";
    case "human_followup":
    case "human_requested":
      return "requires_call";
    case "followup":
      return "followup";
    case "no_response":
      return "no_response";
    case "template":
    case "active":
    default:
      return "in_process";
  }
}

/**
 * אותה עמודה בדף לידים וברשימת השיחות.
 * הערת CRM גוברת על חישוב אוטומטי. לא רלוונטי עומד לבד. הסר גובר על הכל.
 */
export function resolveMarketingAdminColumn(row: LeadRow): MarketingAdminColumn {
  if (row.opted_out === true || row.pipeline_status === "opted_out") return "opted_out";
  if (row.marketing_relevance === "not_relevant") return "not_relevant";
  if (row.marketing_relevance === "relevant" && isMarketingStage(row.marketing_stage)) {
    return row.marketing_stage;
  }
  const fromPipeline = mapLegacyPipelineToAdminColumn(row.pipeline_status);
  if (row.pipeline_status && fromPipeline) return fromPipeline;
  return mapComputedToAdminColumn(computeContactStatus(row));
}

export function crmWriteForAdminColumn(column: MarketingAdminColumn): {
  relevance: MarketingRelevance;
  stage: MarketingStage | null;
} {
  if (column === "not_relevant") return { relevance: "not_relevant", stage: null };
  if (column === "opted_out") return { relevance: "relevant", stage: null };
  return { relevance: "relevant", stage: column };
}
