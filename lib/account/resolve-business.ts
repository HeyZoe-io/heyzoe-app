import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export type AccountBusinessContext = {
  businessId: number;
  slug: string;
  ownerWhatsappOptedIn: boolean;
};

export async function resolveAccountBusinessForUser(userId: string): Promise<AccountBusinessContext | null> {
  const admin = createSupabaseAdminClient();

  const loadBiz = async (businessId: number) => {
    const { data: biz } = await admin
      .from("businesses")
      .select("id, slug, owner_whatsapp_opted_in")
      .eq("id", businessId)
      .maybeSingle();
    if (!biz?.id) return null;
    return {
      businessId: Number(biz.id),
      slug: String(biz.slug ?? "").trim(),
      ownerWhatsappOptedIn: biz.owner_whatsapp_opted_in === true,
    };
  };

  const { data: primaryMembership } = await admin
    .from("business_users")
    .select("business_id")
    .eq("user_id", userId)
    .eq("is_primary", true)
    .limit(1)
    .maybeSingle();

  if (primaryMembership?.business_id) {
    return loadBiz(Number(primaryMembership.business_id));
  }

  const { data: owned } = await admin
    .from("businesses")
    .select("id, slug, owner_whatsapp_opted_in")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (owned?.id) {
    return {
      businessId: Number(owned.id),
      slug: String(owned.slug ?? "").trim(),
      ownerWhatsappOptedIn: owned.owner_whatsapp_opted_in === true,
    };
  }

  const { data: membership } = await admin
    .from("business_users")
    .select("business_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (!membership?.business_id) return null;
  return loadBiz(Number(membership.business_id));
}
