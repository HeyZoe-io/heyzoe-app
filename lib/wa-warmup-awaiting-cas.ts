/**
 * PR2: atomic CAS on contacts.warmup_extra_awaiting_idx.
 * -2 off; -1 Q1 pending; 0+ extra k awaiting answer.
 *
 * CRITICAL: the value read from DB is passed verbatim to UPDATE ... WHERE
 * warmup_extra_awaiting_idx = readIdx — no recomputation between read and CAS.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { contactPhoneLookupVariants } from "@/lib/phone-normalize";
import { WARMUP_EXTRA_AWAITING_OFF } from "@/lib/wa-warmup-awaiting-idx";

export { WARMUP_EXTRA_AWAITING_OFF };

export type WarmupAwaitingIdxRead = {
  contactId: string;
  /** Exact value from DB at read time — this is the CAS expected value. */
  readIdx: number;
};

export type TryAdvanceWarmupAwaitingResult =
  | { advanced: true; readIdx: number; nextIdx: number }
  | { advanced: false; readIdx: number | null; reason: string };

type ContactRow = { id: string; warmup_extra_awaiting_idx: number };

function resolvePhoneVariants(phone: string, phoneVariants?: string[]): string[] {
  const variants = phoneVariants?.length ? phoneVariants : contactPhoneLookupVariants(phone);
  return variants.length ? variants : [phone];
}

function resolveBusinessId(businessId: number | string): number | string {
  const n = Number(businessId);
  return Number.isFinite(n) ? n : businessId;
}

/** Fresh read — not a handler snapshot. */
export async function readWarmupExtraAwaitingIdx(input: {
  supabase: SupabaseClient;
  businessId: number | string;
  phone: string;
  phoneVariants?: string[];
}): Promise<WarmupAwaitingIdxRead | null> {
  const phoneVariants = resolvePhoneVariants(input.phone, input.phoneVariants);
  const businessId = resolveBusinessId(input.businessId);
  const { data, error } = await input.supabase
    .from("contacts")
    .select("id, warmup_extra_awaiting_idx")
    .eq("business_id", businessId)
    .eq("session_phase", "warmup")
    .in("phone", phoneVariants)
    .maybeSingle();
  if (error) {
    console.error("[wa-warmup-awaiting-cas] read failed:", error.message);
    return null;
  }
  const row = data as ContactRow | null;
  if (!row?.id) return null;
  const readIdx = Number(row.warmup_extra_awaiting_idx);
  if (!Number.isFinite(readIdx)) return null;
  return { contactId: String(row.id), readIdx };
}

/**
 * Read idx from DB, optionally validate pick / required current, then CAS.
 * WHERE warmup_extra_awaiting_idx = readIdx uses the SAME readIdx variable — no intermediate expected.
 */
export async function tryAdvanceWarmupAwaitingIdx(input: {
  supabase: SupabaseClient;
  businessId: number | string;
  phone: string;
  phoneVariants?: string[];
  nextIdx: number;
  /** If set, pick index must equal freshly read idx (response path). */
  pickIdx?: number | null;
  /** If set, freshly read idx must equal this before CAS (proactive path guard). */
  requireReadIdx?: number | null;
}): Promise<TryAdvanceWarmupAwaitingResult> {
  const read = await readWarmupExtraAwaitingIdx(input);
  if (!read) {
    return { advanced: false, readIdx: null, reason: "read_failed" };
  }

  const { readIdx } = read;

  if (input.requireReadIdx != null && readIdx !== input.requireReadIdx) {
    return { advanced: false, readIdx, reason: "require_read_idx_mismatch" };
  }

  if (input.pickIdx != null && input.pickIdx !== readIdx) {
    return { advanced: false, readIdx, reason: "pick_idx_mismatch" };
  }

  const nextIdx = Math.trunc(input.nextIdx);
  if (!Number.isFinite(nextIdx)) {
    return { advanced: false, readIdx, reason: "invalid_next_idx" };
  }

  const phoneVariants = resolvePhoneVariants(input.phone, input.phoneVariants);
  const businessId = resolveBusinessId(input.businessId);
  const { data, error } = await input.supabase
    .from("contacts")
    .update({
      warmup_extra_awaiting_idx: nextIdx,
      updated_at: new Date().toISOString(),
    })
    .eq("business_id", businessId)
    .eq("session_phase", "warmup")
    .eq("warmup_extra_awaiting_idx", readIdx)
    .in("phone", phoneVariants)
    .select("id");

  if (error) {
    console.error("[wa-warmup-awaiting-cas] CAS update failed:", error.message);
    return { advanced: false, readIdx, reason: "cas_update_failed" };
  }

  if (!data?.length) {
    return { advanced: false, readIdx, reason: "cas_lost_race" };
  }

  return { advanced: true, readIdx, nextIdx };
}

