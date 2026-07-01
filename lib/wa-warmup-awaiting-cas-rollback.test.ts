import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  tryAdvanceWarmupAwaitingOnPick,
  tryRollbackWarmupAwaitingIdx,
} from "@/lib/wa-warmup-awaiting-cas";

type MockContact = {
  id: string;
  business_id: number;
  phone: string;
  session_phase: string;
  warmup_extra_awaiting_idx: number;
  updated_at: string;
};

function createMockSupabase(initialIdx: number): {
  supabase: SupabaseClient;
  getIdx: () => number;
  setIdx: (idx: number) => void;
} {
  const row: MockContact = {
    id: "contact-1",
    business_id: 974,
    phone: "972501111111",
    session_phase: "warmup",
    warmup_extra_awaiting_idx: initialIdx,
    updated_at: new Date().toISOString(),
  };

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
          return buildReadChain({});
        },
        update(patch: Partial<MockContact>) {
          return buildUpdateChain(patch, {});
        },
      };
    },
  } as unknown as SupabaseClient;

  return {
    supabase,
    getIdx: () => row.warmup_extra_awaiting_idx,
    setIdx: (idx: number) => {
      row.warmup_extra_awaiting_idx = idx;
    },
  };
}

const baseInput = {
  businessId: 974,
  phone: "972501111111",
};

async function main() {
  // --- Rollback test 1: send fails → idx restored to readIdx ---
  {
    const { supabase, getIdx } = createMockSupabase(2);
    const advance = await tryAdvanceWarmupAwaitingOnPick({
      supabase,
      ...baseInput,
      pickIdx: 2,
      nextIdx: 3,
    });
    assert.equal(advance.advanced, true);
    assert.equal(getIdx(), 3);

    const rollback = await tryRollbackWarmupAwaitingIdx({
      supabase,
      ...baseInput,
      readIdx: advance.readIdx,
      nextIdx: advance.nextIdx,
      context: "test_send_failed",
    });

    assert.equal(rollback.rolledBack, true);
    assert.equal(getIdx(), 2, "idx must return to readIdx after rollback");
    console.log("Rollback test 1 (restore on send failure): passed");
  }

  // --- Rollback test 2: conditional — do not overwrite if another handler advanced ---
  {
    const { supabase, getIdx, setIdx } = createMockSupabase(2);
    const advanceA = await tryAdvanceWarmupAwaitingOnPick({
      supabase,
      ...baseInput,
      pickIdx: 2,
      nextIdx: 3,
    });
    assert.equal(advanceA.advanced, true);
    assert.equal(getIdx(), 3);

    setIdx(4);

    const rollback = await tryRollbackWarmupAwaitingIdx({
      supabase,
      ...baseInput,
      readIdx: advanceA.readIdx,
      nextIdx: advanceA.nextIdx,
      context: "test_stale_rollback",
    });

    assert.equal(rollback.rolledBack, false);
    assert.equal(rollback.reason, "rollback_lost_race");
    assert.equal(getIdx(), 4, "must not revert another handler's advance");
    console.log("Rollback test 2 (conditional no overwrite): passed");
  }

  console.log("wa-warmup-awaiting-cas-rollback: all assertions passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
