/**
 * Daily flag: contacts.arbox_is_member from the activeMembershipsReport rows
 * the arbox-daily-triggers cron already loaded. Does not call Arbox.
 * Updates existing contacts only. Never inserts.
 */
import { isArboxActiveCustomerMembershipStatus } from "@/lib/leads/arbox-customer-set";
import { contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

const PHONE_CHUNK = 80;
const ID_CHUNK = 200;

export type ArboxMemberFlagSummary = {
  member_phones: number;
  marked_true: number;
  marked_false: number;
  skipped?: string;
};

function memberPhoneSet(rows: Record<string, unknown>[]): Set<string> {
  const phones = new Set<string>();
  for (const row of rows) {
    if (!isArboxActiveCustomerMembershipStatus(row.status)) continue;
    for (const raw of [row.phone, row.additional_phone]) {
      const phone = normalizePhone(raw);
      if (phone) phones.add(phone);
    }
  }
  return phones;
}

function phoneMatchesMember(phone: string, members: Set<string>): boolean {
  for (const variant of contactPhoneLookupVariants(phone)) {
    const normalized = normalizePhone(variant);
    if (normalized && members.has(normalized)) return true;
  }
  return false;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function missingColumn(message: string): boolean {
  return /arbox_is_member|arbox_member_synced_at|schema cache|does not exist/i.test(message);
}

export async function syncArboxMemberFlags(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  membershipRows: Record<string, unknown>[];
  now?: Date;
}): Promise<ArboxMemberFlagSummary> {
  const nowIso = (input.now ?? new Date()).toISOString();
  const members = memberPhoneSet(input.membershipRows);
  const variants = [
    ...new Set([...members].flatMap((phone) => contactPhoneLookupVariants(phone))),
  ];
  let markedTrue = 0;

  for (const phones of chunk(variants, PHONE_CHUNK)) {
    if (!phones.length) continue;
    const { data, error } = await input.admin
      .from("contacts")
      .update({ arbox_is_member: true, arbox_member_synced_at: nowIso })
      .eq("business_id", input.businessId)
      .in("phone", phones)
      .select("id");
    if (error) {
      if (missingColumn(error.message)) {
        console.error(
          "[arbox-member-flag] column missing — run supabase/contacts_arbox_is_member.sql",
          { businessId: input.businessId }
        );
        return { member_phones: members.size, marked_true: 0, marked_false: 0, skipped: "column_missing" };
      }
      console.error("[arbox-member-flag] mark true failed:", error.message, {
        businessId: input.businessId,
      });
      return { member_phones: members.size, marked_true: markedTrue, marked_false: 0, skipped: "update_failed" };
    }
    markedTrue += data?.length ?? 0;
  }

  const currentlyTrue: { id: string; phone: string }[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await input.admin
      .from("contacts")
      .select("id, phone")
      .eq("business_id", input.businessId)
      .eq("arbox_is_member", true)
      .range(from, from + 499);
    if (error) {
      if (missingColumn(error.message)) {
        console.error(
          "[arbox-member-flag] column missing — run supabase/contacts_arbox_is_member.sql",
          { businessId: input.businessId }
        );
        return { member_phones: members.size, marked_true: markedTrue, marked_false: 0, skipped: "column_missing" };
      }
      console.error("[arbox-member-flag] list members failed:", error.message, {
        businessId: input.businessId,
      });
      break;
    }
    for (const row of data ?? []) {
      currentlyTrue.push({
        id: String((row as { id: unknown }).id),
        phone: String((row as { phone?: unknown }).phone ?? ""),
      });
    }
    if (!data || data.length < 500) break;
  }

  const clearIds = currentlyTrue
    .filter((row) => !phoneMatchesMember(row.phone, members))
    .map((row) => row.id);
  let markedFalse = 0;
  for (const ids of chunk(clearIds, ID_CHUNK)) {
    const { data, error } = await input.admin
      .from("contacts")
      .update({ arbox_is_member: false, arbox_member_synced_at: nowIso })
      .eq("business_id", input.businessId)
      .in("id", ids)
      .select("id");
    if (error) {
      console.error("[arbox-member-flag] mark false failed:", error.message, {
        businessId: input.businessId,
      });
      break;
    }
    markedFalse += data?.length ?? 0;
  }

  return { member_phones: members.size, marked_true: markedTrue, marked_false: markedFalse };
}
