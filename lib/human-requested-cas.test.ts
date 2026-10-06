import assert from "node:assert/strict";
import { handleLeadHumanRequested } from "@/lib/human-requested";

type Row = { human_requested_at?: string | null };

function contactQuery(row: Row | null, onUpdate?: () => void) {
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
    update() {
      onUpdate?.();
      return api;
    },
    async maybeSingle() {
      return { data: row, error: null };
    },
    then(resolve: (value: { data: { id: string }[] | null; error: null }) => void) {
      resolve({ data: [], error: null });
    },
  };
  return {
    from() {
      return api;
    },
  };
}

async function main() {
  let writes = 0;
  const alreadySet = await handleLeadHumanRequested({
    supabase: contactQuery({ human_requested_at: "2026-10-01T00:00:00Z" }, () => {
      writes += 1;
    }) as never,
    businessId: 1,
    businessSlug: "apex",
    phone: "972508318162",
    nowIso: "2026-10-06T00:00:00Z",
    sessionId: "sess",
  });
  assert.equal(alreadySet.already, true);
  assert.equal(writes, 0);

  writes = 0;
  const lostRace = await handleLeadHumanRequested({
    supabase: contactQuery({ human_requested_at: null }, () => {
      writes += 1;
    }) as never,
    businessId: 1,
    businessSlug: "apex",
    phone: "972508318162",
    nowIso: "2026-10-06T00:00:00Z",
    sessionId: "sess",
  });
  assert.equal(lostRace.already, true);
  assert.equal(writes, 1);

  console.log("human-requested-cas.test.ts: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
