import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  pickMarketingFollowupStage,
  type MarketingFlowSessionFollowupRow,
} from "@/lib/marketing-followups";
import { WA_FOLLOWUP_MS_20_MIN } from "@/lib/wa-sales-followup-defaults";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const BATCH = 200;

/**
 * Cancel due WhatsApp sales followups without sending (holiday drop-queue).
 * Sets wa_followup_stage=3 so the trigger clears wa_next_followup_at.
 * Does not mark *_sent_at and does not fire CRM no_response.
 */
export async function cancelDueWaFollowupsForHoliday(
  admin: Admin,
  now: Date = new Date()
): Promise<{ cancelled: number; error?: string }> {
  const nowIso = now.toISOString();
  const cutoff24hIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("contacts")
    .select("id")
    .eq("source", "whatsapp")
    .or("opted_out.eq.false,opted_out.is.null")
    .is("not_relevant_at", null)
    .is("human_requested_at", null)
    .or("trial_registered.eq.false,trial_registered.is.null")
    .lt("wa_followup_stage", 3)
    .not("wa_next_followup_at", "is", null)
    .lte("wa_next_followup_at", nowIso)
    .gte("wa_next_followup_at", cutoff24hIso)
    .limit(BATCH);

  if (error) {
    // Legacy DBs without wa_next_followup_at: fall back to last_contact_at window.
    if (/wa_next_followup_at|column|not_relevant|human_requested/i.test(String(error.message ?? ""))) {
      const cutoff20mIso = new Date(now.getTime() - WA_FOLLOWUP_MS_20_MIN).toISOString();
      const legacy = await admin
        .from("contacts")
        .select("id")
        .eq("source", "whatsapp")
        .or("opted_out.eq.false,opted_out.is.null")
        .or("trial_registered.eq.false,trial_registered.is.null")
        .lt("wa_followup_stage", 3)
        .not("last_contact_at", "is", null)
        .lte("last_contact_at", cutoff20mIso)
        .gte("last_contact_at", cutoff24hIso)
        .limit(BATCH);
      if (legacy.error) {
        console.error("[followup-holiday-drop] wa legacy query:", legacy.error);
        return { cancelled: 0, error: legacy.error.message };
      }
      return cancelWaIds(admin, (legacy.data ?? []).map((r) => String((r as { id: unknown }).id)));
    }
    console.error("[followup-holiday-drop] wa query:", error);
    return { cancelled: 0, error: error.message };
  }

  return cancelWaIds(
    admin,
    (data ?? []).map((r) => String((r as { id: unknown }).id))
  );
}

async function cancelWaIds(
  admin: Admin,
  ids: string[]
): Promise<{ cancelled: number; error?: string }> {
  const clean = ids.filter(Boolean);
  if (!clean.length) return { cancelled: 0 };

  const { error } = await admin.from("contacts").update({ wa_followup_stage: 3 }).in("id", clean);
  if (error) {
    console.error("[followup-holiday-drop] wa update:", error);
    return { cancelled: 0, error: error.message };
  }
  console.info("[followup-holiday-drop] cancelled wa followups", { count: clean.length });
  return { cancelled: clean.length };
}

/**
 * Cancel due marketing followups without sending: mark all remaining stages as sent.
 */
export async function cancelDueMarketingFollowupsForHoliday(
  admin: Admin,
  now: Date = new Date()
): Promise<{ cancelled: number; error?: string }> {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  let rows: MarketingFlowSessionFollowupRow[] | null = null;
  const withHuman = await admin
    .from("marketing_flow_sessions")
    .select(
      "id, phone, last_user_message_at, followup_1_sent_at, followup_2_sent_at, followup_3_sent_at, followup_opted_out, flow_completed, human_followup_at"
    )
    .eq("flow_completed", false)
    .eq("followup_opted_out", false)
    .is("human_followup_at", null)
    .not("last_user_message_at", "is", null)
    .limit(BATCH);

  if (!withHuman.error) {
    rows = (withHuman.data ?? []) as MarketingFlowSessionFollowupRow[];
  } else if (/human_followup_at|column/i.test(String(withHuman.error.message ?? ""))) {
    const fallback = await admin
      .from("marketing_flow_sessions")
      .select(
        "id, phone, last_user_message_at, followup_1_sent_at, followup_2_sent_at, followup_3_sent_at, followup_opted_out, flow_completed"
      )
      .eq("flow_completed", false)
      .eq("followup_opted_out", false)
      .not("last_user_message_at", "is", null)
      .limit(BATCH);
    if (fallback.error) {
      console.error("[followup-holiday-drop] marketing query:", fallback.error);
      return { cancelled: 0, error: fallback.error.message };
    }
    rows = (fallback.data ?? []) as MarketingFlowSessionFollowupRow[];
  } else {
    console.error("[followup-holiday-drop] marketing query:", withHuman.error);
    return { cancelled: 0, error: withHuman.error.message };
  }

  let cancelled = 0;
  for (const row of rows ?? []) {
    if (pickMarketingFollowupStage(row, nowMs) < 1) continue;
    const patch: Record<string, string> = { updated_at: nowIso };
    if (!row.followup_1_sent_at) patch.followup_1_sent_at = nowIso;
    if (!row.followup_2_sent_at) patch.followup_2_sent_at = nowIso;
    if (!row.followup_3_sent_at) patch.followup_3_sent_at = nowIso;
    const { error } = await admin.from("marketing_flow_sessions").update(patch).eq("id", row.id);
    if (error) {
      console.error("[followup-holiday-drop] marketing update:", error.message, { id: row.id });
      continue;
    }
    cancelled += 1;
  }

  if (cancelled > 0) {
    console.info("[followup-holiday-drop] cancelled marketing followups", { count: cancelled });
  }
  return { cancelled };
}
