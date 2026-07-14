import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  acquireContactProcessingLock,
  CONTACT_PROCESSING_LOCK_TTL_SECONDS,
  releaseContactProcessingLock,
} from "@/lib/wa-contact-processing-lock";

type MockContact = {
  id: string;
  processing_claimed_until: string | null;
};

/** In-memory mock with real CAS semantics on processing_claimed_until. */
function createMockSupabase(initialClaimedUntil: string | null = null) {
  const row: MockContact = {
    id: "contact-2815",
    processing_claimed_until: initialClaimedUntil,
  };

  type UpdateFilters = {
    id?: string;
    claimedUntilEq?: string;
  };

  function isExpired(iso: string | null, nowIso: string): boolean {
    if (!iso) return true;
    return iso < nowIso;
  }

  let updateChain = Promise.resolve();

  function buildUpdateChain(filters: UpdateFilters, patch: Partial<MockContact>) {
    const chain = {
      eq(col: string, val: unknown) {
        if (col === "id") filters.id = String(val);
        if (col === "processing_claimed_until") filters.claimedUntilEq = String(val);
        return chain;
      },
      or(_expr: string) {
        return chain;
      },
      select(_cols: string) {
        const run = async () => {
          const nowIso = new Date().toISOString();
          if (filters.id !== row.id) {
            return { data: [] as { id: string }[], error: null };
          }
          const canAcquire =
            row.processing_claimed_until === null ||
            isExpired(row.processing_claimed_until, nowIso);
          if (!canAcquire) {
            return { data: [] as { id: string }[], error: null };
          }
          if (patch.processing_claimed_until !== undefined) {
            row.processing_claimed_until = patch.processing_claimed_until;
          }
          return { data: [{ id: row.id }], error: null };
        };
        const p = updateChain.then(run);
        updateChain = p.then(() => undefined);
        return p;
      },
    };
    return chain;
  }

  const supabase = {
    from(table: string) {
      assert.equal(table, "contacts");
      return {
        update(patch: Partial<MockContact>) {
          const filters: UpdateFilters = {};
          const chain = buildUpdateChain(filters, patch);
          return {
            eq(col: string, val: unknown) {
              if (col === "id") filters.id = String(val);
              if (col === "processing_claimed_until") filters.claimedUntilEq = String(val);
              return chain;
            },
            or(expr: string) {
              return buildUpdateChain(filters, patch);
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  return { supabase, row };
}

function createReleaseMock(row: MockContact) {
  return {
    from(table: string) {
      assert.equal(table, "contacts");
      return {
        update(patch: Partial<MockContact>) {
          const filters: { id?: string; claimedUntil?: string } = {};
          return {
            eq(col: string, val: unknown) {
              if (col === "id") filters.id = String(val);
              if (col === "processing_claimed_until") filters.claimedUntil = String(val);
              return {
                eq(col2: string, val2: unknown) {
                  if (col2 === "processing_claimed_until") filters.claimedUntil = String(val2);
                  return Promise.resolve(
                    (() => {
                      if (
                        filters.id === row.id &&
                        filters.claimedUntil === row.processing_claimed_until
                      ) {
                        row.processing_claimed_until = patch.processing_claimed_until ?? null;
                      }
                      return { error: null };
                    })()
                  );
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

async function testParallelAcquireOneWins() {
  const { supabase, row } = createMockSupabase(null);
  const [a, b] = await Promise.all([
    acquireContactProcessingLock("contact-2815", CONTACT_PROCESSING_LOCK_TTL_SECONDS, supabase),
    acquireContactProcessingLock("contact-2815", CONTACT_PROCESSING_LOCK_TTL_SECONDS, supabase),
  ]);
  const winners = [a, b].filter((r) => r.acquired);
  assert.equal(winners.length, 1, "exactly one handler should acquire");
  assert.ok(winners[0]!.claimedUntil);
  assert.equal(row.processing_claimed_until, winners[0]!.claimedUntil);
  const loser = a.acquired ? b : a;
  assert.equal(loser.acquired, false);
  assert.equal(loser.claimedUntil, null);
  console.log("✓ parallel acquire: one true, one false");
}

async function testReleaseExactMatchOnly() {
  const { supabase, row } = createMockSupabase(null);
  const first = await acquireContactProcessingLock(
    "contact-2815",
    CONTACT_PROCESSING_LOCK_TTL_SECONDS,
    supabase
  );
  assert.equal(first.acquired, true);
  const claim = first.claimedUntil!;

  await releaseContactProcessingLock("contact-2815", claim, createReleaseMock(row));
  assert.equal(row.processing_claimed_until, null);

  const second = await acquireContactProcessingLock(
    "contact-2815",
    CONTACT_PROCESSING_LOCK_TTL_SECONDS,
    supabase
  );
  assert.equal(second.acquired, true);
  console.log("✓ release clears lock with exact claimedUntil match");
}

async function testTwoMessagesBothLoggedBeforeAcquire() {
  /**
   * Simulates two inbound handlers for the same contact:
   * both log user messages, only one acquires — mirrors webhook ordering.
   */
  const userMessages: string[] = [];
  const assistantReplies: string[] = [];
  const { supabase, row } = createMockSupabase(null);

  async function simulateInboundHandler(text: string) {
    userMessages.push(text);
    const lock = await acquireContactProcessingLock(
      "contact-2815",
      CONTACT_PROCESSING_LOCK_TTL_SECONDS,
      supabase
    );
    if (!lock.acquired) return { replied: false };
    try {
      assistantReplies.push(userMessages.join(" | "));
      return { replied: true };
    } finally {
      if (lock.claimedUntil) {
        await releaseContactProcessingLock(
          "contact-2815",
          lock.claimedUntil,
          createReleaseMock(row)
        );
      }
    }
  }

  const [r1, r2] = await Promise.all([
    simulateInboundHandler("שאלת לו״ז"),
    simulateInboundHandler("שאלת חניון"),
  ]);
  assert.equal(userMessages.length, 2);
  assert.equal([r1.replied, r2.replied].filter(Boolean).length, 1);
  assert.equal(assistantReplies.length, 1);
  assert.ok(assistantReplies[0]!.includes("שאלת לו״ז"));
  assert.ok(assistantReplies[0]!.includes("שאלת חניון"));
  console.log("✓ two user messages logged; single reply covers both");
}

async function testTtlConstant() {
  assert.equal(CONTACT_PROCESSING_LOCK_TTL_SECONDS, 60);
  console.log("✓ TTL is 60s");
}

async function main() {
  await testParallelAcquireOneWins();
  await testReleaseExactMatchOnly();
  await testTwoMessagesBothLoggedBeforeAcquire();
  await testTtlConstant();
  console.log("\nAll wa-contact-processing-lock tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
