import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/phone-normalize";

const META_ADS_GRAPH_VERSION = "v21.0";

export type MetaAudienceBucket = "relevant" | "excluded";

type SyncContactToMetaAudienceInput = {
  phone: string;
  status: string;
};

type SyncContactToMetaAudienceResult = {
  ok: boolean;
  error?: string;
  bucket?: MetaAudienceBucket | null;
  skipped?: boolean;
};

function resolveMetaAdsAccessToken(): string {
  return process.env.META_ADS_ACCESS_TOKEN?.trim() ?? "";
}

function resolveMetaAudienceIdRelevant(): string {
  return process.env.META_AUDIENCE_ID_RELEVANT?.trim() ?? "";
}

function resolveMetaAudienceIdExcluded(): string {
  return process.env.META_AUDIENCE_ID_EXCLUDED?.trim() ?? "";
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input.trim().toLowerCase(), "utf8").digest("hex");
}

/**
 * Digits Meta hashes: E.164 without +. Prefer normalizePhone (050… → 9725…).
 * Falls back to digits-only strip only if normalizePhone rejects the input.
 */
function phoneDigitsForMetaHash(phone: string): string {
  const normalized = normalizePhone(phone);
  if (normalized) return normalized;
  return String(phone ?? "").replace(/\D/g, "");
}

function isMetaAudienceBucket(v: unknown): v is MetaAudienceBucket {
  return v === "relevant" || v === "excluded";
}

/**
 * Maps CRM status → Meta audience bucket.
 * in_process / no_response / requires_call (and anything else) → null (no Meta action).
 */
export function metaAudienceBucketForStatus(status: string): MetaAudienceBucket | null {
  if (status === "registered" || status === "not_interested") return "relevant";
  if (status === "not_relevant") return "excluded";
  return null;
}

function audienceIdForBucket(bucket: MetaAudienceBucket): string {
  return bucket === "relevant"
    ? resolveMetaAudienceIdRelevant()
    : resolveMetaAudienceIdExcluded();
}

function otherBucket(bucket: MetaAudienceBucket): MetaAudienceBucket {
  return bucket === "relevant" ? "excluded" : "relevant";
}

/**
 * Meta Custom Audience /users body.
 * Docs wrap schema+data in `payload`. Nested object + JSON body works in practice
 * (same pattern as meta-capi). If Meta returns 400 "Missing schema attribute in
 * payloads", switch to: JSON.stringify({ payload: JSON.stringify({ schema, data }) }).
 */
function buildUsersPayload(phoneHash: string): { payload: { schema: string[]; data: string[][] } } {
  return {
    payload: {
      schema: ["PHONE"],
      data: [[phoneHash]],
    },
  };
}

export type MetaAudienceUsersResult = {
  ok: boolean;
  error?: string;
  httpStatus?: number;
  /** Full Graph API JSON body (num_received / num_invalid_entries / session_id / error). */
  body?: unknown;
};

