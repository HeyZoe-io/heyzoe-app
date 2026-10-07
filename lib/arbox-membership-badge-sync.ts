import {
  ARBOX_MEMBERSHIP_BADGE_REFRESH_MS,
  membershipBadgeContactPatch,
  shouldRefreshArboxMembershipBadge,
} from "@/lib/arbox-membership-badge";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveArboxMembershipBadgeByPhone } from "@/lib/wa-membership-lookup";

/**
 * One Arbox search + one memberships read, then at most one contacts write.
 * Runs from the webhook after() and from the backfill script. Never from the list render.
 */
export async function refreshArboxMembershipBadge(input: {
  businessId: number;
  contactId: string | number;
  phone: string;
  apiKey: string;
  boxId: string;
  now?: Date;
}): Promise<{ wrote: boolean; badge: string | null }> {
  const businessId = Number(input.businessId);
  const contactId = input.contactId;
  if (!businessId || contactId == null || contactId === "") return { wrote: false, badge: null };

  const now = input.now ?? new Date();
  const badge = await resolveArboxMembershipBadgeByPhone({
    apiKey: input.apiKey,
    boxId: input.boxId,
    lookupPhone: input.phone,
    now,
  });
  if (!badge) return { wrote: false, badge: null };

  const admin = createSupabaseAdminClient();
  // Columns land with supabase/contacts_arbox_membership_status.sql and are not in generated types yet.
  const contacts = admin.from("contacts") as unknown as {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        eq: (column: string, value: unknown) => {
          maybeSingle: () => Promise<{
            data: { arbox_membership_status?: string | null; arbox_membership_checked_at?: string | null } | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
    update: (patch: Record<string, unknown>) => {
      eq: (column: string, value: unknown) => {
        eq: (column: string, value: unknown) => {
          or: (filters: string) => {
            select: (columns: string) => Promise<{
              data: { id: string }[] | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };
  };
  const { data: existing, error: readErr } = await contacts
    .select("arbox_membership_status, arbox_membership_checked_at")
    .eq("id", contactId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (readErr) {
    console.error("[membership-badge] contact read failed:", readErr.message);
    return { wrote: false, badge: null };
  }
  const checkedAt = (existing as { arbox_membership_checked_at?: string | null } | null)
    ?.arbox_membership_checked_at;
  if (!shouldRefreshArboxMembershipBadge(checkedAt, now)) return { wrote: false, badge };

  const current = (existing as { arbox_membership_status?: string | null } | null)?.arbox_membership_status;
  const checkedAtIso = now.toISOString();
  const cutoffIso = new Date(now.getTime() - ARBOX_MEMBERSHIP_BADGE_REFRESH_MS).toISOString();
  const patch = membershipBadgeContactPatch({ current, next: badge, checkedAtIso });
  const { data, error } = await contacts
    .update(patch)
    .eq("id", contactId)
    .eq("business_id", businessId)
    .or(`arbox_membership_checked_at.is.null,arbox_membership_checked_at.lt.${cutoffIso}`)
    .select("id");
  if (error) {
    console.error("[membership-badge] contact update failed:", error.message);
    return { wrote: false, badge: null };
  }
  return { wrote: Boolean(data?.length), badge };
}
