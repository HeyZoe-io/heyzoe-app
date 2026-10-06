import assert from "node:assert/strict";
import { ARBOX_CRM_NOTE_WRITES_ENABLED, submitArboxCrmEvent } from "@/lib/crm/adapters/arbox";
import { buildHumanRequestedContactPatch } from "@/lib/human-requested";
import { buildNotRelevantContactPatch } from "@/lib/not-relevant";
import { buildNoResponseContactPatch } from "@/lib/wa-no-response";

assert.equal(ARBOX_CRM_NOTE_WRITES_ENABLED, false);

const at = "2026-10-07T06:00:00.000Z";
assert.equal(buildHumanRequestedContactPatch(at).human_requested_at, at);
assert.equal(buildNoResponseContactPatch(at).wa_no_response_at, at);
assert.equal(buildNotRelevantContactPatch("מחיר", at).not_relevant_at, at);
assert.equal(buildNotRelevantContactPatch("מחיר", at).not_relevant_reason, "מחיר");

type Call = { url: string; method: string; body: string };
const calls: Call[] = [];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function query(result: { data: unknown; error: null }) {
  const self: Record<string, unknown> = {};
  for (const name of ["select", "eq", "in", "limit", "update", "order"]) {
    self[name] = () => self;
  }
  self.maybeSingle = async () => result;
  self.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return self;
}

(globalThis as { __hzSupabaseAdmin?: unknown }).__hzSupabaseAdmin = {
  from() {
    return query({ data: { arbox_user_id: "99" }, error: null });
  },
};

globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const href = String(url);
  const method = String(init?.method ?? "GET");
  calls.push({ url: href, method, body: typeof init?.body === "string" ? init.body : "" });
  if (href.includes("/v3/locations")) {
    return jsonResponse({ data: [{ location_id: 1, location_name: "Apex" }] });
  }
  if (href.includes("/v3/tasks")) {
    return jsonResponse({ data: [{ id: 1 }] });
  }
  if (href.includes("/v3/leads")) {
    return jsonResponse({ data: [{ user_id: "99", lead_id: "5" }] });
  }
  return jsonResponse({ data: [{ user_id: "99" }] });
}) as typeof fetch;

function noteWrites(): Call[] {
  return calls.filter((call) => call.url.includes("createNote"));
}

async function main() {
const idle = await submitArboxCrmEvent({
  businessId: 3445,
  apiKey: "test-key",
  boxId: "1",
  phone: "972501234567",
  fullName: "אליה כהן",
  noteText: "עברו 24 שעות והליד לא נרשם - יש ליצור קשר טלפוני",
  kind: "idle_no_response",
});
assert.equal(idle.ok, true);
assert.equal(noteWrites().length, 0);

calls.length = 0;
const human = await submitArboxCrmEvent({
  businessId: 3445,
  apiKey: "test-key",
  boxId: "1",
  phone: "972501234567",
  fullName: "אליה כהן",
  noteText: "🙋 זואי: הליד ביקש לדבר עם נציג",
  kind: "human_requested",
  humanRequestTaskTypeId: "7",
});
assert.equal(human.ok, true);
if (human.ok) assert.equal(human.createdHumanRequestTask, true);
assert.equal(noteWrites().length, 0);
assert.equal(calls.some((call) => call.method === "POST" && call.url.includes("/v3/tasks")), true);

calls.length = 0;
(globalThis as { __hzSupabaseAdmin?: { from: () => unknown } }).__hzSupabaseAdmin = {
  from() {
    return query({ data: { arbox_user_id: "" }, error: null });
  },
};
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const href = String(url);
  const method = String(init?.method ?? "GET");
  calls.push({ url: href, method, body: typeof init?.body === "string" ? init.body : "" });
  if (href.includes("/v3/locations")) {
    return jsonResponse({ data: [{ location_id: 1, location_name: "Apex" }] });
  }
  if (href.includes("searchUser")) return jsonResponse({ data: [] });
  if (href.includes("/v3/leads") && method === "POST") {
    return jsonResponse({ data: [{ user_id: "100", lead_id: "8" }] });
  }
  return jsonResponse({ data: [] });
}) as typeof fetch;

const created = await submitArboxCrmEvent({
  businessId: 3445,
  apiKey: "test-key",
  boxId: "1",
  phone: "972501234567",
  fullName: "ליד חדש",
  noteText: "זואי - נשלח טמפלייט פתיחה לליד",
  kind: "template_sent",
  leadCreationEnabled: true,
});
assert.equal(created.ok, true);
assert.equal(noteWrites().length, 0);
const leadPost = calls.find((call) => call.method === "POST" && call.url.endsWith("/v3/leads"));
assert.ok(leadPost);
assert.equal(JSON.parse(leadPost.body).comment, undefined);
}

main()
  .then(() => console.log("arbox-note-writes.test.ts: ok"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
