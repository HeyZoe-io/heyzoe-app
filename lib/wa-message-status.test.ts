import assert from "node:assert/strict";
import {
  DELIVERY_FAILED_REASON,
  loadDeliveryProblems,
  UNDELIVERED_24H_REASON,
  unsentDetailParam,
  unsentGroup,
} from "@/lib/admin-daily-unsent-summary";
import { parseMetaStatusEvents, persistMetaStatusEvents } from "@/lib/wa-message-status";

type Row = Record<string, unknown>;
type Call = { table: string; op: string; rows?: Row[]; options?: Row };

/** Minimal PostgREST stand-in: eq / in / gte / lt / order / limit over in-memory rows. */
function fakeAdmin(tables: Record<string, Row[]>, opts: { errors?: Record<string, string>; throwOn?: string } = {}) {
  const calls: Call[] = [];
  const admin = {
    from(table: string) {
      if (opts.throwOn === table) throw new Error("boom");
      let rows = [...(tables[table] ?? [])];
      let limit = Infinity;
      const err = opts.errors?.[table];
      const builder = {
        select() { return builder; },
        eq(col: string, v: unknown) { rows = rows.filter((r) => r[col] === v); return builder; },
        in(col: string, vs: unknown[]) { rows = rows.filter((r) => vs.includes(r[col])); return builder; },
        gte(col: string, v: string) { rows = rows.filter((r) => String(r[col] ?? "") >= v); return builder; },
        lt(col: string, v: string) { rows = rows.filter((r) => String(r[col] ?? "") < v); return builder; },
        order(col: string, o: { ascending: boolean }) {
          rows.sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (o.ascending ? 1 : -1));
          return builder;
        },
        limit(n: number) { limit = n; return builder; },
        upsert(input: Row[], options: Row) {
          calls.push({ table, op: "upsert", rows: input, options });
          return Promise.resolve({ error: err ? { message: err } : null });
        },
        then(resolve: (v: unknown) => unknown) {
          calls.push({ table, op: "select" });
          return Promise.resolve(err ? { data: null, error: { message: err } } : { data: rows.slice(0, limit), error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { admin: admin as never, calls };
}

const payload = {
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "PN1" },
            statuses: [
              { id: "wamid.A", status: "sent", timestamp: "1791450076", recipient_id: "972507772359" },
              { id: "wamid.A", status: "delivered", timestamp: "1791450080", recipient_id: "972507772359" },
              {
                id: "wamid.B",
                status: "failed",
                timestamp: "1791456341",
                recipient_id: "+972543347210",
                errors: [{ code: 131049, title: "This message was not delivered to maintain healthy ecosystem engagement." }],
              },
              { id: "wamid.C", status: "deleted", timestamp: "1791456341", recipient_id: "1" },
              { status: "sent", timestamp: "1791456341" },
            ],
          },
        },
      ],
    },
  ],
};

const events = parseMetaStatusEvents(payload);
assert.equal(events.length, 3, "unknown status and missing wamid are dropped");
assert.deepEqual(events[0], {
  wamid: "wamid.A",
  status: "sent",
  phoneNumberId: "PN1",
  recipientPhone: "972507772359",
  errorCode: null,
  errorTitle: null,
  statusAt: new Date(1791450076 * 1000).toISOString(),
});
assert.equal(events[2].errorCode, 131049);
assert.equal(events[2].recipientPhone, "972543347210");
assert.match(String(events[2].errorTitle), /healthy ecosystem/);
assert.deepEqual(parseMetaStatusEvents({ entry: [{ changes: [{ value: { messages: [{ id: "x" }] } }] }] }), []);
assert.deepEqual(parseMetaStatusEvents(null), []);

