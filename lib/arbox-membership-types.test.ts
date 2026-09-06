import assert from "node:assert/strict";
import {
  ARBOX_MEMBERSHIP_TYPES_PAGE_SIZE,
  buildArboxMembershipTypesPath,
  fetchAllArboxMembershipTypes,
  membershipTypeNameById,
  parseArboxMembershipTypeRows,
} from "@/lib/arbox-membership-types";

function fakeFetchResponse(input: {
  data: Record<string, unknown>[];
  nextPageUrl?: string | null;
  ok?: boolean;
  status?: number;
}): { ok: boolean; status: number; json: unknown; rawText: string } {
  const json = {
    data: input.data,
    extra: { pagination: { next_page_url: input.nextPageUrl ?? null } },
  };
  return {
    ok: input.ok ?? true,
    status: input.status ?? 200,
    json,
    rawText: JSON.stringify(json),
  };
}

function nRows(n: number, offset = 0): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    membership_type_id: offset + i + 1,
    membership_type_name: `type-${offset + i + 1}`,
  }));
}

{
  const p1 = buildArboxMembershipTypesPath();
  assert.match(p1, /\/v3\/membershipTypes\?/);
  assert.match(p1, /limit=500/);
  assert.doesNotMatch(p1, /[?&]page=/);

  const p2 = buildArboxMembershipTypesPath(2);
  assert.match(p2, /limit=500/);
  assert.match(p2, /[?&]page=2(?:&|$)/);
}

{
  const parsed = parseArboxMembershipTypeRows({
    data: [
      { membership_type_id: 442268, membership_type_name: "2 כניסות הכרות ב70 ש״ח" },
      { membership_type_id: 0, membership_type_name: "skip" },
      { membership_type_id: 9, membership_type_name: "  " },
    ],
  });
  assert.deepEqual(parsed, [
    { membership_type_id: 442268, membership_type_name: "2 כניסות הכרות ב70 ש״ח" },
    { membership_type_id: 9, membership_type_name: "9" },
  ]);
  const names = membershipTypeNameById(parsed);
  assert.equal(names.get(442268), "2 כניסות הכרות ב70 ש״ח");
  assert.equal(names.has(9), false);
}

async function main() {
  /** Apex-shaped: default 200-cap hid page-2 products; limit=500 returns them in one GET. */
  {
    const requested: string[] = [];
    const result = await fetchAllArboxMembershipTypes({
      apiKey: "k",
      logLabel: "test/membership-types",
      fetchPage: async (path) => {
        requested.push(path);
        return fakeFetchResponse({
          data: [
            ...nRows(199),
            {
              membership_type_id: 442268,
              membership_type_name: "2 כניסות הכרות ב70 ש״ח",
            },
          ],
        });
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(requested.length, 1);
    assert.match(requested[0]!, /limit=500/);
    assert.doesNotMatch(requested[0]!, /[?&]page=/);
    assert.equal(
      result.types.some((t) => t.membership_type_id === 442268),
      true
    );
  }

  /** Full page + next_page_url → ?page=2 on the original query, never the http URL. */
  {
    const requested: string[] = [];
    const httpNext = "http://arboxserver.arboxapp.com/api/public/v3/membershipTypes?page=2";
    const result = await fetchAllArboxMembershipTypes({
      apiKey: "k",
      logLabel: "test/membership-types",
      fetchPage: async (path) => {
        requested.push(path);
        if (requested.length === 1) {
          return fakeFetchResponse({
            data: nRows(ARBOX_MEMBERSHIP_TYPES_PAGE_SIZE),
            nextPageUrl: httpNext,
          });
        }
        return fakeFetchResponse({
          data: [
            {
              membership_type_id: 442268,
              membership_type_name: "2 כניסות הכרות ב70 ש״ח",
            },
          ],
        });
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(requested.length, 2);
    assert.equal(requested.includes(httpNext), false);
    assert.match(requested[1]!, /[?&]page=2(?:&|$)/);
    assert.equal(
      result.types.some((t) => t.membership_type_id === 442268 && t.membership_type_name.includes("70")),
      true
    );
    assert.equal(result.types.length, ARBOX_MEMBERSHIP_TYPES_PAGE_SIZE + 1);
  }
}

void main().then(() => {
  console.log("arbox-membership-types.test.ts: ok");
});
