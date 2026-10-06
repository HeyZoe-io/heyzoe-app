import assert from "node:assert/strict";
import { extractReplyRoute } from "@/lib/wa-reply-route";
import { resolveWhatsAppModelReply } from "@/lib/wa-model-fallback";
import { noteAiModelFailure } from "@/lib/wa-model-failure-alert";

type Row = {
  role: string;
  model_used: string;
  error_code: string;
  created_at: string;
  business_slug: string;
  session_id: string;
};

function billingError(): Error {
  return Object.assign(new Error("credit balance is too low to access the API"), { status: 400 });
}

function memoryAdmin(alerts: string[][]) {
  const rows: Row[] = [];
  const chain = (filters: Array<(row: Row) => boolean>) => {
    const next = {
      eq(column: string, value: unknown) {
        return chain([...filters, (row) => (row as unknown as Record<string, unknown>)[column] === value]);
      },
      gte(column: string, value: unknown) {
        return chain([
          ...filters,
          (row) => String((row as unknown as Record<string, unknown>)[column] ?? "") >= String(value),
        ]);
      },
      order() {
        return next;
      },
      limit() {
        const data = rows.filter((row) => filters.every((fn) => fn(row)));
        return Promise.resolve({ data, error: null });
      },
    };
    return next;
  };
  return {
    rows,
    from() {
      return {
        select() {
          return chain([]);
        },
        insert(row: Row) {
          rows.push({ ...row });
          return Promise.resolve({ error: null });
        },
      };
    },
    alerts,
  };
}

async function main() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ messages: [{ id: "wamid.test" }] }), { status: 200 });
  process.env.META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || "test-token";

  const billing = await resolveWhatsAppModelReply({
    runClaude: async () => {
      throw billingError();
    },
    runGemini: async () => ({
      text: "[[route:booking_change]]\nאפשר להחליף את השיעור באפליקציה.",
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 },
    }),
  });
  assert.equal(billing.ok, true);
  if (billing.ok) {
    assert.equal(billing.provider, "google");
    assert.equal(billing.billing, true);
    assert.equal(extractReplyRoute(billing.text).route, "booking_change");
  }

  const http401 = await resolveWhatsAppModelReply({
    runClaude: async () => {
      throw Object.assign(new Error("invalid x-api-key"), { status: 401 });
    },
    runGemini: async () => ({ text: "[[route:answer]]\nהיי", usageMetadata: null }),
  });
  assert.equal(http401.ok, true);
  if (http401.ok) assert.equal(http401.billing, false);

  const alerts: string[][] = [];
  const store = memoryAdmin(alerts);
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init && typeof init === "object" ? (init as RequestInit).body : "{}")) as {
      template?: { components?: Array<{ parameters?: Array<{ text?: string }> }> };
    };
    const params = body.template?.components?.[0]?.parameters?.map((p) => String(p.text ?? "")) ?? [];
    alerts.push(params);
    return new Response(JSON.stringify({ messages: [{ id: "wamid.test" }] }), { status: 200 });
  };

  const both = await resolveWhatsAppModelReply({
    runClaude: async () => {
      throw billingError();
    },
    runGemini: async () => {
      throw new Error("gemini down");
    },
  });
    assert.equal(both.ok, false);
  if (!both.ok) {
    assert.equal(both.errorType, "billing");
    const first = await noteAiModelFailure({ admin: store, errorType: both.errorType });
    assert.equal(first.alerted, true);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.[1], "billing");
    const second = await noteAiModelFailure({ admin: store, errorType: "billing" });
    assert.equal(second.alerted, false);
    assert.equal(alerts.length, 1);
  }

  globalThis.fetch = originalFetch;
  console.log("wa-model-fallback.test.ts: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
