/** סדר חשיבות באדמין זואי — 0 = הכי למעלה ברשימה */
export const MARKETING_NOTE_STATUSES = [
  "in_process",
  "requires_call",
  "no_response",
  "not_interested",
  "registered",
  "not_relevant",
] as const;

export type MarketingNoteStatus = (typeof MARKETING_NOTE_STATUSES)[number];

export const DEFAULT_MARKETING_NOTE_STATUS: MarketingNoteStatus = "in_process";

const MARKETING_NOTE_STATUS_RANK: Record<MarketingNoteStatus, number> = {
  in_process: 0,
  requires_call: 1,
  no_response: 2,
  not_interested: 3,
  registered: 4,
  not_relevant: 5,
};

export function isMarketingNoteStatus(v: unknown): v is MarketingNoteStatus {
  return typeof v === "string" && (MARKETING_NOTE_STATUSES as readonly string[]).includes(v);
}

export function coerceMarketingNoteStatus(v: unknown): MarketingNoteStatus {
  return isMarketingNoteStatus(v) ? v : DEFAULT_MARKETING_NOTE_STATUS;
}

export function marketingNoteStatusRank(status: MarketingNoteStatus | null | undefined): number {
  return MARKETING_NOTE_STATUS_RANK[coerceMarketingNoteStatus(status)];
}

function sessionActivityMs(lastAt?: string | null): number {
  const at = String(lastAt ?? "").trim();
  if (!at) return 0;
  const t = new Date(at).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * לידים לפי חשיבות סטטוס (בתהליך → דורש שיחה → ללא מענה → לא מעוניין → נרשם → לא רלוונטי),
 * ובאותו סטטוס לפי פעילות אחרונה.
 */
export function sortMarketingSessionsByStatusPriority<
  T extends { lastAt?: string | null; noteStatus?: MarketingNoteStatus | null },
>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => {
    const rankDiff = marketingNoteStatusRank(a.noteStatus) - marketingNoteStatusRank(b.noteStatus);
    if (rankDiff !== 0) return rankDiff;
    return sessionActivityMs(b.lastAt) - sessionActivityMs(a.lastAt);
  });
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
    case "requires_call":
      return {
        label: "דורש שיחה",
        badgeClass: "bg-amber-50 text-amber-900",
        activeBg: "#fffbeb",
        activeFg: "#92400e",
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
