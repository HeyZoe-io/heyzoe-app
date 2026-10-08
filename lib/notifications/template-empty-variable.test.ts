import assert from "node:assert/strict";
import { EMPTY_VARIABLE_ERROR, emptyTemplateVariable } from "./template-empty-variable";

const body = (...texts: string[]) => [{ type: "body", parameters: texts.map((text) => ({ type: "text", text })) }];

async function main() {
  // meeting_day without a call time: "" (old «בשעה {{2}}» body) or " " (MARKETING_CALL_TIME_OMIT).
  assert.equal(emptyTemplateVariable(body("Mor", "")), "body {{2}}");
  assert.equal(emptyTemplateVariable(body("Raz", " ")), "body {{2}}");
  assert.equal(emptyTemplateVariable(body("", "בשעה 13:30")), "body {{1}}");
  assert.equal(emptyTemplateVariable([{ type: "header", parameters: [{ type: "text", text: "\n" }] }]), "header {{1}}");

  // Filled, including the name / emoji / dash fallbacks.
  assert.equal(emptyTemplateVariable(body("Mor", "בשעה 13:30")), null);
  assert.equal(emptyTemplateVariable(body("שלום", "😊")), null);
  assert.equal(emptyTemplateVariable(body("דנה", "—")), null);
  assert.equal(emptyTemplateVariable(undefined), null);
  assert.equal(emptyTemplateVariable([]), null);

  // The lowest-level business send stops before Graph and returns empty_variable.
  process.env.META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || "test-token";
  const graphCalls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const href = String(url instanceof Request ? url.url : url);
    if (href.includes("graph.facebook.com")) graphCalls.push(href);
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const { sendBusinessTemplate } = await import("./sendOwnerNotification");
    const result = await sendBusinessTemplate({
      to: "972547237470",
      phoneNumberId: "1179786855208358",
      templateName: "meeting_day",
      skipOptOutGate: true,
      components: body("Mor", " ") as never,
    });
    assert.deepEqual(result, { ok: false, error: EMPTY_VARIABLE_ERROR });
    assert.equal(graphCalls.length, 0);
  } finally {
    globalThis.fetch = original;
  }

  console.log("template-empty-variable.test.ts ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
