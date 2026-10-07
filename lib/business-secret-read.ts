type SecretRow = Record<string, unknown> | null | undefined;

export type BusinessSecretField = "crm_api_key" | "conversions_api_token" | "leads_webhook_secret";

type SecretReader = (row: SecretRow, field: BusinessSecretField) => string;

let reader: SecretReader | null = null;

/** Installed by the server encryption module. Client bundles never load that module. */
export function registerBusinessSecretReader(next: SecretReader): void {
  reader = next;
}

function plainCell(row: SecretRow, field: BusinessSecretField): string {
  return String(row?.[field] ?? "").trim();
}

/**
 * Prefer the registered decrypt reader. Until it is installed, use the plaintext
 * column. That matches a missing encryption key: ciphertext is not preferred.
 */
export function readBusinessSecretFromRow(row: SecretRow, field: BusinessSecretField): string {
  if (reader) return reader(row, field);
  const enc = String(row?.[`${field}_enc`] ?? "").trim();
  const plain = plainCell(row, field);
  if (!enc && plain) {
    const id = row?.id == null ? null : String(row.id);
    console.info("[secret_plaintext_fallback]", { table: "businesses", column: field, row_id: id });
  }
  return plain;
}

export function getArboxApiKey(row: SecretRow): string {
  return readBusinessSecretFromRow(row, "crm_api_key");
}

export function getConversionsApiToken(row: SecretRow): string {
  return readBusinessSecretFromRow(row, "conversions_api_token");
}

export function getLeadsWebhookSecret(row: SecretRow): string {
  return readBusinessSecretFromRow(row, "leads_webhook_secret");
}
