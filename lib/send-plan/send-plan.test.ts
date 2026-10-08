import assert from "node:assert/strict";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { runArboxDailyContext } from "@/lib/leads/arbox-daily-run-context";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { DUPLICATE_GUARD_ERROR } from "@/lib/notifications/template-duplicate-guard";
import { templateFailureDispatch } from "@/lib/business-sends-hold";
import { renderHeldDetails } from "@/lib/send-plan/alerts";
import { bulkQueueHold } from "@/lib/send-plan/bulk";
import {
  breakerLimit,
  checkPlanItem,
  dailyAverages,
  dispatchInstant,
  eventMetaFromDedupKey,
  eventStartInstant,
  exceedsVolume,
  groupVolumeHolds,
  hourlyAverage,
  israelWallInstant,
  planEventKey,
  planRowDedupKey,
  relativeWordMismatch,
  SEND_CHECK_SKIPPED_ERROR,
  tripsBreaker,
  volumeLimit,
  type ItemCheckInput,
} from "@/lib/send-plan/checks";
import { SendPlanCollector } from "@/lib/send-plan/collector";
import {
  cancelExpiredHolds,
  dispatchPlannedSends,
  releasedRowSendableNow,
  revalidatePlannedRow,
  type DispatchDeps,
} from "@/lib/send-plan/dispatch";
import { fakeAdmin, type FakeAdmin } from "@/lib/send-plan/fake-admin";
import { cancelHeld, releaseHeld } from "@/lib/send-plan/holds";
import { planTooLate } from "@/lib/send-plan/runs";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const il = (ymd: string, hm: string) => israelWallInstant(ymd, hm)!;

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`FAIL - ${name}`);
    console.error(e);
  }
}

const baseItem = (over: Partial<ItemCheckInput> = {}): ItemCheckInput => ({
  triggerType: "missed_class",
  recipientKind: "customer",
  components: [{ type: "body", parameters: [{ type: "text", text: "דנה" }] }],
  renderedBody: "היי דנה, התגעגענו",
  eventYmd: null,
  sendAt: il("2026-10-12", "09:00"),
  duplicate: false,
  contact: { optedOut: false, isStaff: false, leaveRequest: false },
  optOutSuppress: false,
  wabaBlocked: false,
  ...over,
});

