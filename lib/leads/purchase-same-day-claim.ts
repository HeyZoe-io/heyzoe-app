/**
 * DB claim behind the same-day purchase collapse: one template per
 * (business, Arbox user, sale date, rule), whichever sale reaches the send first.
 * IO: one insert per purchase template send, plus one read on conflict.
 */
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const PURCHASE_SAME_DAY_CLAIM_TABLE = "arbox_purchase_same_day_claim";

export type PurchaseSameDayClaim = "won" | "collapsed" | "missing_table" | "error";

function isMissingTable(message: string): boolean {
  return /does not exist|42P01|PGRST205|schema cache/i.test(message);
}

/** A sale that already holds the claim (its retry after a failed send) wins again. */
export async function claimPurchaseSameDay(input: {
  admin: Admin;
  businessId: number;
  userId: string;
  saleDateYmd: string;
  triggerId: string;
  saleId: number;
}): Promise<PurchaseSameDayClaim> {
  const key = {
    business_id: input.businessId,
    user_id: input.userId,
    sale_date: input.saleDateYmd,
    trigger_id: input.triggerId,
  };
  const inserted = await input.admin.from(PURCHASE_SAME_DAY_CLAIM_TABLE).insert({ ...key, sale_id: input.saleId });
  if (!inserted.error) return "won";
  const message = String(inserted.error.message ?? "");
  const code = String((inserted.error as { code?: unknown }).code ?? "");
  if (isMissingTable(message) || code === "42P01" || code === "PGRST205") {
    console.error("[leads/purchase-same-day-claim] table missing, run supabase/arbox_purchase_same_day_claim.sql");
    return "missing_table";
  }
  if (code !== "23505" && !/duplicate key/i.test(message)) {
    console.error("[leads/purchase-same-day-claim] claim insert failed:", message);
    return "error";
  }
  const { data, error } = await input.admin
    .from(PURCHASE_SAME_DAY_CLAIM_TABLE)
    .select("sale_id")
    .eq("business_id", key.business_id)
    .eq("user_id", key.user_id)
    .eq("sale_date", key.sale_date)
    .eq("trigger_id", key.trigger_id)
    .maybeSingle();
  if (error) {
    console.error("[leads/purchase-same-day-claim] claim read failed:", error.message);
    return "error";
  }
  return Number((data as { sale_id?: unknown } | null)?.sale_id) === input.saleId ? "won" : "collapsed";
}
