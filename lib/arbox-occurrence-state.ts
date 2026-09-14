/**
 * Per-occurrence fullness/cancellation state for a single Arbox class on a single date.
 * Suppresses only on positive evidence — every failure, timeout, or ambiguous match
 * resolves to "unknown", which callers must treat identically to "open" (offer as today).
 *
 * Two GETs in parallel, one calendar day wide: /v3/schedule (from_date/to_date, gives
 * max_participants) and classesSummaryReport (fromDate/toDate, gives registration_count
 * and status). Joined by the product's stored arbox_class_name — exact match after trim
 * only (verified 100% exact against live class_name/session_name, no fuzzy matching) —
 * plus start_time, since a class can recur more than once on the same date.
 */
import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import { normalizeHhmm } from "@/lib/arbox-schedule-sync";
import { unstable_cache } from "next/cache";

export type ArboxOccurrenceState = "open" | "full" | "cancelled" | "unknown";

export type ArboxOccurrenceStateResult = {
  state: ArboxOccurrenceState;
  freeSpots?: number;
  maxParticipants?: number;
  registrationCount?: number;
};

const OCCURRENCE_STATE_TIMEOUT_MS = 2000;
const OCCURRENCE_CACHE_REVALIDATE_SECONDS = 60;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function payloadRows(json: unknown): Record<string, unknown>[] {
  const rec = asRecord(json);
  const data = rec?.data;
  return Array.isArray(data) ? data.filter((r): r is Record<string, unknown> => Boolean(asRecord(r))) : [];
}

export type ArboxOccurrenceRaw = {
  scheduleRows: Record<string, unknown>[] | null;
  summaryRows: Record<string, unknown>[] | null;
};

/** Schedule uses from_date/to_date; the report uses fromDate/toDate — confirmed, not a typo. */
export async function fetchOccurrenceRawData(
  businessId: string,
  date: string,
  apiKey: string,
  boxId: string,
  fetchImpl: typeof arboxPublicFetch = arboxPublicFetch
): Promise<ArboxOccurrenceRaw> {
  const schedQs = new URLSearchParams({ from_date: date, to_date: date, location_id: boxId }).toString();
  const summaryQs = new URLSearchParams({ fromDate: date, toDate: date, location_id: boxId }).toString();

  console.info("[arbox-occurrence-state] real_fetch", { businessId, date });
  const [schedResult, summaryResult] = await Promise.allSettled([
    fetchImpl(`/v3/schedule?${schedQs}`, { apiKey, method: "GET" }),
    fetchImpl(`/v3/reports/classesSummaryReport?${summaryQs}`, { apiKey, method: "GET" }),
  ]);

  const scheduleRows =
    schedResult.status === "fulfilled" && schedResult.value.ok ? payloadRows(schedResult.value.json) : null;
  const summaryRows =
    summaryResult.status === "fulfilled" && summaryResult.value.ok ? payloadRows(summaryResult.value.json) : null;

  return { scheduleRows, summaryRows };
}

/**
 * Cache key is derived from these call arguments (Next's documented unstable_cache contract:
 * arguments + the static keyParts label form the key) — businessId and date are what vary per
 * lookup, so two different businesses or two different dates never share an entry. apiKey/boxId
 * are constant per business; if a key were ever rotated that would only split a cache entry
 * further, never merge two businesses' data. Verified empirically against a live dev server in
 * the prior investigation round (same-businessId call hit cache, different-businessId call did
 * not, and revalidate:60 was honored via stale-while-revalidate).
 */
const getCachedOccurrenceRawData = unstable_cache(
  (businessId: string, date: string, apiKey: string, boxId: string) =>
    fetchOccurrenceRawData(businessId, date, apiKey, boxId),
  ["arbox-occurrence-raw-v1"],
  { revalidate: OCCURRENCE_CACHE_REVALIDATE_SECONDS }
);

/**
 * unstable_cache depends on Next.js' request-scoped cache internals and is not usable from a
 * plain script/CLI context (e.g. a dry-run outside any Next.js server). Fall back to an uncached
 * fetch rather than let that break the caller — this is a runtime-availability fallback, not a
 * data-correctness one.
 */
async function getRawDataSafely(businessId: string, date: string, apiKey: string, boxId: string): Promise<ArboxOccurrenceRaw> {
  try {
    return await getCachedOccurrenceRawData(businessId, date, apiKey, boxId);
  } catch (e) {
    console.warn("[arbox-occurrence-state] unstable_cache unavailable, fetching uncached", {
      businessId,
      date,
      error: e instanceof Error ? e.message : String(e),
    });
    return fetchOccurrenceRawData(businessId, date, apiKey, boxId);
  }
}

/**
 * unstable_cache only de-duplicates once the first call has resolved and written the cache —
 * concurrent callers (e.g. Promise.all over many slots on the same businessId+date, fired
 * within milliseconds of each other) each miss the still-empty cache and trigger their own
 * real fetch (verified live: 11 concurrent callers -> 11 real Arbox fetches, not 1). This
 * in-process in-flight map is what actually guarantees "one fetch pair per businessId+date" —
 * concurrent callers share the same pending promise; unstable_cache still gives cross-request
 * reuse within the 60s window once that promise has settled.
 */
const inFlightRawFetches = new Map<string, Promise<ArboxOccurrenceRaw>>();

async function getRawDataDeduped(businessId: string, date: string, apiKey: string, boxId: string): Promise<ArboxOccurrenceRaw> {
  const key = `${businessId}|${date}`;
  const existing = inFlightRawFetches.get(key);
  if (existing) return existing;
  const promise = getRawDataSafely(businessId, date, apiKey, boxId).finally(() => {
    inFlightRawFetches.delete(key);
  });
  inFlightRawFetches.set(key, promise);
  return promise;
}

