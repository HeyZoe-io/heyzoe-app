import "./test-support/allow-server-only";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  decryptField,
  encryptField,
  fieldAad,
  resetFieldEncryptionStateForTests,
} from "./field-encryption";
import {
  businessSecretWritePatch,
  dualWriteSecret,
  getArboxApiKey,
  omitBusinessSecrets,
  readBusinessSecret,
  settingsSecretPatch,
} from "./business-secrets";
import { planSecretBackfill } from "./business-secret-backfill";

const testKey = randomBytes(32).toString("base64");

function applyTestKey() {
  process.env.FIELD_ENCRYPTION_KEY = testKey;
  resetFieldEncryptionStateForTests();
}

function clearKey() {
  delete process.env.FIELD_ENCRYPTION_KEY;
  resetFieldEncryptionStateForTests();
}

applyTestKey();

{
  const aad = fieldAad("crm_api_key", 42);
  const payload = encryptField("arbox-secret", aad);
  assert.ok(payload);
  assert.match(payload, /^v1:/);
  assert.equal(decryptField(payload, aad), "arbox-secret");
  assert.equal(decryptField(payload, fieldAad("crm_api_key", 43)), null);
  assert.equal(decryptField(payload, fieldAad("conversions_api_token", 42)), null);
  const [version, iv, tag, body] = payload.split(":");
  const badTag = Buffer.from(tag, "base64");
  badTag[0] = badTag[0] ^ 0xff;
  const tampered = `${version}:${iv}:${badTag.toString("base64")}:${body}`;
  assert.equal(decryptField(tampered, aad), null);
}

{
  const enc = encryptField("from-enc", fieldAad("crm_api_key", 7));
  const value = getArboxApiKey({ id: 7, crm_api_key: "from-plain", crm_api_key_enc: enc });
  assert.equal(value, "from-enc");
}

{
  const logs: unknown[] = [];
  const orig = console.info;
  console.info = (...args: unknown[]) => {
    logs.push(args);
  };
  try {
    assert.equal(getArboxApiKey({ id: 8, crm_api_key: "only-plain" }), "only-plain");
  } finally {
    console.info = orig;
  }
  assert.equal(logs.length, 1);
  assert.equal((logs[0] as unknown[])[0], "[secret_plaintext_fallback]");
  const detail = (logs[0] as unknown[])[1] as Record<string, unknown>;
  assert.equal(detail.table, "businesses");
  assert.equal(detail.column, "crm_api_key");
  assert.equal(detail.row_id, "8");
  assert.equal(JSON.stringify(detail).includes("only-plain"), false);
}

{
  clearKey();
  const errors: unknown[] = [];
  const origErr = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args[0]);
  };
  try {
    assert.equal(encryptField("x", fieldAad("crm_api_key", 1)), null);
    assert.equal(encryptField("y", fieldAad("crm_api_key", 1)), null);
    assert.equal(
      readBusinessSecret({ id: 1, crm_api_key: "plain", crm_api_key_enc: "v1:aa:bb:cc" }, "crm_api_key"),
      "plain"
    );
  } finally {
    console.error = origErr;
    applyTestKey();
  }
  assert.deepEqual(errors, ["[field_encryption_unavailable]"]);
}

{
  const patch = dualWriteSecret("conversions_api_token", "capi-token", 9);
  assert.equal(patch.conversions_api_token, "capi-token");
  assert.match(String(patch.conversions_api_token_enc), /^v1:/);
  assert.equal(
    readBusinessSecret(
      { id: 9, conversions_api_token: "stale", conversions_api_token_enc: patch.conversions_api_token_enc },
      "conversions_api_token"
    ),
    "capi-token"
  );
  const both = businessSecretWritePatch({ id: 9, crmApiKey: "k", conversionsApiToken: "t" });
  assert.equal(both.crm_api_key, "k");
  assert.match(String(both.crm_api_key_enc), /^v1:/);
  assert.equal(both.conversions_api_token, "t");
  assert.match(String(both.conversions_api_token_enc), /^v1:/);
}

{
  clearKey();
  const patch = dualWriteSecret("leads_webhook_secret", "whsec", 3);
  assert.equal(patch.leads_webhook_secret, "whsec");
  assert.equal(patch.leads_webhook_secret_enc, null);
  applyTestKey();
}

{
  const kept = settingsSecretPatch(
    { conversions_api_token: "", crm_api_key: "••••ab12" },
    { id: 9, crm_api_key: "stored-key", conversions_api_token: "stored-capi" }
  );
  assert.equal(kept.crm_api_key, "stored-key");
  assert.equal(kept.conversions_api_token, "stored-capi");
  assert.match(String(kept.crm_api_key_enc), /^v1:/);
  assert.match(String(kept.conversions_api_token_enc), /^v1:/);
}

{
  const enc = encryptField("already", fieldAad("crm_api_key", 4));
  assert.equal(planSecretBackfill({ id: 4, crm_api_key: "already", crm_api_key_enc: enc }), null);
  const first = planSecretBackfill({ id: 4, crm_api_key: "already", crm_api_key_enc: null });
  assert.ok(first);
  assert.deepEqual(first.filled, ["crm_api_key"]);
  assert.equal(first.legacyArbox, false);
  assert.equal(first.patch.crm_api_key, "already");
  assert.match(String(first.patch.crm_api_key_enc), /^v1:/);
  const again = planSecretBackfill({
    id: 4,
    crm_api_key: "already",
    crm_api_key_enc: first.patch.crm_api_key_enc,
  });
  assert.equal(again, null);
}

{
  const legacy = planSecretBackfill({
    id: 5,
    crm_api_key: null,
    crm_api_key_enc: null,
    social_links: { arbox_api_key: "legacy-key", welcome_intro: "hi" },
  });
  assert.ok(legacy);
  assert.equal(legacy.legacyArbox, true);
  assert.equal("crm_api_key" in legacy.patch, false);
  assert.match(String(legacy.patch.crm_api_key_enc), /^v1:/);
  assert.equal(decryptField(String(legacy.patch.crm_api_key_enc), fieldAad("crm_api_key", 5)), "legacy-key");
  assert.equal(JSON.stringify(legacy.patch).includes("welcome_intro"), false);
  assert.equal(
    planSecretBackfill({
      id: 5,
      crm_api_key: null,
      crm_api_key_enc: legacy.patch.crm_api_key_enc,
      social_links: { arbox_api_key: "legacy-key" },
    }),
    null
  );
}

{
  const row = {
    id: 1,
    slug: "demo",
    crm_api_key: "k",
    crm_api_key_enc: "v1:x",
    conversions_api_token: "c",
    conversions_api_token_enc: "v1:y",
    leads_webhook_secret: "s",
    leads_webhook_secret_enc: "v1:z",
    name: "Demo",
  };
  const safe = omitBusinessSecrets(row);
  const json = JSON.stringify(safe);
  assert.equal(json.includes("crm_api_key"), false);
  assert.equal(json.includes("conversions_api_token"), false);
  assert.equal(json.includes("leads_webhook_secret"), false);
  assert.equal(json.includes('"k"'), false);
  assert.equal(safe.name, "Demo");
}

console.log("field-encryption.test.ts ok");