async function main() {
  // ---- time helpers ----
  await test("israelWallInstant is DST-safe", () => {
    assert.equal(il("2026-10-12", "09:00").toISOString(), "2026-10-12T06:00:00.000Z");
    assert.equal(il("2026-12-01", "09:00").toISOString(), "2026-12-01T07:00:00.000Z");
    assert.equal(dispatchInstant("2026-10-12", "evening")!.toISOString(), "2026-10-12T17:00:00.000Z");
    assert.equal(israelWallInstant("bad", "09:00"), null);
  });

  await test("plan too close to dispatch does nothing", () => {
    assert.equal(planTooLate("2026-10-12", "morning", il("2026-10-12", "08:00")), false);
    assert.equal(planTooLate("2026-10-12", "morning", il("2026-10-12", "08:56")), true);
    assert.equal(planTooLate("2026-10-12", "evening", il("2026-10-12", "21:00")), true);
  });

  // ---- certain duplicate ----
  await test("duplicate is blocked, before everything else", () => {
    const r = checkPlanItem(baseItem({ duplicate: true, optOutSuppress: true, wabaBlocked: true }));
    assert.deepEqual(r, { status: "blocked", reason: "duplicate" });
  });

  // ---- empty variable ----
  await test("empty required variable is held", () => {
    const r = checkPlanItem(baseItem({ components: [{ type: "body", parameters: [{ type: "text", text: "  " }] }] }));
    assert.equal(r.status, "held");
    assert.equal(r.reason, "empty_variable");
    assert.equal(r.detail, "body {{1}}");
  });

  // ---- relative words ----
  await test("ערב טוב at 09:00 and בוקר טוב at 20:00 are held", () => {
    assert.ok(relativeWordMismatch({ body: "ערב טוב דנה", sendAt: il("2026-10-12", "09:00") }));
    assert.equal(relativeWordMismatch({ body: "ערב טוב דנה", sendAt: il("2026-10-12", "20:00") }), null);
    assert.ok(relativeWordMismatch({ body: "בוקר טוב דנה", sendAt: il("2026-10-12", "20:00") }));
    assert.equal(relativeWordMismatch({ body: "בוקר טוב דנה", sendAt: il("2026-10-12", "09:00") }), null);
  });

  await test("מחר / היום / אתמול must match the event day", () => {
    const at = il("2026-10-12", "20:00");
    assert.equal(relativeWordMismatch({ body: "נתראה מחר", eventYmd: "2026-10-13", sendAt: at }), null);
    assert.ok(relativeWordMismatch({ body: "נתראה מחר", eventYmd: "2026-10-12", sendAt: at }));
    assert.equal(relativeWordMismatch({ body: "האימון היום", eventYmd: "2026-10-12", sendAt: at }), null);
    assert.ok(relativeWordMismatch({ body: "לא הגעת היום", eventYmd: "2026-10-11", sendAt: il("2026-10-12", "09:00") }));
    assert.equal(relativeWordMismatch({ body: "לא הגעת אתמול", eventYmd: "2026-10-11", sendAt: il("2026-10-12", "09:00") }), null);
    assert.ok(relativeWordMismatch({ body: "ומחר נתראה", eventYmd: "2026-10-15", sendAt: at }), "prefix ו");
  });

  await test("day words without a known event day, and look-alike words, pass", () => {
    const at = il("2026-10-12", "09:00");
    assert.equal(relativeWordMismatch({ body: "נתראה מחר", eventYmd: null, sendAt: at }), null);
    assert.equal(relativeWordMismatch({ body: "למחרת האימון", eventYmd: "2026-10-20", sendAt: at }), null);
    assert.equal(relativeWordMismatch({ body: "מחרתיים", eventYmd: "2026-10-20", sendAt: at }), null);
  });

  await test("relative words hold through checkPlanItem", () => {
    const r = checkPlanItem(baseItem({ renderedBody: "נתראה מחר", eventYmd: "2026-10-15" }));
    assert.equal(r.status, "held");
    assert.equal(r.reason, "relative_words");
  });

  // ---- recipient skips ----
  await test("opted out, staff, leave request are skipped with a reason", () => {
    assert.deepEqual(checkPlanItem(baseItem({ optOutSuppress: true })), { status: "skipped", reason: "opted_out" });
    const staff = checkPlanItem(baseItem({ contact: { optedOut: false, isStaff: true, leaveRequest: false } }));
    assert.deepEqual(staff, { status: "skipped", reason: "staff" });
    const leave = checkPlanItem(baseItem({ contact: { optedOut: false, isStaff: false, leaveRequest: true } }));
    assert.deepEqual(leave, { status: "skipped", reason: "leave_request_14d" });
  });

  await test("leave request does not skip a non-retention trigger; staff recipients skip contact checks", () => {
    const r = checkPlanItem(
      baseItem({ triggerType: "trial_reminder", contact: { optedOut: false, isStaff: false, leaveRequest: true } })
    );
    assert.equal(r.status, "planned");
    const staffRecipient = checkPlanItem(baseItem({ recipientKind: "staff", optOutSuppress: true }));
    assert.equal(staffRecipient.status, "planned");
  });

  // ---- blocked WABA ----
  await test("blocked WABA holds", () => {
    assert.deepEqual(checkPlanItem(baseItem({ wabaBlocked: true })), { status: "held", reason: "waba_blocked" });
  });

  // ---- volume ----
  await test("volume limit is 2x the daily average, at least 10", () => {
    assert.equal(volumeLimit(0), 10);
    assert.equal(volumeLimit(3), 10);
    assert.equal(volumeLimit(7.2), 15);
    assert.equal(exceedsVolume(10, 0), false);
    assert.equal(exceedsVolume(11, 0), true);
    const avg = dailyAverages([
      ...Array.from({ length: 28 }, () => ({ trigger_id: "a", created_at: "2026-10-01T06:00:00Z" })),
      ...Array.from({ length: 14 }, () => ({ trigger_id: null, created_at: "2026-10-01T06:00:00Z" })),
    ]);
    assert.equal(avg.byTrigger.get("a"), 2);
    assert.equal(avg.byTrigger.get("none"), 1);
    assert.equal(avg.business, 3);
  });

  await test("a trigger over its limit holds that whole trigger only", () => {
    const items = [
      ...Array.from({ length: 11 }, (_, i) => ({ id: `a${i}`, triggerKey: "a", status: "planned" as const })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, triggerKey: "b", status: "planned" as const })),
    ];
    const r = groupVolumeHolds({ items, triggerDailyAverage: new Map([["a", 1]]), businessDailyAverage: 10 });
    assert.equal(r.ids.size, 11);
    assert.ok(!r.ids.has("b0"));
    assert.deepEqual(r.groups, [{ group: "a", count: 11, limit: 10 }]);
  });

  await test("the business over its limit holds every planned item", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: `x${i}`,
      triggerKey: `t${i % 4}`,
      status: (i === 0 ? "skipped" : "planned") as "planned" | "skipped",
    }));
    const r = groupVolumeHolds({ items, triggerDailyAverage: new Map(), businessDailyAverage: 1 });
    assert.equal(r.ids.size, 11);
    assert.equal(r.groups[0]!.group, "business");
    assert.equal(r.groups[0]!.count, 11, "skipped items do not count");
  });

  // ---- circuit breaker math ----
  await test("breaker trips above 3x the hourly normal, at least 10", () => {
    assert.equal(breakerLimit(0), 10);
    assert.equal(breakerLimit(5), 15);
    assert.equal(tripsBreaker(9, 0), false);
    assert.equal(tripsBreaker(10, 0), true);
    assert.equal(tripsBreaker(14, 5), false);
    assert.equal(tripsBreaker(15, 5), true);
    const at = il("2026-10-12", "10:30");
    const times = [
      ...Array.from({ length: 28 }, () => il("2026-10-05", "10:10").toISOString()),
      il("2026-10-05", "11:10").toISOString(),
    ];
    assert.equal(hourlyAverage(times, at), 2);
  });

  // ---- keys + event meta ----
  await test("event meta from dedup keys", () => {
    const rem = eventMetaFromDedupKey("trial_reminder:5:t-rem:777:2026-10-13:18%3A00");
    assert.deepEqual({ ymd: rem.ymd, time: rem.time, userId: rem.userId }, { ymd: "2026-10-13", time: "18:00", userId: 777 });
    assert.equal(eventStartInstant(rem)!.toISOString(), "2026-10-13T15:00:00.000Z");
    assert.equal(eventMetaFromDedupKey("missed_class:5:t:42:2026-10-11#x").ymd, "2026-10-11");
    assert.deepEqual(eventMetaFromDedupKey("unknown_kind:1:2"), {});
    assert.deepEqual(eventMetaFromDedupKey(null), {});
  });

  await test("plan keys", () => {
    assert.equal(planEventKey({ templateClaimEventKey: "abc", params: ["x"] }), "abc");
    assert.equal(planEventKey({ templateClaimEventKey: null, params: [" a ", "b"] }), "params:a|b");
    assert.equal(
      planRowDedupKey({
        planDay: "2026-10-12",
        slot: "morning",
        businessId: 5,
        triggerId: null,
        phone: "972501111111",
        templateName: "t",
        eventKey: "e",
      }),
      "plan:2026-10-12:morning:5:-:972501111111:t:e"
    );
  });

  await test("a skipped send settles its sync log as skipped, not as a retry", () => {
    assert.equal(templateFailureDispatch(`${SEND_CHECK_SKIPPED_ERROR}:staff`), "skipped");
  });

  await test("held alert lists counts per business and reason", () => {
    const r = renderHeldDetails([
      { business: "סטודיו", reason: "relative_words", count: 2 },
      { business: "סטודיו", reason: "waba_blocked", count: 3 },
      { business: "ג׳ים", reason: "volume_anomaly", count: 12 },
    ]);
    assert.equal(r.total, 17);
    assert.match(r.details, /סטודיו: 2 מילת זמן לא תואמת, 3 חסימת וואטסאפ/);
    assert.match(r.details, /ג׳ים: 12 נפח חריג/);
  });

  // ---- dispatch re-validation (pure) ----
  await test("re-validation at dispatch", () => {
    const now = il("2026-10-12", "09:00");
    const row = {
      recipient_kind: "customer",
      event_at: il("2026-10-13", "18:00").toISOString(),
      event_meta: { triggerType: "trial_reminder" },
    };
    const ok = { row, now, businessPaused: false, contact: { optedOut: false, leaveRequest: false }, bookingActive: true };
    assert.equal(revalidatePlannedRow(ok), null);
    assert.equal(revalidatePlannedRow({ ...ok, businessPaused: true })!.status, "canceled");
    assert.equal(revalidatePlannedRow({ ...ok, contact: { optedOut: true, leaveRequest: false } })!.reason, "opted_out");
    assert.equal(revalidatePlannedRow({ ...ok, bookingActive: false })!.reason, "booking_canceled");
    assert.equal(revalidatePlannedRow({ ...ok, bookingActive: null }), null, "no snapshot row is not a cancel");
    assert.equal(revalidatePlannedRow({ ...ok, now: il("2026-10-13", "18:30") })!.reason, "class_started");
    const retention = { ...ok, row: { ...row, event_meta: { triggerType: "missed_class" } } };
    assert.equal(revalidatePlannedRow({ ...retention, contact: { optedOut: false, leaveRequest: true } })!.reason, "leave_request_14d");
  });

  await test("a released row goes out after dispatch only the same day, in the window, before the class", () => {
    const row = { plan_day: "2026-10-12", event_at: il("2026-10-12", "18:00").toISOString(), event_meta: { triggerType: "trial_reminder" } };
    assert.equal(releasedRowSendableNow(row, il("2026-10-12", "10:00")), true);
    assert.equal(releasedRowSendableNow(row, il("2026-10-12", "18:05")), false);
    assert.equal(releasedRowSendableNow({ ...row, plan_day: "2026-10-11" }, il("2026-10-12", "10:00")), false);
    assert.equal(releasedRowSendableNow({ ...row, event_meta: { triggerType: "missed_class" } }, il("2026-10-12", "23:30")), false);
  });

  // ---- PLAN -> DISPATCH end to end (in-memory database, fake Meta) ----
  await test("plan -> dispatch end to end", async () => {
    const { db, admin } = fakeAdmin<Admin>();
    seedBusiness(db);
    const planNow = il("2026-10-12", "08:00");
    const dispatchAt = il("2026-10-12", "09:00");
    const collector = new SendPlanCollector(admin, 5, "morning", "2026-10-12", dispatchAt, false, planNow, "plan");

    const send = (over: Partial<Parameters<typeof sendBusinessTemplate>[0]>) =>
      runArboxDailyContext(
        {
          businessId: 5,
          dryRun: false,
          timeoutMs: 1000,
          arboxCalls: 0,
          arboxReports: [],
          membershipTypesByKey: new Map(),
          sendPlan: collector,
        },
        () =>
          sendBusinessTemplate({
            to: "972501111111",
            phoneNumberId: "pn-5",
            templateName: "rem_tpl",
            languageCode: "he",
            alertTriggerId: "t-rem",
            eventDedupKey: "trial_reminder:5:t-rem:777:2026-10-13:18%3A00",
            components: [{ type: "body", parameters: [{ type: "text", text: "דנה" }, { type: "text", text: "18:00" }] }],
            ...over,
          })
      );

    const planned = await send({});
    assert.deepEqual(planned, { ok: true }, "planned: the run sees a send");
    const again = await send({});
    assert.equal(again.error, DUPLICATE_GUARD_ERROR, "same event twice: blocked");
    const leave = await send({
      to: "972502222222",
      templateName: "miss_tpl",
      alertTriggerId: "t-miss",
      eventDedupKey: "missed_class:5:t-miss:42:2026-10-11",
      components: [{ type: "body", parameters: [{ type: "text", text: "רון" }] }],
    });
    assert.equal(leave.error, `${SEND_CHECK_SKIPPED_ERROR}:leave_request_14d`);
    const optedOut = await send({
      to: "972503333333",
      templateName: "miss_tpl",
      alertTriggerId: "t-miss",
      eventDedupKey: "missed_class:5:t-miss:43:2026-10-11",
      components: [{ type: "body", parameters: [{ type: "text", text: "גל" }] }],
    });
    assert.equal(optedOut.error, "suppressed_opt_out");
    const words = await send({
      templateName: "today_tpl",
      alertTriggerId: "t-miss",
      eventDedupKey: "missed_class:5:t-miss:44:2026-10-11",
      components: [{ type: "body", parameters: [{ type: "text", text: "דנה" }] }],
    });
    assert.deepEqual(words, { ok: true }, "held looks sent to the run");
    const empty = await send({
      to: "972504444444",
      eventDedupKey: "trial_reminder:5:t-rem:778:2026-10-13:18%3A00",
      components: [{ type: "body", parameters: [{ type: "text", text: "" }, { type: "text", text: "18:00" }] }],
    });
    assert.deepEqual(empty, { ok: true });

    const summary = await collector.finalize();
    assert.equal(summary.planned, 1);
    assert.equal(summary.held, 2);
    assert.equal(summary.blocked, 1);
    assert.equal(summary.skipped, 2);
    assert.deepEqual(summary.held_by_reason, { relative_words: 1, empty_variable: 1 });

    const rows = db.rows("scheduled_template_sends");
    assert.equal(rows.length, 5, "blocked in-run duplicate is not written");
    const plannedRow = rows.find((r) => r.status === "planned")!;
    assert.equal(plannedRow.due_at, dispatchAt.toISOString());
    assert.equal(plannedRow.rendered_body, "היי דנה, נתראה מחר ב-18:00");
    assert.equal(plannedRow.event_at, il("2026-10-13", "18:00").toISOString());

    // Nothing goes out before DISPATCH.
    const sent: Array<Parameters<typeof sendBusinessTemplate>[0]> = [];
    const deps: DispatchDeps = {
      send: (async (input: Parameters<typeof sendBusinessTemplate>[0]) => {
        sent.push(input);
        return { ok: true };
      }) as typeof sendBusinessTemplate,
      log: async () => {},
    };
    const early = await dispatchPlannedSends({ admin, slot: "morning", now: il("2026-10-12", "08:30"), deps });
    assert.equal(early.fetched, 0);

    const dispatched = await dispatchPlannedSends({ admin, slot: "morning", now: dispatchAt, deps });
    assert.deepEqual(dispatched.outcomes, { sent: 1 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.to, "972501111111");
    assert.equal(sent[0]!.skipSendChecks, true);
    assert.deepEqual(sent[0]!.components, plannedRow.components);
    assert.equal(rows.find((r) => r.id === plannedRow.id)!.status, "sent");

    const twice = await dispatchPlannedSends({ admin, slot: "morning", now: dispatchAt, deps });
    assert.equal(twice.fetched, 0, "a dispatched row never goes out twice");

    // A second PLAN of the same event is a certain duplicate.
    const replan = new SendPlanCollector(admin, 5, "evening", "2026-10-12", il("2026-10-12", "20:00"), false, il("2026-10-12", "19:00"));
    const replanned = await runArboxDailyContext(
      { businessId: 5, dryRun: false, timeoutMs: 1000, arboxCalls: 0, arboxReports: [], membershipTypesByKey: new Map(), sendPlan: replan },
      () =>
        sendBusinessTemplate({
          to: "972501111111",
          phoneNumberId: "pn-5",
          templateName: "rem_tpl",
          alertTriggerId: "t-rem",
          eventDedupKey: "trial_reminder:5:t-rem:777:2026-10-13:18%3A00",
          components: [{ type: "body", parameters: [{ type: "text", text: "דנה" }, { type: "text", text: "18:00" }] }],
        })
    );
    assert.equal(replanned.error, DUPLICATE_GUARD_ERROR);

    // Held: release after DISPATCH sends now; cancel; end of day.
    const wordsRow = rows.find((r) => r.hold_reason === "relative_words")!;
    const released = await releaseHeld(admin, { ids: [String(wordsRow.id)] }, "lior@test", il("2026-10-12", "10:00"), deps);
    assert.equal(released.released, 1);
    assert.equal(released.sent_now, 1);
    assert.equal(wordsRow.status, "sent");
    const emptyRow = rows.find((r) => r.hold_reason === "empty_variable")!;
    const canceled = await cancelHeld(admin, { group: { businessId: 5, reason: "empty_variable" } }, "lior@test");
    assert.equal(canceled.canceled, 1);
    assert.equal(emptyRow.status, "canceled");
  });

  await test("dispatch re-validates from the database: canceled booking and new opt-out are not sent", async () => {
    const { db, admin } = fakeAdmin<Admin>();
    seedBusiness(db);
    const dispatchAt = il("2026-10-12", "09:00");
    const collector = new SendPlanCollector(admin, 5, "morning", "2026-10-12", dispatchAt, false, il("2026-10-12", "08:00"));
    const ctx = { businessId: 5, dryRun: false, timeoutMs: 1000, arboxCalls: 0, arboxReports: [], membershipTypesByKey: new Map(), sendPlan: collector };
    await runArboxDailyContext(ctx, () =>
      sendBusinessTemplate({
        to: "972501111111",
        phoneNumberId: "pn-5",
        templateName: "rem_tpl",
        alertTriggerId: "t-rem",
        eventDedupKey: "trial_reminder:5:t-rem:777:2026-10-13:18%3A00",
        components: [{ type: "body", parameters: [{ type: "text", text: "דנה" }, { type: "text", text: "18:00" }] }],
      })
    );
    await runArboxDailyContext(ctx, () =>
      sendBusinessTemplate({
        to: "972505555555",
        phoneNumberId: "pn-5",
        templateName: "miss_tpl",
        alertTriggerId: "t-miss",
        eventDedupKey: "missed_class:5:t-miss:50:2026-10-11",
        components: [{ type: "body", parameters: [{ type: "text", text: "נועה" }] }],
      })
    );
    await collector.finalize();
    // Between PLAN and DISPATCH: the booking disappears, the second contact opts out.
    db.rows("arbox_future_booking_snapshot")[0]!.disappeared_at = il("2026-10-12", "08:30").toISOString();
    db.rows("contacts").find((c) => c.phone === "972505555555")!.opted_out = true;
    const sent: unknown[] = [];
    const out = await dispatchPlannedSends({
      admin,
      slot: "morning",
      now: dispatchAt,
      deps: { send: (async (i: unknown) => (sent.push(i), { ok: true })) as typeof sendBusinessTemplate, log: async () => {} },
    });
    assert.equal(sent.length, 0);
    assert.deepEqual(out.outcomes, { skipped: 2 });
    const reasons = db.rows("scheduled_template_sends").map((r) => r.hold_reason).sort();
    assert.deepEqual(reasons, ["booking_canceled", "opted_out"]);
  });

  await test("blocked WABA holds the business's items; volume over 2x holds the group", async () => {
    const { db, admin } = fakeAdmin<Admin>();
    seedBusiness(db);
    db.seed("wa_message_statuses", [
      { business_id: 5, status: "failed", error_code: 131042, status_at: il("2026-10-11", "21:00").toISOString() },
    ]);
    const collector = new SendPlanCollector(admin, 5, "morning", "2026-10-12", il("2026-10-12", "09:00"), true, il("2026-10-12", "08:00"));
    const ctx = { businessId: 5, dryRun: true, timeoutMs: 1000, arboxCalls: 0, arboxReports: [], membershipTypesByKey: new Map(), sendPlan: collector };
    await runArboxDailyContext(ctx, () =>
      sendBusinessTemplate({
        to: "972501111111",
        phoneNumberId: "pn-5",
        templateName: "miss_tpl",
        alertTriggerId: "t-miss",
        eventDedupKey: "missed_class:5:t-miss:60:2026-10-11",
        components: [{ type: "body", parameters: [{ type: "text", text: "דנה" }] }],
      })
    );
    const s = await collector.finalize();
    assert.deepEqual(s.held_by_reason, { waba_blocked: 1 });
    assert.equal(db.rows("scheduled_template_sends").length, 0, "dry run writes nothing");

    const { db: db2, admin: admin2 } = fakeAdmin<Admin>();
    seedBusiness(db2);
    const vol = new SendPlanCollector(admin2, 5, "morning", "2026-10-12", il("2026-10-12", "09:00"), false, il("2026-10-12", "08:00"));
    const ctx2 = { ...ctx, dryRun: false, sendPlan: vol };
    for (let i = 0; i < 11; i += 1) {
      await runArboxDailyContext(ctx2, () =>
        sendBusinessTemplate({
          to: `97250700000${String(i).padStart(2, "0")}`,
          phoneNumberId: "pn-5",
          templateName: "miss_tpl",
          alertTriggerId: "t-miss",
          eventDedupKey: `missed_class:5:t-miss:${100 + i}:2026-10-11`,
          components: [{ type: "body", parameters: [{ type: "text", text: "דנה" }] }],
        })
      );
    }
    const v = await vol.finalize();
    assert.equal(v.held, 11);
    assert.deepEqual(v.held_by_reason, { volume_anomaly: 11 });
    assert.ok(db2.rows("scheduled_template_sends").every((r) => r.status === "held"));
  });

  await test("rows the run queues get the checks when queued (legacy mode)", async () => {
    const { db, admin } = fakeAdmin<Admin>();
    seedBusiness(db);
    db.seed("scheduled_template_sends", [
      {
        id: "q1",
        business_id: 5,
        trigger_id: "t-exp",
        contact_phone: "972501111111",
        template_name: "exp_tpl",
        due_at: il("2026-10-12", "15:00").toISOString(),
        status: "pending",
        dedup_key: "membership_expiring:5:t-exp:42:2026-10-15",
      },
    ]);
    const collector = new SendPlanCollector(admin, 5, "morning", "2026-10-12", il("2026-10-12", "09:00"), false, il("2026-10-12", "09:00"), "legacy");
    assert.equal(collector.intercepts, false, "legacy mode sends as today");
    collector.noteEnqueue({
      businessId: 5,
      triggerId: "t-exp",
      contactPhone: "972501111111",
      templateName: "exp_tpl",
      dueAt: il("2026-10-12", "15:00"),
      dedupKey: "membership_expiring:5:t-exp:42:2026-10-15",
    });
    const s = await collector.finalize();
    assert.equal(s.queued_checked, 1);
    const row = db.rows("scheduled_template_sends")[0]!;
    assert.equal(row.status, "held", "«מחר» for an expiry 3 days away");
    assert.equal(row.hold_reason, "relative_words");
    assert.equal(row.plan_slot, "queue");
  });

  await test("volume baseline falls back to the conversation log while per-trigger history is short", async () => {
    const { db, admin } = fakeAdmin<Admin>();
    seedBusiness(db);
    // 14 days x 30 automated template sends in the conversation log: limit 60.
    for (let d = 1; d <= 14; d += 1) {
      const at = new Date(il("2026-10-12", "00:00").getTime() - d * 86400_000 + 3600_000).toISOString();
      db.seed("messages", Array.from({ length: 30 }, () => ({ business_slug: "studio", role: "assistant", model_used: "lead_template", created_at: at })));
    }
    // One day of refs only: per-trigger check stays off.
    db.seed("wa_template_send_refs", [{ business_id: 5, trigger_id: "t-miss", created_at: il("2026-10-11", "09:00").toISOString() }]);
    const collector = new SendPlanCollector(admin, 5, "morning", "2026-10-12", il("2026-10-12", "09:00"), true, il("2026-10-12", "08:00"));
    const ctx = { businessId: 5, dryRun: true, timeoutMs: 1000, arboxCalls: 0, arboxReports: [], membershipTypesByKey: new Map(), sendPlan: collector };
    for (let i = 0; i < 15; i += 1) {
      await runArboxDailyContext(ctx, () =>
        sendBusinessTemplate({
          to: `97250800000${String(i).padStart(2, "0")}`,
          phoneNumberId: "pn-5",
          templateName: "miss_tpl",
          alertTriggerId: "t-miss",
          eventDedupKey: `missed_class:5:t-miss:${200 + i}:2026-10-11`,
          components: [{ type: "body", parameters: [{ type: "text", text: "דנה" }] }],
        })
      );
    }
    const s = await collector.finalize();
    assert.equal(s.planned, 15);
    assert.equal(s.held, 0);
  });

  await test("a staff send right after the run claims its queued row carries that row's trigger and key", async () => {
    const { db, admin } = fakeAdmin<Admin>();
    seedBusiness(db);
    db.seed("template_triggers", [{ id: "t-tr", trigger_type: "trainer_trial_heads_up" }]);
    const collector = new SendPlanCollector(admin, 5, "morning", "2026-10-12", il("2026-10-12", "09:00"), true, il("2026-10-12", "08:00"));
    const key = "trainer_trial_heads_up:5:t-tr:777:2026-10-12:13%3A00";
    collector.noteEnqueue({ businessId: 5, triggerId: "t-tr", contactPhone: "972509999999", templateName: "rem_tpl", dueAt: il("2026-10-12", "09:00"), dedupKey: key, recipientKind: "staff" });
    collector.noteQueueClaim(key);
    const ctx = { businessId: 5, dryRun: true, timeoutMs: 1000, arboxCalls: 0, arboxReports: [], membershipTypesByKey: new Map(), sendPlan: collector };
    await runArboxDailyContext(ctx, () =>
      sendBusinessTemplate({
        to: "972509999999",
        phoneNumberId: "pn-5",
        templateName: "rem_tpl",
        recipientKind: "staff",
        components: [{ type: "body", parameters: [{ type: "text", text: "דנה" }, { type: "text", text: "13:00" }] }],
      })
    );
    const s = await collector.finalize();
    assert.equal(s.queued_checked, 0, "the claimed queue row is not counted twice");
    assert.equal(collector.items.length, 1);
    assert.equal(collector.items[0]!.triggerType, "trainer_trial_heads_up");
    assert.equal(collector.items[0]!.triggerId, "t-tr");
  });

  await test("plan mode moves companion due times past DISPATCH", () => {
    const { admin } = fakeAdmin<Admin>();
    const c = new SendPlanCollector(admin, 5, "morning", "2026-10-12", il("2026-10-12", "09:00"), false, il("2026-10-12", "08:00"));
    assert.equal(c.shiftDue(il("2026-10-12", "08:02")).toISOString(), il("2026-10-12", "09:02").toISOString());
    assert.equal(c.shiftDue(il("2026-10-12", "15:00")).toISOString(), il("2026-10-12", "15:00").toISOString());
  });

  await test("unreleased holds and never-dispatched rows of an earlier day are canceled", async () => {
    const { db, admin } = fakeAdmin<Admin>();
    db.seed("scheduled_template_sends", [
      { id: "h1", status: "held", plan_day: "2026-10-11" },
      { id: "h2", status: "held", plan_day: "2026-10-12" },
      { id: "p1", status: "planned", plan_day: "2026-10-11" },
    ]);
    assert.equal(await cancelExpiredHolds(admin, il("2026-10-12", "00:05")), 2);
    assert.equal(db.rows("scheduled_template_sends")[2]!.last_error, "not_dispatched");
    assert.equal(db.rows("scheduled_template_sends")[0]!.last_error, "hold_expired");
    assert.equal(db.rows("scheduled_template_sends")[1]!.status, "held");
  });

  await test("bulk jobs: greeting at the wrong hour or blocked WABA is held at queue time", async () => {
    const { db, admin } = fakeAdmin<Admin>();
    const components = [{ type: "BODY", text: "בוקר טוב {{1}}! מבצע חדש" }];
    const evening = await bulkQueueHold({ admin, businessId: 5, templateName: "promo", components, dueAt: il("2026-10-12", "20:00") });
    assert.equal(evening?.reason, "relative_words");
    assert.equal(await bulkQueueHold({ admin, businessId: 5, templateName: "promo", components, dueAt: il("2026-10-12", "10:00") }), null);
    db.seed("template_send_failures", [{ business_id: 5, meta_code: "131042", created_at: new Date(Date.now() - 3600_000).toISOString() }]);
    const blocked = await bulkQueueHold({ admin, businessId: 5, templateName: "promo", components, dueAt: il("2026-10-12", "10:00") });
    assert.equal(blocked?.reason, "waba_blocked");
  });

  if (failures) {
    console.error(`\n${failures} failed`);
    process.exit(1);
  }
  console.log("\nall send-plan tests passed");
}

