/**
 * Per-business pause of background Arbox work. Stored on businesses.arbox_background_paused.
 *
 * Paused: Arbox crons, template triggers, scheduled syncs, queued trigger sends and
 * cron-raised CRM events make no Arbox call and send nothing.
 * Not paused: anything a live conversation needs (trial registration, class space,
 * schedule and membership lookups, human_requested / trial_registered CRM events).
 *
 * While paused, the trial-sync and daily dispatchers move the business's catch-up
 * clocks to now on every tick (arbox_last_sync_at and template_triggers.updated_at,
 * which every report trigger treats as its activation time). Turning the pause off
 * therefore resumes from the last tick, never from the start of the pause.
 */
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const ARBOX_BACKGROUND_PAUSE_COLUMN = "arbox_background_paused";
export const ARBOX_BACKGROUND_PAUSED = "arbox_background_paused";

export function rowArboxBackgroundPaused(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  return (row as Record<string, unknown>)[ARBOX_BACKGROUND_PAUSE_COLUMN] === true;
}

/** CRM kinds raised only by crons or the lead-form webhook, never by a live reply. */
const BACKGROUND_CRM_KINDS = new Set([
  "no_response",
  "idle_no_response",
  "template_sent",
  "template_no_response",
]);

export function isBackgroundCrmKind(kind: string): boolean {
  return BACKGROUND_CRM_KINDS.has(kind);
}

export async function loadArboxBackgroundPausedIds(
  admin: Admin,
  businessIds: readonly number[]
): Promise<Set<number>> {
  const ids = [...new Set(businessIds.filter((id) => Number.isFinite(id) && id > 0))];
  const paused = new Set<number>();
  if (!ids.length) return paused;
  const { data, error } = await admin
    .from("businesses")
    .select(`id, ${ARBOX_BACKGROUND_PAUSE_COLUMN}`)
    .in("id", ids);
  if (error) {
    console.error("[arbox-background-pause] lookup failed:", error.message, { ids });
    return paused;
  }
  for (const row of data ?? []) {
    if (rowArboxBackgroundPaused(row)) paused.add(Number((row as { id?: unknown }).id));
  }
  return paused;
}

export async function isBusinessArboxBackgroundPaused(admin: Admin, businessId: number): Promise<boolean> {
  return (await loadArboxBackgroundPausedIds(admin, [businessId])).has(businessId);
}

/**
 * Moves the catch-up clocks of paused businesses to now. No Arbox call.
 * Two updates per tick, filtered by id / business_id.
 */
export async function holdArboxBackgroundClocks(
  admin: Admin,
  businessIds: readonly number[],
  now: Date
): Promise<{ ok: boolean; errors: string[] }> {
  const ids = [...new Set(businessIds.filter((id) => Number.isFinite(id) && id > 0))];
  const errors: string[] = [];
  if (!ids.length) return { ok: true, errors };
  const nowIso = now.toISOString();
  const { error: bizErr } = await admin
    .from("businesses")
    .update({ arbox_last_sync_at: nowIso })
    .in("id", ids);
  if (bizErr) errors.push(`businesses: ${bizErr.message}`);
  const { error: ruleErr } = await admin
    .from("template_triggers")
    .update({ updated_at: nowIso })
    .in("business_id", ids);
  if (ruleErr) errors.push(`template_triggers: ${ruleErr.message}`);
  if (errors.length) {
    console.error("[arbox-background-pause] hold clocks failed", { ids, errors });
  } else {
    console.info("[arbox-background-pause] held", { ids, at: nowIso });
  }
  return { ok: errors.length === 0, errors };
}