async function main() {
  {
    const { admin, calls } = fakeAdmin({ whatsapp_channels: [{ phone_number_id: "PN1", business_id: 3445 }] });
    const res = await persistMetaStatusEvents(admin, [...events, events[0]]);
    assert.deepEqual(res, { ok: true, rows: 3 }, "duplicate (wamid, status) collapses in one batch");
    const up = calls.find((c) => c.op === "upsert")!;
    assert.equal(up.table, "wa_message_statuses");
    assert.deepEqual(up.options, { onConflict: "wamid,status", ignoreDuplicates: true });
    assert.equal(up.rows![0].business_id, 3445);
    assert.equal(up.rows![2].error_code, 131049);
  }
  {
    const { admin } = fakeAdmin({}, { errors: { wa_message_statuses: 'relation "public.wa_message_statuses" does not exist' } });
    const res = await persistMetaStatusEvents(admin, events);
    assert.equal(res.ok, false, "missing table is reported, not thrown");
  }
  {
    const { admin } = fakeAdmin({}, { throwOn: "wa_message_statuses" });
    const res = await persistMetaStatusEvents(admin, events);
    assert.equal(res.ok, false, "a thrown client error is caught");
  }
  assert.deepEqual(await persistMetaStatusEvents(fakeAdmin({}).admin, []), { ok: true, rows: 0 });

  // Daily summary: delivery failures + undelivered after 24h.
  const now = new Date("2026-10-10T07:00:00.000Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 36e5).toISOString();
  const ref = (wamid: string, h: number, extra: Row = {}) => ({
    wamid,
    business_id: 3445,
    phone: "972500000000",
    template_name: "membership_cancelled_v2",
    trigger_id: "t1",
    created_at: hoursAgo(h),
    ...extra,
  });
  {
    const { admin } = fakeAdmin({
      wa_message_statuses: [
        { wamid: "w.fail", status: "failed", error_code: 131049, status_at: hoursAgo(3), received_at: hoursAgo(3) },
        { wamid: "w.notref", status: "failed", error_code: 131026, status_at: hoursAgo(3), received_at: hoursAgo(3) },
        { wamid: "w.oldfail", status: "failed", error_code: 131026, status_at: hoursAgo(30), received_at: hoursAgo(30) },
        { wamid: "w.deliv", status: "delivered", status_at: hoursAgo(29), received_at: hoursAgo(40) },
        { wamid: "w.sentonly", status: "sent", status_at: hoursAgo(30), received_at: hoursAgo(30) },
      ],
      wa_template_send_refs: [
        ref("w.fail", 3),
        ref("w.oldfail", 30),
        ref("w.deliv", 29),
        ref("w.sentonly", 30),
        ref("w.none", 26),
        ref("w.beforetracking", 45),
        ref("w.recent", 5),
      ],
    });
    const rows = await loadDeliveryProblems(admin, now);
    const failed = rows.filter((r) => r.reason === DELIVERY_FAILED_REASON);
    assert.deepEqual(failed.map((r) => r.metaError), ["131049"], "only automated sends, last 24h");
    const undelivered = rows.filter((r) => r.reason === UNDELIVERED_24H_REASON).map((r) => r.at).sort();
    assert.deepEqual(undelivered, [hoursAgo(30), hoursAgo(26)].sort(), "sent-only and no-status; delivered/failed settled; pre-tracking skipped");
    assert.equal(rows.every((r) => r.businessId === 3445 && r.triggerId === "t1"), true);
  }
  {
    const { admin } = fakeAdmin({ wa_template_send_refs: [ref("w.none", 30)] });
    assert.deepEqual(await loadDeliveryProblems(admin, now), [], "no stored statuses yet → nothing is called undelivered");
  }
  {
    const { admin } = fakeAdmin({}, { errors: { wa_message_statuses: "Could not find the table 'public.wa_message_statuses' in the schema cache" } });
    assert.deepEqual(await loadDeliveryProblems(admin, now), [], "before the SQL runs the summary is unchanged");
  }

  assert.equal(unsentGroup({ reason: DELIVERY_FAILED_REASON }), "problem");
  assert.equal(unsentGroup({ reason: UNDELIVERED_24H_REASON }), "problem");
  const detail = unsentDetailParam([
    { businessId: 3445, business: "Apex", trigger: "membership_cancelled", contact: "***1", reason: DELIVERY_FAILED_REASON, at: "", metaError: "131049" },
    { businessId: 3445, business: "Apex", trigger: "membership_cancelled", contact: "***2", reason: DELIVERY_FAILED_REASON, at: "", metaError: "131049" },
    { businessId: 3445, business: "Apex", trigger: "membership_cancelled", contact: "***3", reason: UNDELIVERED_24H_REASON, at: "" },
  ]);
  assert.match(detail, /Apex · membership_cancelled · נכשל במסירה 131049 2/);
  assert.match(detail, /Apex · membership_cancelled · לא נמסר אחרי 24 שעות 1/);
  console.log("wa-message-status tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