function seedBusiness(db: FakeAdmin) {
  db.seed("businesses", [{ id: 5, name: "סטודיו", slug: "studio", social_links: {} }]);
  db.seed("template_triggers", [
    { id: "t-rem", trigger_type: "trial_reminder" },
    { id: "t-miss", trigger_type: "missed_class" },
    { id: "t-exp", trigger_type: "membership_expiring" },
  ]);
  db.seed("whatsapp_templates", [
    { business_id: 5, name: "rem_tpl", category: "UTILITY", language: "he", components: [{ type: "BODY", text: "היי {{1}}, נתראה מחר ב-{{2}}" }] },
    { business_id: 5, name: "miss_tpl", category: "MARKETING", language: "he", components: [{ type: "BODY", text: "היי {{1}}, התגעגענו" }] },
    { business_id: 5, name: "today_tpl", category: "MARKETING", language: "he", components: [{ type: "BODY", text: "היי {{1}}, לא הגעת היום" }] },
    { business_id: 5, name: "exp_tpl", category: "UTILITY", language: "he", components: [{ type: "BODY", text: "היי {{1}}, המנוי מסתיים מחר" }] },
  ]);
  const recent = il("2026-10-05", "12:00").toISOString();
  db.seed("contacts", [
    { business_id: 5, phone: "972501111111", full_name: "דנה כהן", opted_out: false },
    { business_id: 5, phone: "972502222222", full_name: "רון", opted_out: false, leave_request_at: recent },
    { business_id: 5, phone: "972503333333", full_name: "גל", opted_out: true },
    { business_id: 5, phone: "972505555555", full_name: "נועה", opted_out: false },
  ]);
  db.seed("arbox_future_booking_snapshot", [
    { business_id: 5, user_id: "777", class_date: "2026-10-13", class_time: "18:00:00", disappeared_at: null, class_cancelled_at: null },
  ]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
