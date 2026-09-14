import assert from "node:assert/strict";
import type { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import { getOccurrenceState, resolveOccurrenceState, type ArboxOccurrenceRaw } from "@/lib/arbox-occurrence-state";

const DATE = "2026-09-14";
const TIME = "18:30";
const NAME = "Strength";

function scheduleRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    schedule_id: 1,
    date: DATE,
    start_time: TIME,
    session_name: NAME,
    max_participants: 8,
    is_transparent: 0,
    ...over,
  };
}
function summaryRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    schedule_id: 1,
    date: DATE,
    start_time: TIME,
    class_name: NAME,
    status: "active",
    registration_count: 3,
    ...over,
  };
}

// ---------- resolveOccurrenceState: pure branch coverage ----------

// open — registration below capacity
{
  const raw: ArboxOccurrenceRaw = { scheduleRows: [scheduleRow()], summaryRows: [summaryRow({ registration_count: 3 })] };
  const r = resolveOccurrenceState(raw, DATE, TIME, NAME);
  assert.deepEqual(r, { state: "open", maxParticipants: 8, registrationCount: 3, freeSpots: 5 });
}

// full — registration_count === max_participants
{
  const raw: ArboxOccurrenceRaw = { scheduleRows: [scheduleRow({ max_participants: 8 })], summaryRows: [summaryRow({ registration_count: 8 })] };
  const r = resolveOccurrenceState(raw, DATE, TIME, NAME);
  assert.deepEqual(r, { state: "full", maxParticipants: 8, registrationCount: 8, freeSpots: 0 });
}

// full — registration_count exceeds max_participants (edge case, still "full" per >=)
{
  const raw: ArboxOccurrenceRaw = { scheduleRows: [scheduleRow({ max_participants: 8 })], summaryRows: [summaryRow({ registration_count: 9 })] };
  assert.equal(resolveOccurrenceState(raw, DATE, TIME, NAME).state, "full");
}

// cancelled — status "cancelled" takes precedence over an otherwise-open schedule row
{
  const raw: ArboxOccurrenceRaw = { scheduleRows: [scheduleRow()], summaryRows: [summaryRow({ status: "cancelled" })] };
  assert.deepEqual(resolveOccurrenceState(raw, DATE, TIME, NAME), { state: "cancelled" });
}

// deleted — any non-"active" status maps to "cancelled" (whitelist, not blacklist)
{
  const raw: ArboxOccurrenceRaw = { scheduleRows: [scheduleRow()], summaryRows: [summaryRow({ status: "deleted" })] };
  assert.deepEqual(resolveOccurrenceState(raw, DATE, TIME, NAME), { state: "cancelled" });
}

// cancelled without a matching schedule row at all (the real-world pattern: cancelled
// occurrences are omitted from /v3/schedule entirely) — still resolves via summary alone.
{
  const raw: ArboxOccurrenceRaw = { scheduleRows: [], summaryRows: [summaryRow({ status: "cancelled" })] };
  assert.deepEqual(resolveOccurrenceState(raw, DATE, TIME, NAME), { state: "cancelled" });
}

// empty schedule response (fetch failed -> null) -> unknown, never suppress
{
  const raw: ArboxOccurrenceRaw = { scheduleRows: null, summaryRows: [summaryRow()] };
  assert.equal(resolveOccurrenceState(raw, DATE, TIME, NAME).state, "unknown");
}

// empty summary response (fetch failed -> null), schedule present -> unknown (no registration data)
{
  const raw: ArboxOccurrenceRaw = { scheduleRows: [scheduleRow()], summaryRows: null };
  assert.deepEqual(resolveOccurrenceState(raw, DATE, TIME, NAME), { state: "unknown", maxParticipants: 8 });
}

// both empty (successful but zero rows) -> unknown
{
  const raw: ArboxOccurrenceRaw = { scheduleRows: [], summaryRows: [] };
  assert.equal(resolveOccurrenceState(raw, DATE, TIME, NAME).state, "unknown");
}

// no match — right date/time, different class name -> unknown
{
  const raw: ArboxOccurrenceRaw = { scheduleRows: [scheduleRow({ session_name: "Yoga" })], summaryRows: [summaryRow({ class_name: "Yoga" })] };
  assert.equal(resolveOccurrenceState(raw, DATE, TIME, NAME).state, "unknown");
}

// no match — right name/time, different date -> unknown
{
  const raw: ArboxOccurrenceRaw = { scheduleRows: [scheduleRow({ date: "2026-09-15" })], summaryRows: [summaryRow({ date: "2026-09-15" })] };
  assert.equal(resolveOccurrenceState(raw, DATE, TIME, NAME).state, "unknown");
}

// no match — same class/date, different start_time (the "recurs twice a day" case) -> unknown
// for the 18:30 lookup, since only a 20:00 occurrence exists that day.
{
  const raw: ArboxOccurrenceRaw = { scheduleRows: [scheduleRow({ start_time: "20:00" })], summaryRows: [summaryRow({ start_time: "20:00" })] };
  assert.equal(resolveOccurrenceState(raw, DATE, TIME, NAME).state, "unknown");
}

// double match in schedule — two occurrences with identical date+time+name -> unknown, don't guess
{
  const raw: ArboxOccurrenceRaw = {
    scheduleRows: [scheduleRow({ schedule_id: 1 }), scheduleRow({ schedule_id: 2 })],
    summaryRows: [summaryRow()],
  };
  assert.equal(resolveOccurrenceState(raw, DATE, TIME, NAME).state, "unknown");
}