/** Proactive: claim send only when DB is exactly requireReadIdx (typically -2). */
export async function tryClaimWarmupAwaitingSend(input: {
  supabase: SupabaseClient;
  businessId: number | string;
  phone: string;
  phoneVariants?: string[];
  requireReadIdx: number;
  nextIdx: number;
}): Promise<TryAdvanceWarmupAwaitingResult> {
  return tryAdvanceWarmupAwaitingIdx({
    ...input,
    requireReadIdx: input.requireReadIdx,
  });
}

/** Response path: pick must match freshly read idx; CAS readIdx → nextIdx. */
export async function tryAdvanceWarmupAwaitingOnPick(input: {
  supabase: SupabaseClient;
  businessId: number | string;
  phone: string;
  phoneVariants?: string[];
  pickIdx: number;
  nextIdx: number;
}): Promise<TryAdvanceWarmupAwaitingResult> {
  return tryAdvanceWarmupAwaitingIdx({
    ...input,
    pickIdx: input.pickIdx,
  });
}

export type TryRollbackWarmupAwaitingResult =
  | { rolledBack: true; readIdx: number; nextIdx: number }
  | { rolledBack: false; readIdx: number; nextIdx: number; reason: string };

/**
 * Compensating CAS after failed send: SET idx=readIdx WHERE idx=nextIdx.
 * readIdx/nextIdx must be the pair returned from a successful tryAdvance — no recomputation.
 */
export async function tryRollbackWarmupAwaitingIdx(input: {
  supabase: SupabaseClient;
  businessId: number | string;
  phone: string;
  phoneVariants?: string[];
  readIdx: number;
  nextIdx: number;
  context?: string;
}): Promise<TryRollbackWarmupAwaitingResult> {
  const readIdx = Math.trunc(input.readIdx);
  const nextIdx = Math.trunc(input.nextIdx);
  const ctx = String(input.context ?? "").trim() || "warmup_send_rollback";

  if (!Number.isFinite(readIdx) || !Number.isFinite(nextIdx)) {
    console.error("[wa-warmup-awaiting-cas] ROLLBACK FAILED — invalid idx pair", {
      context: ctx,
      businessId: input.businessId,
      phone: input.phone,
      readIdx: input.readIdx,
      nextIdx: input.nextIdx,
    });
    return { rolledBack: false, readIdx, nextIdx, reason: "invalid_idx_pair" };
  }

  const phoneVariants = resolvePhoneVariants(input.phone, input.phoneVariants);
  const businessId = resolveBusinessId(input.businessId);
  const { data, error } = await input.supabase
    .from("contacts")
    .update({
      warmup_extra_awaiting_idx: readIdx,
      updated_at: new Date().toISOString(),
    })
    .eq("business_id", businessId)
    .eq("session_phase", "warmup")
    .eq("warmup_extra_awaiting_idx", nextIdx)
    .in("phone", phoneVariants)
    .select("id");

  if (error) {
    console.error("[wa-warmup-awaiting-cas] ROLLBACK FAILED — DB error; contact may be stuck on nextIdx without message", {
      context: ctx,
      businessId: input.businessId,
      phone: input.phone,
      readIdx,
      nextIdx,
      error: error.message,
    });
    return { rolledBack: false, readIdx, nextIdx, reason: "rollback_update_failed" };
  }

  if (!data?.length) {
    console.error("[wa-warmup-awaiting-cas] ROLLBACK SKIPPED — idx no longer nextIdx (another handler advanced); not overwriting", {
      context: ctx,
      businessId: input.businessId,
      phone: input.phone,
      readIdx,
      nextIdx,
    });
    return { rolledBack: false, readIdx, nextIdx, reason: "rollback_lost_race" };
  }

  return { rolledBack: true, readIdx, nextIdx };
}

/** Log + rollback after send failure following a successful CAS advance. */
export async function rollbackWarmupAwaitingAfterSendFailure(input: {
  supabase: SupabaseClient;
  businessId: number | string;
  phone: string;
  phoneVariants?: string[];
  readIdx: number;
  nextIdx: number;
  context: string;
  sendError: unknown;
}): Promise<TryRollbackWarmupAwaitingResult> {
  console.error("[wa-warmup-awaiting-cas] SEND FAILED after CAS advance — attempting rollback", {
    context: input.context,
    businessId: input.businessId,
    phone: input.phone,
    readIdx: input.readIdx,
    nextIdx: input.nextIdx,
    sendError: input.sendError instanceof Error ? input.sendError.message : String(input.sendError),
  });
  const rollback = await tryRollbackWarmupAwaitingIdx({
    supabase: input.supabase,
    businessId: input.businessId,
    phone: input.phone,
    phoneVariants: input.phoneVariants,
    readIdx: input.readIdx,
    nextIdx: input.nextIdx,
    context: input.context,
  });
  if (!rollback.rolledBack) {
    console.error("[wa-warmup-awaiting-cas] STUCK STATE — idx remains on nextIdx without outbound message", {
      context: input.context,
      businessId: input.businessId,
      phone: input.phone,
      readIdx: input.readIdx,
      nextIdx: input.nextIdx,
      rollbackReason: rollback.reason,
    });
  }
  return rollback;
}
