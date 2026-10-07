import "server-only";
import { registerBusinessSecretReader } from "@/lib/business-secret-read";
import { resolveStoredCrmApiKey } from "@/lib/crm/crm-api-key-mask";
import { decryptField, encryptField, fieldAad, fieldEncryptionKey } from "@/lib/field-encryption";

export const BUSINESS_SECRET_FIELDS = [
  "crm_api_key",
  "conversions_api_token",
  "leads_webhook_secret",
] as const;

export type BusinessSecretField = (typeof BUSINESS_SECRET_FIELDS)[number];

const CLIENT_OMIT = [
  "crm_api_key",
  "crm_api_key_enc",
  "conversions_api_token",
  "conversions_api_token_enc",
  "leads_webhook_secret",
  "leads_webhook_secret_enc",
] as const;

type SecretRow = Record<string, unknown> | null | undefined;

function encField(field: BusinessSecretField): string {
  return `${field}_enc`;
}

function cell(row: SecretRow, key: string): string {
  return String(row?.[key] ?? "").trim();
}

function rowId(row: SecretRow): string {
  const id = row?.id;
  if (id == null) return "";
  return String(id).trim();
}

/**
 * Prefer ciphertext. Plaintext is used when there is no ciphertext, the key is
 * unavailable, or decryption fails. Never logs the secret.
 */
export function readBusinessSecret(row: SecretRow, field: BusinessSecretField): string {
  const id = rowId(row);
  const enc = cell(row, encField(field));
  const plain = cell(row, field);
  if (enc) {
    if (!fieldEncryptionKey()) return plain;
    const opened = decryptField(enc, fieldAad(field, id));
    if (opened != null) return opened;
    console.error("[field_decrypt_failed]", { table: "businesses", column: field, row_id: id || null });
    return plain;
  }
  if (plain) {
    console.info("[secret_plaintext_fallback]", { table: "businesses", column: field, row_id: id || null });
  }
  return plain;
}

registerBusinessSecretReader(readBusinessSecret);

export function getArboxApiKey(row: SecretRow): string {
  return readBusinessSecret(row, "crm_api_key");
}

export function getConversionsApiToken(row: SecretRow): string {
  return readBusinessSecret(row, "conversions_api_token");
}

export function getLeadsWebhookSecret(row: SecretRow): string {
  return readBusinessSecret(row, "leads_webhook_secret");
}

/** Same update writes plaintext and ciphertext. No key → plaintext only and ciphertext cleared. */
export function dualWriteSecret(
  field: BusinessSecretField,
  value: string | null,
  rowIdValue: string | number
): Record<string, string | null> {
  const trimmed = String(value ?? "").trim();
  const enc = encField(field);
  if (!trimmed) return { [field]: null, [enc]: null };
  const ciphertext = encryptField(trimmed, fieldAad(field, rowIdValue));
  if (!ciphertext) return { [field]: trimmed, [enc]: null };
  return { [field]: trimmed, [enc]: ciphertext };
}

/** Settings save. Leads webhook secret is not part of this form. */
export function businessSecretWritePatch(input: {
  id: string | number | null;
  crmApiKey: string | null;
  conversionsApiToken: string | null;
}): Record<string, string | null> {
  if (input.id == null || String(input.id).trim() === "") {
    return {
      crm_api_key: input.crmApiKey?.trim() || null,
      conversions_api_token: input.conversionsApiToken?.trim() || null,
    };
  }
  return {
    ...dualWriteSecret("crm_api_key", input.crmApiKey, input.id),
    ...dualWriteSecret("conversions_api_token", input.conversionsApiToken, input.id),
  };
}

/**
 * Settings body. An empty conversions token keeps the stored value.
 * A mask or empty Arbox key keeps the stored key.
 */
export function settingsSecretPatch(
  body: { crm_api_key?: unknown; conversions_api_token?: unknown },
  existing: Record<string, unknown> | null
): Record<string, string | null> {
  const row = existing;
  const previousCrm = existing ? getArboxApiKey(row) : "";
  const previousCapi = existing ? getConversionsApiToken(row) : "";
  const id = existing?.id;
  return businessSecretWritePatch({
    id: id == null || String(id).trim() === "" ? null : (id as string | number),
    crmApiKey: resolveStoredCrmApiKey(body.crm_api_key, previousCrm),
    conversionsApiToken: resolveKeptSecret(body.conversions_api_token, previousCapi),
  });
}

/** Empty incoming keeps the stored value. A non-empty value replaces it. */
export function resolveKeptSecret(incoming: unknown, previous: string | null | undefined): string | null {
  const prev = String(previous ?? "").trim();
  if (incoming === undefined || incoming === null) return prev || null;
  if (!String(incoming).trim()) return prev || null;
  return String(incoming).trim();
}

export function omitBusinessSecrets<T extends Record<string, unknown>>(row: T): T {
  const copy = { ...row };
  for (const key of CLIENT_OMIT) delete copy[key];
  return copy;
}
