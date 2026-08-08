export const MARKETING_NOTE_STATUSES = [
  "in_process",
  "not_relevant",
  "registered",
  "no_response",
  "not_interested",
  "requires_call",
] as const;

export type MarketingNoteStatus = (typeof MARKETING_NOTE_STATUSES)[number];

export const DEFAULT_MARKETING_NOTE_STATUS: MarketingNoteStatus = "in_process";

/** סטטוס שמצמיד את השיחה לראש הרשימה */
export const PINNED_MARKETING_NOTE_STATUS: MarketingNoteStatus = "requires_call";

export function isMarketingNoteStatus(v: unknown): v is MarketingNoteStatus {
  return typeof v === "string" && (MARKETING_NOTE_STATUSES as readonly string[]).includes(v);
}

export function coerceMarketingNoteStatus(v: unknown): MarketingNoteStatus {
  return isMarketingNoteStatus(v) ? v : DEFAULT_MARKETING_NOTE_STATUS;
}

export function isPinnedMarketingNoteStatus(status: MarketingNoteStatus | null | undefined): boolean {
  return status === PINNED_MARKETING_NOTE_STATUS;
}

function sessionActivityMs(lastAt?: string | null): number {
  const at = String(lastAt ?? "").trim();
  if (!at) return 0;
  const t = new Date(at).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** «דורש שיחה» קודם, אחר כך לפי פעילות אחרונה */
export function sortSessionsWithPinnedRequiresCall<
  T extends { lastAt?: string | null; noteStatus?: MarketingNoteStatus | null },
>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => {
    const aPin = isPinnedMarketingNoteStatus(a.noteStatus) ? 1 : 0;
    const bPin = isPinnedMarketingNoteStatus(b.noteStatus) ? 1 : 0;
    if (aPin !== bPin) return bPin - aPin;
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
