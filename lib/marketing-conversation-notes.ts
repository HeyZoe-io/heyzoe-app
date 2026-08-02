export const MARKETING_NOTE_STATUSES = [
  "in_process",
  "not_relevant",
  "registered",
  "no_response",
  "not_interested",
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
  activeBg: string;
  activeFg: string;
} {
  switch (status) {
    case "not_relevant":
      return {
        label: "לא רלוונטי",
        badgeClass: "bg-gray-100 text-gray-600",
        activeBg: "#f3f4f6",
        activeFg: "#4b5563",
      };
    case "registered":
      return {
        label: "נרשם",
        badgeClass: "bg-emerald-50 text-emerald-700",
        activeBg: "#ecfdf5",
        activeFg: "#047857",
      };
    case "no_response":
      return {
        label: "ללא מענה",
        badgeClass: "bg-orange-50 text-orange-700",
        activeBg: "#fff7ed",
        activeFg: "#c2410c",
      };
    case "not_interested":
      return {
        label: "לא מעוניין",
        badgeClass: "bg-rose-50 text-rose-700",
        activeBg: "#fff1f2",
        activeFg: "#be123c",
      };
    case "in_process":
    default:
      return {
        label: "בתהליך",
        badgeClass: "bg-indigo-50 text-indigo-800",
        activeBg: "#eef2ff",
        activeFg: "#3730a3",
      };
  }
}

export const MARKETING_NOTE_STATUS_OPTIONS = MARKETING_NOTE_STATUSES.map((value) => {
  const meta = getMarketingNoteStatusMeta(value);
  return {
    value,
    label: meta.label,
    activeBg: meta.activeBg,
    activeFg: meta.activeFg,
  };
});
