import { dualWriteSecret, type BusinessSecretField } from "@/lib/business-secrets";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { fieldEncryptionKey } from "@/lib/field-encryption";

export const SECRET_BACKFILL_BATCH = 100;

const FIELDS: BusinessSecretField[] = ["crm_api_key", "conversions_api_token", "leads_webhook_secret"];

export type SecretBackfillPlan = {
  patch: Record<string, string | null>;
  filled: BusinessSecretField[];
  legacyArbox: boolean;
};

export type SecretBackfillSummary = {
  skipped: boolean;
  crm_api_key: number;
  conversions_api_token: number;
  leads_webhook_secret: number;
  legacy_arbox_api_key: number;
};

function legacyArboxApiKey(social: unknown): string {
  if (!social || typeof social !== "object" || Array.isArray(social)) return "";
  const value = (social as Record<string, unknown>).arbox_api_key;
  return typeof value === "string" ? value.trim() : "";
}

/** Pure. Null when the row needs no write. Does not touch social_links. */
export function planSecretBackfill(row: Record<string, unknown>): SecretBackfillPlan | null {
  const id = row.id;
  if (id == null || String(id).trim() === "") return null;
  const patch: Record<string, string | null> = {};
  const filled: BusinessSecretField[] = [];
  let legacyArbox = false;

  for (const field of FIELDS) {
    const plain = String(row[field] ?? "").trim();
    const enc = String(row[`${field}_enc`] ?? "").trim();
    if (!plain || enc) continue;
    Object.assign(patch, dualWriteSecret(field, plain, id as string | number));
    if (patch[`${field}_enc`]) filled.push(field);
  }

  const plainKey = String(row.crm_api_key ?? "").trim();
  const keyEnc = String(row.crm_api_key_enc ?? "").trim();
  const legacy = legacyArboxApiKey(row.social_links);
  if (!plainKey && !keyEnc && legacy && !patch.crm_api_key_enc) {
    const legacyPatch = dualWriteSecret("crm_api_key", legacy, id as string | number);
    if (legacyPatch.crm_api_key_enc) {
      patch.crm_api_key_enc = legacyPatch.crm_api_key_enc;
      delete patch.crm_api_key;
      legacyArbox = true;
    }
  }

  if (!filled.length && !legacyArbox) return null;
  return { patch, filled, legacyArbox };
}

export function emptySecretBackfillSummary(skipped = false): SecretBackfillSummary {
  return {
    skipped,
    crm_api_key: 0,
    conversions_api_token: 0,
    leads_webhook_secret: 0,
    legacy_arbox_api_key: 0,
  };
}

const PENDING_OR = [
  "and(crm_api_key.not.is.null,crm_api_key_enc.is.null)",
  "and(conversions_api_token.not.is.null,conversions_api_token_enc.is.null)",
  "and(leads_webhook_secret.not.is.null,leads_webhook_secret_enc.is.null)",
].join(",");

export async function backfillBusinessSecrets(
  admin: ReturnType<typeof createSupabaseAdminClient>
): Promise<SecretBackfillSummary> {
  if (!fieldEncryptionKey()) return emptySecretBackfillSummary(true);

  const { data, error } = await admin
    .from("businesses")
    .select(
      "id, crm_api_key, crm_api_key_enc, conversions_api_token, conversions_api_token_enc, leads_webhook_secret, leads_webhook_secret_enc, social_links"
    )
    .or(PENDING_OR)
    .limit(SECRET_BACKFILL_BATCH);

  if (error) {
    console.error("[cron/arbox-trial-sync-cleanup] secret_backfill_failed", { error: error.message });
    return emptySecretBackfillSummary();
  }

  const summary = emptySecretBackfillSummary();
  for (const row of data ?? []) {
    const plan = planSecretBackfill(row as Record<string, unknown>);
    if (!plan) continue;
    const { error: upErr } = await admin.from("businesses").update(plan.patch).eq("id", row.id);
    if (upErr) {
      console.error("[cron/arbox-trial-sync-cleanup] secret_backfill_row_failed", {
        row_id: row.id,
        error: upErr.message,
      });
      continue;
    }
    for (const field of plan.filled) summary[field] += 1;
    if (plan.legacyArbox) summary.legacy_arbox_api_key += 1;
  }

  if ((data ?? []).length < SECRET_BACKFILL_BATCH) {
    return backfillLegacyArboxKeys(admin, summary);
  }
  return summary;
}

async function backfillLegacyArboxKeys(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  summary: SecretBackfillSummary
): Promise<SecretBackfillSummary> {
  const { data, error } = await admin
    .from("businesses")
    .select("id, crm_api_key, crm_api_key_enc, social_links")
    .is("crm_api_key", null)
    .is("crm_api_key_enc", null)
    .limit(SECRET_BACKFILL_BATCH);
  if (error) {
    console.error("[cron/arbox-trial-sync-cleanup] secret_backfill_legacy_failed", { error: error.message });
    return summary;
  }
  for (const row of data ?? []) {
    const plan = planSecretBackfill(row as Record<string, unknown>);
    if (!plan?.legacyArbox) continue;
    const { error: upErr } = await admin.from("businesses").update(plan.patch).eq("id", row.id);
    if (upErr) {
      console.error("[cron/arbox-trial-sync-cleanup] secret_backfill_row_failed", {
        row_id: row.id,
        error: upErr.message,
      });
      continue;
    }
    summary.legacy_arbox_api_key += 1;
  }
  return summary;
}
