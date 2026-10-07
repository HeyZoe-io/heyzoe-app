import assert from "node:assert/strict";
import {
  PUBLIC_SOCIAL_LINK_KEYS,
  buildConfiguredPublicBusinessResponse,
  publicBusinessDataFromRow,
} from "./public-business-response";

const LEAKS = [
  "LEAK_ARBOX_API_KEY_9f3a",
  "LEAK_CRM_KEY_9f3a",
  "LEAK_TOKEN_9f3a",
  "LEAK_SECRET_9f3a",
  "LEAK_NESTED_TASK_9f3a",
  "LEAK_INSTAGRAM_9f3a",
  "LEAK_DIRECTIONS_9f3a",
  "LEAK_OPTION_OBJECT_9f3a",
];

const social_links = {
  welcome_intro: "היי, אני זואי",
  welcome_question: "במה לעזור?",
  welcome_options: ["מה המחיר?", { arbox_api_key: "LEAK_OPTION_OBJECT_9f3a" }, "איפה אתם"],
  arbox_api_key: "LEAK_ARBOX_API_KEY_9f3a",
  crm_api_key: "LEAK_CRM_KEY_9f3a",
  access_token: "LEAK_TOKEN_9f3a",
  webhook_secret: "LEAK_SECRET_9f3a",
  instagram: "LEAK_INSTAGRAM_9f3a",
  directions: "LEAK_DIRECTIONS_9f3a",
  sales_flow: { arbox_trial_task_type_id: "LEAK_NESTED_TASK_9f3a" },
};

const data = publicBusinessDataFromRow({
  slug: "demo",
  name: "דמו",
  niche: "פילאטיס",
  logo_url: null,
  welcome_message: "טקסט שמור",
  bot_name: "זואי",
  primary_color: "#ff85cf",
  secondary_color: "#bc74e9",
  cta_text: "לתיאום",
  cta_link: "https://example.com/book",
  social_links,
  service_name: "פילאטיס",
  service_location: "תל אביב",
});

function keysOf(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      found.push(key);
      keysOf(child, found);
    }
  }
  return found;
}

for (const variant of ["full", "quick"] as const) {
  const response = buildConfiguredPublicBusinessResponse(data, { variant, requestSlug: "demo" });
  const json = JSON.stringify(response);
  const keys = keysOf(response);

  assert.equal(json.includes("social_links"), false);
  for (const leak of LEAKS) {
    assert.equal(json.includes(leak), false, `${variant} leaked ${leak}`);
  }
  for (const key of keys) {
    assert.equal(/(^|_)(key|token|secret)$/i.test(key), false, `${variant} key ${key}`);
    assert.equal(PUBLIC_SOCIAL_LINK_KEYS.includes(key as (typeof PUBLIC_SOCIAL_LINK_KEYS)[number]), false);
    assert.equal(
      ["arbox_api_key", "instagram", "directions", "sales_flow", "welcome_intro"].includes(key),
      false
    );
  }
  assert.match(String(response.welcome), /היי, אני זואי/);
  assert.match(String(response.welcome), /במה לעזור/);
  assert.deepEqual(response.followups, ["מה המחיר?", "איפה אתם"]);
}

const full = buildConfiguredPublicBusinessResponse(data, { variant: "full", requestSlug: "Demo." });
assert.equal(full.slug, "Demo.");
assert.equal(full.tone, null);
const quick = buildConfiguredPublicBusinessResponse(data, { variant: "quick", requestSlug: "Demo." });
assert.equal(quick.slug, "demo");
assert.equal("tone" in quick, false);

console.log("public-business-response.test.ts ok");