async function mutateAudienceUsers(opts: {
  method: "POST" | "DELETE";
  audienceId: string;
  accessToken: string;
  phoneHash: string;
}): Promise<MetaAudienceUsersResult> {
  const { method, audienceId, accessToken, phoneHash } = opts;
  const url = `https://graph.facebook.com/${META_ADS_GRAPH_VERSION}/${encodeURIComponent(audienceId)}/users?access_token=${encodeURIComponent(accessToken)}`;
  const body = buildUsersPayload(phoneHash);

  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const rawText = await res.text().catch(() => "");
    let parsed: unknown = rawText;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      // keep raw text
    }
    if (!res.ok) {
      console.error(
        `[meta-audiences] ${method} audience ${audienceId} failed:`,
        res.status,
        rawText
      );
      return {
        ok: false,
        error: rawText || `http_${res.status}`,
        httpStatus: res.status,
        body: parsed,
      };
    }
    return { ok: true, httpStatus: res.status, body: parsed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[meta-audiences] ${method} audience ${audienceId} threw:`, msg);
    return { ok: false, error: msg };
  }
}

/**
 * Low-level add/remove for one audience (used by write-check scripts).
 * Never throws; never logs the access token.
 */
export async function callMetaAudienceUsers(opts: {
  method: "POST" | "DELETE";
  audience: MetaAudienceBucket;
  phone: string;
}): Promise<MetaAudienceUsersResult> {
  const accessToken = resolveMetaAdsAccessToken();
  const audienceId = audienceIdForBucket(opts.audience);
  if (!accessToken || !audienceId) {
    return { ok: false, error: "missing_meta_ads_credentials" };
  }
  const phoneDigits = phoneDigitsForMetaHash(opts.phone);
  if (!phoneDigits) {
    return { ok: false, error: "missing_phone" };
  }
  return mutateAudienceUsers({
    method: opts.method,
    audienceId,
    accessToken,
    phoneHash: sha256Hex(phoneDigits),
  });
}

async function readSyncedAs(phone: string): Promise<MetaAudienceBucket | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("marketing_conversation_notes")
      .select("meta_audience_synced_as")
      .eq("phone", phone)
      .maybeSingle();
    if (error) {
      console.error("[meta-audiences] read meta_audience_synced_as failed:", error.message);
      return null;
    }
    return isMetaAudienceBucket(data?.meta_audience_synced_as)
      ? data.meta_audience_synced_as
      : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[meta-audiences] read meta_audience_synced_as threw:", msg);
    return null;
  }
}

async function writeSyncedAs(phone: string, bucket: MetaAudienceBucket): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("marketing_conversation_notes")
      .update({ meta_audience_synced_as: bucket })
      .eq("phone", phone);
    if (error) {
      console.error("[meta-audiences] write meta_audience_synced_as failed:", error.message);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[meta-audiences] write meta_audience_synced_as threw:", msg);
  }
}

/**
 * Sync a marketing lead phone into the correct Meta Custom Audience bucket.
 * - registered / not_interested → add RELEVANT, remove EXCLUDED
 * - not_relevant → add EXCLUDED, remove RELEVANT
 * - other statuses → no Meta calls; leave meta_audience_synced_as unchanged
 * - Idempotent via marketing_conversation_notes.meta_audience_synced_as
 *
 * Bucket column is updated only when ADD succeeds. A failed REMOVE is logged
 * only — stale other-audience membership is low-harm and is NOT guaranteed to
 * retry on the next same-bucket status change (idempotency may skip).
 * Never throws.
 */
export async function syncContactToMetaAudience(
  input: SyncContactToMetaAudienceInput
): Promise<SyncContactToMetaAudienceResult> {
  const bucket = metaAudienceBucketForStatus(input.status);
  if (!bucket) {
    // No Meta action for in_process / no_response / requires_call / etc.
    // Do not clear meta_audience_synced_as — leave prior audience membership as-is.
    return { ok: true, bucket: null };
  }

  const phoneDigits = phoneDigitsForMetaHash(input.phone);
  if (!phoneDigits) {
    return { ok: false, error: "missing_phone" };
  }

  const current = await readSyncedAs(phoneDigits);
  if (current === bucket) {
    return { ok: true, bucket, skipped: true };
  }

  const accessToken = resolveMetaAdsAccessToken();
  const relevantId = resolveMetaAudienceIdRelevant();
  const excludedId = resolveMetaAudienceIdExcluded();
  if (!accessToken || !relevantId || !excludedId) {
    console.error("[meta-audiences] missing credentials or audience ids");
    return { ok: false, error: "missing_meta_ads_credentials" };
  }

  const phoneHash = sha256Hex(phoneDigits);
  const addId = audienceIdForBucket(bucket);
  const removeId = audienceIdForBucket(otherBucket(bucket));

  const addResult = await mutateAudienceUsers({
    method: "POST",
    audienceId: addId,
    accessToken,
    phoneHash,
  });
  if (!addResult.ok) {
    // Do not update meta_audience_synced_as — retry on next status save.
    return { ok: false, error: addResult.error, bucket };
  }

  // Best-effort remove from the other audience. Failure is logged only; we still
  // persist the new bucket because ADD is the source of truth. A later same-bucket
  // save will skip via idempotency and will not re-attempt this DELETE.
  const removeResult = await mutateAudienceUsers({
    method: "DELETE",
    audienceId: removeId,
    accessToken,
    phoneHash,
  });
  if (!removeResult.ok) {
    console.error(
      "[meta-audiences] remove from other audience failed (bucket still saved):",
      removeResult.error
    );
  }

  await writeSyncedAs(phoneDigits, bucket);
  return { ok: true, bucket };
}
