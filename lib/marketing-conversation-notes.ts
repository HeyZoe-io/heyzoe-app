export const MARKETING_NOTE_STATUSES = [
  "in_process",
  "not_relevant",
  "registered",
  "no_response",
] as const;

export type MarketingNoteStatus = (typeof MARKETING_NOTE_STATUSES)[number];

export const DEFAULT_MARKETING_NOTE_STATUS: MarketingNoteStatus = "in_process";

export function isMarketingNoteStatus(v: unknown): v is MarketingNoteStatus {
  return typeof v === "string" && (MARKETING_NOTE_STATUSES as readonly string[]).includes(v);
}

export function coerceMarketingNoteStatus(v: unknown): MarketingNoteStatus {
  return isMarketingNoteStatus(v) ? v : DEFAULT_MARKETING_NOTE_STATUS;
}

/** תווית + צבעי badge לרשימת שיחות / פאנל הערות */
export function getMarketingNoteStatusMeta(status: MarketingNoteStatus): {
  label: string;
  badgeClass: string;
} {
  switch (status) {
    case "not_relevant":
      return { label: "לא רלוונטי", badgeClass: "bg-gray-100 text-gray-600" };
    case "registered":
      return { label: "נרשם", badgeClass: "bg-emerald-50 text-emerald-700" };
    case "no_response":
      return { label: "ללא מענה", badgeClass: "bg-orange-50 text-orange-700" };
    case "in_process":
    default:
      return { label: "בתהליך", badgeClass: "bg-indigo-50 text-indigo-800" };
  }
}
