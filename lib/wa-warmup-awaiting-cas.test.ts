import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  tryAdvanceWarmupAwaitingIdx,
  tryAdvanceWarmupAwaitingOnPick,
  WARMUP_EXTRA_AWAITING_OFF,
} from "@/lib/wa-warmup-awaiting-cas";

type MockContact = {
  id: string;
  business_id: number;
  phone: string;
  session_phase: string;
  warmup_extra_awaiting_idx: number;
  updated_at: string;
};

/** In-memory Supabase mock with real CAS semantics on warmup_extra_awaiting_idx. */
function createMockSupabase(initialIdx: number): {
  supabase: SupabaseClient;
  getIdx: () => number;
  sendLog: string[];
} {
  const row: MockContact = {
    id: "contact-1",
    business_id: 974,
    phone: "972501111111",
    session_phase: "warmup",
    warmup_extra_awaiting_idx: initialIdx,
    updated_at: new Date().toISOString(),
  };
  const sendLog: string[] = [];

  type Filters = {
    business_id?: number;
    session_phase?: string;
    phone_in?: string[];
    update_business_id?: number;
    update_session_phase?: string;
    update_warmup_extra_awaiting_idx?: number;
    update_phone_in?: string[];
  };

  function matchesPhone(filters: Filters): boolean {
    const phones = filters.phone_in ?? filters.update_phone_in ?? [];
    return phones.includes(row.phone);
  }

  function executeCasUpdate(patch: Partial<MockContact>, filters: Filters) {
    if (filters.update_business_id !== row.business_id) return { data: [], error: null };
    if (filters.update_session_phase !== "warmup") return { data: [], error: null };
    if (filters.update_warmup_extra_awaiting_idx !== row.warmup_extra_awaiting_idx) {
      return { data: [], error: null };
    }
    if (!matchesPhone(filters)) return { data: [], error: null };
    row.warmup_extra_awaiting_idx = patch.warmup_extra_awaiting_idx ?? row.warmup_extra_awaiting_idx;
    row.updated_at = patch.updated_at ?? row.updated_at;
    return { data: [{ id: row.id }], error: null };
  }

  function buildReadChain(filters: Filters) {
    return {
      eq(col: string, val: unknown) {
        if (col === "business_id") filters.business_id = val as number;
        if (col === "session_phase") filters.session_phase = val as string;
        return buildReadChain(filters);
      },
      in(col: string, vals: unknown[]) {
        if (col === "phone") filters.phone_in = vals as string[];
        return {
          maybeSingle() {
            if (filters.business_id !== row.business_id || filters.session_phase !== "warmup") {
              return Promise.resolve({ data: null, error: null });
            }
            if (!matchesPhone(filters)) return Promise.resolve({ data: null, error: null });
            return Promise.resolve({
              data: { id: row.id, warmup_extra_awaiting_idx: row.warmup_extra_awaiting_idx },
              error: null,
            });
          },
        };
      },
      maybeSingle() {
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  function buildUpdateChain(patch: Partial<MockContact>, filters: Filters) {
    return {
      eq(col: string, val: unknown) {
        if (col === "business_id") filters.update_business_id = val as number;
        if (col === "session_phase") filters.update_session_phase = val as string;
        if (col === "warmup_extra_awaiting_idx") {
          filters.update_warmup_extra_awaiting_idx = val as number;
        }
        return buildUpdateChain(patch, filters);
      },
      in(col: string, vals: unknown[]) {
        if (col === "phone") filters.update_phone_in = vals as string[];
        return {
          select(_cols: string) {
            return Promise.resolve(executeCasUpdate(patch, filters));
          },
        };
      },
      select(_cols: string) {
        return Promise.resolve(executeCasUpdate(patch, filters));
      },
    };
  }

  const supabase = {
    from(table: string) {
      assert.equal(table, "contacts");
      return {
        select(_cols: string) {
          const filters: Filters = {};
          return buildReadChain(filters);
        },
        update(patch: Partial<MockContact>) {
          const filters: Filters = {};
          return buildUpdateChain(patch, filters);
        },
      };
    },
  } as unknown as SupabaseClient;

  return {
    supabase,
    getIdx: () => row.warmup_extra_awaiting_idx,
    sendLog,
  };
}

const baseInput = {
  businessId: 974,
  phone: "972501111111",
};

async function simulateSend(label: string, sendLog: string[]) {
  sendLog.push(label);
}

async function main() {
  // --- Test A: parallel CAS — only one wins ---
  {
    const { supabase, getIdx, sendLog } = createMockSupabase(2);
    let sendCount = 0;

    const runOne = async () => {
      const result = await tryAdvanceWarmupAwaitingOnPick({
        supabase,
        ...baseInput,
        pickIdx: 2,
        nextIdx: 3,
      });
      if (result.advanced) {
        sendCount += 1;
        await simulateSend("extra-3", sendLog);
      }
      return result;
    };

    const [a, b] = await Promise.all([runOne(), runOne()]);

    const winners = [a, b].filter((r) => r.advanced);
    const losers = [a, b].filter((r) => !r.advanced);

    assert.equal(winners.length, 1, `expected exactly one winner; got ${JSON.stringify([a, b])}`);
    assert.equal(losers.length, 1);
    assert.equal(losers[0]?.reason, "cas_lost_race");
    assert.equal(getIdx(), 3);
    assert.equal(sendCount, 1);
    assert.deepEqual(sendLog, ["extra-3"]);
    console.log("Test A (parallel CAS): passed");
  }

  // --- Test B: sequential happy path — every CAS succeeds ---
  {
    const { supabase, getIdx, sendLog } = createMockSupabase(WARMUP_EXTRA_AWAITING_OFF);
    const steps: Array<{
      label: string;
      requireReadIdx?: number;
      pickIdx?: number;
      nextIdx: number;
    }> = [
      { label: "Q1", requireReadIdx: WARMUP_EXTRA_AWAITING_OFF, nextIdx: -1 },
      { label: "extra-0", pickIdx: -1, nextIdx: 0 },
      { label: "extra-1", pickIdx: 0, nextIdx: 1 },
      { label: "extra-2", pickIdx: 1, nextIdx: 2 },
      { label: "extra-3", pickIdx: 2, nextIdx: 3 },
      { label: "extra-4", pickIdx: 3, nextIdx: 4 },
    ];

    for (const step of steps) {
      const result = await tryAdvanceWarmupAwaitingIdx({
        supabase,
        ...baseInput,
        requireReadIdx: step.requireReadIdx ?? null,
        pickIdx: step.pickIdx ?? null,
        nextIdx: step.nextIdx,
      });
      assert.equal(
        result.advanced,
        true,
        `step ${step.label} should advance; got ${JSON.stringify(result)}`
      );
      assert.equal(getIdx(), step.nextIdx, `after ${step.label}`);
      await simulateSend(step.label, sendLog);
    }

    assert.equal(getIdx(), 4);
    assert.equal(sendLog.length, steps.length);
    console.log("Test B (sequential happy path): passed");
  }

  // --- Test B sub-case: Q1 pending (-1), extra pick (0) must NOT send ---
  {
    const { supabase, getIdx, sendLog } = createMockSupabase(-1);
    let sendCount = 0;

    const result = await tryAdvanceWarmupAwaitingOnPick({
      supabase,
      ...baseInput,
      pickIdx: 0,
      nextIdx: 0,
    });

    assert.equal(result.advanced, false);
    assert.equal(result.readIdx, -1);
    assert.equal(result.reason, "pick_idx_mismatch");
    assert.equal(getIdx(), -1, "idx must stay -1");
    assert.equal(sendCount, 0);
    assert.deepEqual(sendLog, []);

    if (result.advanced) {
      sendCount += 1;
      await simulateSend("extra-0-should-not-happen", sendLog);
    }

    console.log("Test B sub-case (Q1 pending blocks extra pick): passed");
  }

  console.log("wa-warmup-awaiting-cas: all assertions passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