function matchesOccurrence(
  row: Record<string, unknown>,
  date: string,
  time: string,
  className: string,
  nameField: "session_name" | "class_name"
): boolean {
  const rowDate = String(row.date ?? "").trim().slice(0, 10);
  const rowTime = normalizeHhmm(row.start_time);
  const rowName = String(row[nameField] ?? "").trim();
  return rowDate === date && rowTime === time && rowName === className;
}

/** Pure join/state logic — no network, fully unit-testable with hand-built row shapes. */
export function resolveOccurrenceState(
  raw: ArboxOccurrenceRaw,
  date: string,
  time: string,
  className: string
): ArboxOccurrenceStateResult {
  const wantName = String(className ?? "").trim();
  const wantTime = normalizeHhmm(time);
  const wantDate = String(date ?? "").trim();
  if (!wantName || !wantTime || !wantDate) return { state: "unknown" };

  // Cancelled is checked first and takes precedence — and only needs the summary endpoint,
  // so it still resolves correctly even if the schedule call failed or timed out.
  const summaryCandidates = (raw.summaryRows ?? []).filter((r) =>
    matchesOccurrence(r, wantDate, wantTime, wantName, "class_name")
  );
  if (summaryCandidates.length > 1) return { state: "unknown" };
  const summaryRow = summaryCandidates[0];

  if (summaryRow) {
    const status = String(summaryRow.status ?? "").trim();
    if (status !== "active") return { state: "cancelled" };
  }

  const scheduleCandidates = (raw.scheduleRows ?? []).filter((r) =>
    matchesOccurrence(r, wantDate, wantTime, wantName, "session_name")
  );
  if (scheduleCandidates.length > 1) return { state: "unknown" };
  const scheduleRow = scheduleCandidates[0];
  if (!scheduleRow) return { state: "unknown" };

  const max = Number(scheduleRow.max_participants);
  if (!Number.isFinite(max) || max <= 0) return { state: "unknown" };
  if (!summaryRow) return { state: "unknown", maxParticipants: max };

  const reg = Number(summaryRow.registration_count);
  if (!Number.isFinite(reg)) return { state: "unknown", maxParticipants: max };

  if (reg >= max) {
    return { state: "full", maxParticipants: max, registrationCount: reg, freeSpots: 0 };
  }
  return { state: "open", maxParticipants: max, registrationCount: reg, freeSpots: Math.max(0, max - reg) };
}

/**
 * The cached, deduped, timeout-bounded raw fetch — the only Arbox-touching entry point.
 * Callers with MULTIPLE candidates on the same businessId+date (the list path) should call
 * this ONCE per distinct date and run the pure resolveOccurrenceState locally per candidate,
 * rather than calling getOccurrenceState per candidate — that would each independently pay
 * this same dedup cost correctly, but going through the raw fetch directly once is simpler
 * and makes the "one fetch pair per date" guarantee obvious at the call site.
 */
export async function getOccurrenceRawData(input: {
  businessId: number | string;
  apiKey: string;
  boxId: string;
  date: string;
  fetchImpl?: typeof arboxPublicFetch;
  timeoutMs?: number;
  skipCache?: boolean;
}): Promise<ArboxOccurrenceRaw> {
  const businessId = String(input.businessId ?? "").trim();
  const apiKey = String(input.apiKey ?? "").trim();
  const boxId = String(input.boxId ?? "").trim();
  const date = String(input.date ?? "").trim();
  const empty: ArboxOccurrenceRaw = { scheduleRows: null, summaryRows: null };
  if (!businessId || !apiKey || !boxId || !date) return empty;

  const fetchImpl = input.fetchImpl ?? arboxPublicFetch;
  const timeoutMs = input.timeoutMs ?? OCCURRENCE_STATE_TIMEOUT_MS;

  const work = (async (): Promise<ArboxOccurrenceRaw> => {
    try {
      return input.skipCache || input.fetchImpl
        ? await fetchOccurrenceRawData(businessId, date, apiKey, boxId, fetchImpl)
        : await getRawDataDeduped(businessId, date, apiKey, boxId);
    } catch (e) {
      console.error("[arbox-occurrence-state] raw fetch failed", {
        businessId,
        date,
        error: e instanceof Error ? e.message : String(e),
      });
      return empty;
    }
  })();

  const timeout = new Promise<ArboxOccurrenceRaw>((resolve) => {
    setTimeout(() => resolve(empty), timeoutMs);
  });

  return Promise.race([work, timeout]);
}

export async function getOccurrenceState(input: {
  businessId: number | string;
  apiKey: string;
  boxId: string;
  /** YYYY-MM-DD Israel date, e.g. from resolveNextOccurrence(...).ymd */
  date: string;
  /** HH:MM */
  time: string;
  /** The product's stored arbox_class_name. */
  className: string;
  /** Test-only overrides — production callers must not set these. */
  fetchImpl?: typeof arboxPublicFetch;
  timeoutMs?: number;
  skipCache?: boolean;
}): Promise<ArboxOccurrenceStateResult> {
  const businessId = String(input.businessId ?? "").trim();
  const date = String(input.date ?? "").trim();
  if (!businessId || !input.apiKey?.trim() || !input.boxId?.trim() || !date) return { state: "unknown" };

  const raw = await getOccurrenceRawData({
    businessId,
    apiKey: input.apiKey,
    boxId: input.boxId,
    date,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    skipCache: input.skipCache,
  });
  const result = resolveOccurrenceState(raw, date, input.time, input.className);
  console.info("[arbox-occurrence-state]", {
    businessId,
    date,
    className: input.className,
    state: result.state,
    maxParticipants: result.maxParticipants,
    registrationCount: result.registrationCount,
  });
  return result;
}
