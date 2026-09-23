/**
 * סטטוס משני שנשמר ב-status.
 * `not_relevant` נשאר לקריאה של שורות ישנות; סטטוס-העל החדש הוא העמודה relevance.
 * סדר: 0 = הכי למעלה ברשימת השיחות.
 */
export const MARKETING_NOTE_STATUSES = [
  "in_process",
  "requires_call",
  "followup",
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
  followup: 2,
  no_response: 3,
  not_interested: 4,
  registered: 5,
  not_relevant: 6,
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
 * לידים לפי חשיבות: ליד חדש → דורש שיחה → פולואפ → ללא מענה → לא מעוניין → נרשם,
 * ולא רלוונטי בסוף. באותו סטטוס — לפי פעילות אחרונה.
 */
export function sortMarketingSessionsByStatusPriority<
  T extends {
    lastAt?: string | null;
    noteStatus?: MarketingNoteStatus | null;
    noteRelevance?: "relevant" | "not_relevant" | null;
  },
>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => {
    const rankDiff = sessionStatusRank(a) - sessionStatusRank(b);
    if (rankDiff !== 0) return rankDiff;
    return sessionActivityMs(b.lastAt) - sessionActivityMs(a.lastAt);
  });
}

function sessionStatusRank(row: {
  noteStatus?: MarketingNoteStatus | null;
  noteRelevance?: "relevant" | "not_relevant" | null;
}): number {
  if (row.noteRelevance === "not_relevant" || row.noteStatus === "not_relevant") return 6;
  return marketingNoteStatusRank(row.noteStatus);
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
        badgeClass: "bg-zinc-100 text-zinc-600",
        activeBg: "#f4f4f5",
        activeFg: "#52525b",
      };
    case "registered":
      return {
        label: "נרשם",
        badgeClass: "bg-purple-50 text-purple-800",
        activeBg: "#faf5ff",
        activeFg: "#6b21a8",
      };
    case "no_response":
      return {
        label: "ללא מענה",
        badgeClass: "bg-red-50 text-red-700",
        activeBg: "#fef2f2",
        activeFg: "#b91c1c",
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
        badgeClass: "bg-orange-50 text-orange-800",
        activeBg: "#fff7ed",
        activeFg: "#c2410c",
      };
    case "followup":
      return {
        label: "פולואפ",
        badgeClass: "bg-green-50 text-green-800",
        activeBg: "#f0fdf4",
        activeFg: "#166534",
      };
    case "in_process":
    default:
      return {
        label: "ליד חדש",
        badgeClass: "bg-blue-50 text-blue-800",
        activeBg: "#eff6ff",
        activeFg: "#1d4ed8",
      };
  }
}

/** כפתורי הסטטוס המשני. «לא רלוונטי» הוא סטטוס-על, לא אופציה כאן. */
export const MARKETING_NOTE_STATUS_OPTIONS = (
  ["in_process", "requires_call", "followup", "no_response", "not_interested", "registered"] as const
).map((value) => {
  const meta = getMarketingNoteStatusMeta(value);
  return {
    value,
    label: meta.label,
    activeBg: meta.activeBg,
    activeFg: meta.activeFg,
  };
});
