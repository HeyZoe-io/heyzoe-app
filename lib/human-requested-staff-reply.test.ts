import assert from "node:assert/strict";
import {
  appEchoTextClearsHumanRequested,
  buildHumanReplyClearsRequestPatch,
  clearHumanRequestedAfterStaffReply,
  handleLeadHumanRequested,
  HUMAN_REPLY_FOLLOWUP_HOLD_STAGE,
  isHumanReplyFollowupHold,
  leadMessageMaySetHumanRequested,
  manualDashboardSendClearsHumanRequested,
} from "@/lib/human-requested";

assert.equal(appEchoTextClearsHumanRequested("text"), true);
assert.equal(appEchoTextClearsHumanRequested("reaction"), false);
assert.equal(appEchoTextClearsHumanRequested("image"), false);
assert.equal(appEchoTextClearsHumanRequested("sticker"), false);
assert.equal(appEchoTextClearsHumanRequested(""), false);
assert.equal(manualDashboardSendClearsHumanRequested(), true);

const patch = buildHumanReplyClearsRequestPatch();
assert.equal(patch.human_requested_at, null);
assert.equal(patch.wa_followup_stage, HUMAN_REPLY_FOLLOWUP_HOLD_STAGE);
assert.equal(isHumanReplyFollowupHold(4), true);
assert.equal(isHumanReplyFollowupHold(3), false);
assert.equal(isHumanReplyFollowupHold(0), false);
assert.equal(leadMessageMaySetHumanRequested(true), false);
assert.equal(leadMessageMaySetHumanRequested(false), true);

function supabaseMock(input: {
  pausedUntil?: string | null;
  updateRows?: { id: string }[];
  onContactUpdate?: (values: Record<string, unknown>) => void;
}) {
  return {
    from(table: string) {
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        in() {
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return api;
        },
        is() {
          return api;
        },
        not() {
          return api;
        },
        update(values: Record<string, unknown>) {
          if (table === "contacts") input.onContactUpdate?.(values);
          return api;
        },
        async maybeSingle() {
          return { data: { human_requested_at: null, full_name: null }, error: null };
        },
        then(resolve: (value: { data: { id?: string; paused_until?: string }[] | null; error: null }) => void) {
          if (table === "paused_sessions") {
            resolve({
              data: input.pausedUntil ? [{ paused_until: input.pausedUntil }] : [],
              error: null,
            });
            return;
          }
          resolve({ data: input.updateRows ?? [], error: null });
        },
      };
      return api;
    },
  };
}

async function main() {
  let writes = 0;
  const paused = await handleLeadHumanRequested({
    supabase: supabaseMock({
      pausedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      onContactUpdate: () => {
        writes += 1;
      },
    }) as never,
    businessId: 1,
    businessSlug: "apex",
    phone: "972508318162",
    nowIso: "2026-10-07T12:00:00.000Z",
    sessionId: "wa_123_972508318162",
  });
  assert.equal(paused.already, true);
  assert.equal(writes, 0);

  writes = 0;
  const open = await handleLeadHumanRequested({
    supabase: supabaseMock({
      onContactUpdate: () => {
        writes += 1;
      },
    }) as never,
    businessId: 1,
    businessSlug: "apex",
    phone: "972508318162",
    nowIso: "2026-10-07T18:00:00.000Z",
    sessionId: "wa_123_972508318162",
  });
  assert.equal(open.already, true);
  assert.equal(writes, 1);

  writes = 0;
  const clearPatch: Record<string, unknown> = {};
  const cleared = await clearHumanRequestedAfterStaffReply({
    supabase: supabaseMock({
      updateRows: [{ id: "c1" }],
      onContactUpdate: (values) => {
        writes += 1;
        Object.assign(clearPatch, values);
      },
    }) as never,
    businessId: 1,
    phone: "972508318162",
  });
  assert.equal(cleared.cleared, true);
  assert.equal(writes, 1);
  assert.equal(clearPatch.human_requested_at, null);
  assert.equal(clearPatch.wa_followup_stage, HUMAN_REPLY_FOLLOWUP_HOLD_STAGE);

  console.log("human-requested-staff-reply.test.ts: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
