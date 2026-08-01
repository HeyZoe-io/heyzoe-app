import assert from "node:assert/strict";
import {
  pickDefaultActiveChannel,
  pickSendChannelForContact,
  resolveDefaultSendChannel,
  resolveSendChannelForContact,
  type ActiveWaChannel,
} from "@/lib/wa-resolve-send-channel";

const staleLowId: ActiveWaChannel = {
  id: 3,
  phoneNumberId: "1048979848304824",
  businessSlug: "acrobyjoe",
  createdAt: "2026-03-30T08:59:35.000Z",
};
const liveHighId: ActiveWaChannel = {
  id: 35,
  phoneNumberId: "1144781695390397",
  businessSlug: "acrobyjoe",
  createdAt: "2026-06-14T13:59:13.000Z",
};
const midId: ActiveWaChannel = {
  id: 34,
  phoneNumberId: "1206517659210231",
  businessSlug: "acrobyjoe",
  createdAt: "2026-06-14T12:45:39.000Z",
};

/** Multi-channel: contact inbound on non-first (high id) → that channel, not low-id. */
{
  const picked = pickSendChannelForContact(
    [staleLowId, midId, liveHighId],
    liveHighId.phoneNumberId
  );
  assert.equal(picked?.phoneNumberId, liveHighId.phoneNumberId);
  assert.notEqual(picked?.id, staleLowId.id);
}

/** No inbound: prefer newest by created_at, not lowest id. */
{
  const picked = pickSendChannelForContact([staleLowId, midId, liveHighId], null);
  assert.equal(picked?.phoneNumberId, liveHighId.phoneNumberId);
  assert.equal(picked?.id, 35);
}

/** Deactivated stale not in active list → returns the remaining active. */
{
  const picked = pickDefaultActiveChannel([liveHighId]);
  assert.equal(picked?.phoneNumberId, liveHighId.phoneNumberId);
}

/** No active channel → null. */
{
  assert.equal(pickDefaultActiveChannel([]), null);
  assert.equal(pickSendChannelForContact([], "1144781695390397"), null);
}

/** CONNECTED prefer wins over newer non-connected when set is provided. */
{
  const picked = pickDefaultActiveChannel([liveHighId, midId], new Set([midId.phoneNumberId]));
  assert.equal(picked?.phoneNumberId, midId.phoneNumberId);
}

type ChannelRow = {
  id: number;
  phone_number_id: string;
  business_slug: string;
  created_at: string;
  is_active: boolean;
};

type MessageRow = {
  created_at: string;
  session_id: string;
  role: string;
  business_slug: string;
};

function createMockAdmin(input: {
  channels: ChannelRow[];
  messages: MessageRow[];
}): {
  from: (table: string) => any;
} {
  return {
    from(table: string) {
      if (table === "whatsapp_channels") {
        const state: {
          businessId?: number;
          isActive?: boolean;
          orderAsc?: boolean;
        } = {};
        const chain: any = {
          select() {
            return chain;
          },
          eq(col: string, val: unknown) {
            if (col === "business_id") state.businessId = Number(val);
            if (col === "is_active") state.isActive = Boolean(val);
            return chain;
          },
          order(_col: string, opts?: { ascending?: boolean }) {
            state.orderAsc = opts?.ascending === true;
            return chain;
          },
          then(resolve: (v: unknown) => void) {
            let rows = input.channels.filter((c) => {
              if (state.businessId != null && c.id /* filter by biz via fixture */) {
                // fixtures share one business; filter is_active only
              }
              if (state.isActive === true && !c.is_active) return false;
              return true;
            });
            rows = rows.slice().sort((a, b) => {
              const ta = Date.parse(a.created_at) || 0;
              const tb = Date.parse(b.created_at) || 0;
              return state.orderAsc ? ta - tb : tb - ta;
            });
            resolve({ data: rows, error: null });
          },
        };
        return chain;
      }

      if (table === "messages") {
        const state: {
          businessSlug?: string;
          sessionIds?: string[];
          role?: string;
        } = {};
        const chain: any = {
          select() {
            return chain;
          },
          eq(col: string, val: unknown) {
            if (col === "business_slug") state.businessSlug = String(val);
            if (col === "role") state.role = String(val);
            return chain;
          },
          in(col: string, vals: unknown[]) {
            if (col === "session_id") state.sessionIds = vals.map(String);
            return chain;
          },
          order() {
            return chain;
          },
          limit() {
            return chain;
          },
          maybeSingle() {
            const rows = input.messages
              .filter((m) => {
                if (state.businessSlug && m.business_slug !== state.businessSlug) return false;
                if (state.role && m.role !== state.role) return false;
                if (state.sessionIds && !state.sessionIds.includes(m.session_id)) return false;
                return true;
              })
              .slice()
              .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
            const top = rows[0] ?? null;
            return Promise.resolve({
              data: top
                ? { created_at: top.created_at, session_id: top.session_id }
                : null,
              error: null,
            });
          },
        };
        return chain;
      }

      throw new Error(`unexpected table ${table}`);
    },
  };
}

(async () => {
  const phone = "972508318162";
  const liveSession = `wa_${liveHighId.phoneNumberId}_${phone}`;

  const multi = createMockAdmin({
    channels: [
      { ...staleLowId, phone_number_id: staleLowId.phoneNumberId, business_slug: "acrobyjoe", created_at: staleLowId.createdAt, is_active: true },
      { ...midId, phone_number_id: midId.phoneNumberId, business_slug: "acrobyjoe", created_at: midId.createdAt, is_active: true },
      { ...liveHighId, phone_number_id: liveHighId.phoneNumberId, business_slug: "acrobyjoe", created_at: liveHighId.createdAt, is_active: true },
    ],
    messages: [
      {
        created_at: "2026-07-30T10:00:00.000Z",
        session_id: liveSession,
        role: "user",
        business_slug: "acrobyjoe",
      },
    ],
  });

  const resolved = await resolveSendChannelForContact(multi as any, 1, phone);
  assert.equal(resolved?.phoneNumberId, liveHighId.phoneNumberId, "inbound on live channel wins");

  const onlyLiveActive = createMockAdmin({
    channels: [
      {
        id: 3,
        phone_number_id: staleLowId.phoneNumberId,
        business_slug: "acrobyjoe",
        created_at: staleLowId.createdAt,
        is_active: false,
      },
      {
        id: 35,
        phone_number_id: liveHighId.phoneNumberId,
        business_slug: "acrobyjoe",
        created_at: liveHighId.createdAt,
        is_active: true,
      },
    ],
    messages: [],
  });
  const afterDeactivate = await resolveDefaultSendChannel(onlyLiveActive as any, 1);
  assert.equal(afterDeactivate?.phoneNumberId, liveHighId.phoneNumberId);

  const none = createMockAdmin({
    channels: [
      {
        id: 3,
        phone_number_id: staleLowId.phoneNumberId,
        business_slug: "acrobyjoe",
        created_at: staleLowId.createdAt,
        is_active: false,
      },
    ],
    messages: [],
  });
  assert.equal(await resolveDefaultSendChannel(none as any, 1), null);
  assert.equal(await resolveSendChannelForContact(none as any, 1, phone), null);

  console.log("wa-resolve-send-channel.test.ts: ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