// double match in summary -> unknown
{
  const raw: ArboxOccurrenceRaw = {
    scheduleRows: [scheduleRow()],
    summaryRows: [summaryRow({ schedule_id: 1 }), summaryRow({ schedule_id: 2 })],
  };
  assert.equal(resolveOccurrenceState(raw, DATE, TIME, NAME).state, "unknown");
}

// missing max_participants on the matched schedule row -> unknown
{
  const raw: ArboxOccurrenceRaw = { scheduleRows: [scheduleRow({ max_participants: undefined })], summaryRows: [summaryRow()] };
  assert.equal(resolveOccurrenceState(raw, DATE, TIME, NAME).state, "unknown");
}

// max_participants is zero/non-positive -> unknown (defensive, not a real capacity)
{
  const raw: ArboxOccurrenceRaw = { scheduleRows: [scheduleRow({ max_participants: 0 })], summaryRows: [summaryRow()] };
  assert.equal(resolveOccurrenceState(raw, DATE, TIME, NAME).state, "unknown");
}

// missing registration_count on the matched summary row (status active) -> unknown
{
  const raw: ArboxOccurrenceRaw = { scheduleRows: [scheduleRow()], summaryRows: [summaryRow({ registration_count: undefined })] };
  assert.deepEqual(resolveOccurrenceState(raw, DATE, TIME, NAME), { state: "unknown", maxParticipants: 8 });
}

// class name matching is exact-after-trim only — no case-insensitivity, no fuzzy matching
{
  const raw: ArboxOccurrenceRaw = { scheduleRows: [scheduleRow({ session_name: "strength" })], summaryRows: [summaryRow({ class_name: "strength" })] };
  assert.equal(resolveOccurrenceState(raw, DATE, TIME, "Strength").state, "unknown", "case difference must not match");
}
{
  const raw: ArboxOccurrenceRaw = { scheduleRows: [scheduleRow({ session_name: ` ${NAME} ` })], summaryRows: [summaryRow({ class_name: ` ${NAME} ` })] };
  assert.equal(resolveOccurrenceState(raw, DATE, TIME, NAME).state, "open", "surrounding whitespace on the row is trimmed");
}

// missing input fields -> unknown, no crash
{
  const raw: ArboxOccurrenceRaw = { scheduleRows: [scheduleRow()], summaryRows: [summaryRow()] };
  assert.equal(resolveOccurrenceState(raw, "", TIME, NAME).state, "unknown");
  assert.equal(resolveOccurrenceState(raw, DATE, "", NAME).state, "unknown");
  assert.equal(resolveOccurrenceState(raw, DATE, TIME, "").state, "unknown");
}

// ---------- getOccurrenceState: network-level branches via fetchImpl injection ----------

function fakeFetch(byPath: (path: string) => { ok: boolean; status: number; json: unknown }): typeof arboxPublicFetch {
  return (async (pathOrUrl: string) => {
    const r = byPath(pathOrUrl);
    return { ok: r.ok, status: r.status, json: r.json, rawText: JSON.stringify(r.json) };
  }) as typeof arboxPublicFetch;
}

const baseInput = { businessId: 1, apiKey: "k", boxId: "1", date: DATE, time: TIME, className: NAME, skipCache: true as const };

async function main() {
  // HTTP 500 on both endpoints -> unknown, never throws
  {
    const fetchImpl = fakeFetch(() => ({ ok: false, status: 500, json: null }));
    const r = await getOccurrenceState({ ...baseInput, fetchImpl });
    assert.equal(r.state, "unknown");
  }

  // HTTP 500 on schedule only, summary succeeds with a cancelled row -> still "cancelled"
  // (cancelled only needs the summary endpoint, per the module's documented precedence).
  {
    const fetchImpl = fakeFetch((path) => {
      if (path.includes("/v3/schedule")) return { ok: false, status: 500, json: null };
      return { ok: true, status: 200, json: { data: [summaryRow({ status: "cancelled" })] } };
    });
    const r = await getOccurrenceState({ ...baseInput, fetchImpl });
    assert.equal(r.state, "cancelled");
  }

  // timeout — fetch never resolves -> unknown within the configured timeout, never hangs
  {
    const neverResolves: typeof arboxPublicFetch = () => new Promise(() => {});
    const start = Date.now();
    const r = await getOccurrenceState({ ...baseInput, fetchImpl: neverResolves, timeoutMs: 80 });
    const elapsed = Date.now() - start;
    assert.equal(r.state, "unknown");
    assert.ok(elapsed < 1000, `should resolve near the timeout, not hang (took ${elapsed}ms)`);
  }

  // end-to-end open path through getOccurrenceState with fetchImpl injection
  {
    const fetchImpl = fakeFetch((path) => {
      if (path.includes("/v3/schedule")) return { ok: true, status: 200, json: { data: [scheduleRow()] } };
      return { ok: true, status: 200, json: { data: [summaryRow({ registration_count: 2 })] } };
    });
    const r = await getOccurrenceState({ ...baseInput, fetchImpl });
    assert.deepEqual(r, { state: "open", maxParticipants: 8, registrationCount: 2, freeSpots: 6 });
  }

  // missing required input (no apiKey) -> unknown without attempting a fetch
  {
    let called = false;
    const fetchImpl: typeof arboxPublicFetch = (async () => {
      called = true;
      return { ok: true, status: 200, json: { data: [] }, rawText: "" };
    }) as typeof arboxPublicFetch;
    const r = await getOccurrenceState({ ...baseInput, apiKey: "", fetchImpl });
    assert.equal(r.state, "unknown");
    assert.equal(called, false, "must not call Arbox with no api key");
  }

  console.log("arbox-occurrence-state.test.ts: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
