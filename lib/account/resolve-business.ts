import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";

export type AccountBusinessContext = {
  businessId: number;
  slug: string;
  ownerWhatsappOptedIn: boolean;
  ownerWhatsappPhone: string | null;
};

export async function resolveAccountBusinessForUser(userId: string): Promise<AccountBusinessContext | null> {
  const admin = createSupabaseAdminClient();

  const loadBiz = async (businessId: number) => {
    const { data: biz } = await admin
      .from("businesses")
      .select("id, slug, owner_whatsapp_opted_in, owner_whatsapp_phone")
      .eq("id", businessId)
      .maybeSingle();
    if (!biz?.id) return null;
    const phone = String(biz.owner_whatsapp_phone ?? "").trim();
    return {
      businessId: Number(biz.id),
      slug: String(biz.slug ?? "").trim(),
      ownerWhatsappOptedIn: biz.owner_whatsapp_opted_in === true,
      ownerWhatsappPhone: phone || null,
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
    .select("id, slug, owner_whatsapp_opted_in, owner_whatsapp_phone")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (owned?.id) {
    const phone = String(owned.owner_whatsapp_phone ?? "").trim();
    return {
      businessId: Number(owned.id),
      slug: String(owned.slug ?? "").trim(),
      ownerWhatsappOptedIn: owned.owner_whatsapp_opted_in === true,
      ownerWhatsappPhone: phone || null,
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

/** עסק לפי slug — בעלים, חבר business_users, או אדמין פלטפורמה */
export async function resolveAccountBusinessForUserBySlug(
  userId: string,
  slug: string,
  opts?: { userEmail?: string | null }
): Promise<AccountBusinessContext | null> {
  const normSlug = String(slug ?? "")
    .trim()
    .toLowerCase();
  if (!normSlug) return null;

  const admin = createSupabaseAdminClient();
  const { data: biz } = await admin
    .from("businesses")
    .select("id, slug, owner_whatsapp_opted_in, owner_whatsapp_phone, user_id")
    .eq("slug", normSlug)
    .maybeSingle();

  if (!biz?.id) return null;
  const businessId = Number(biz.id);
  if (!Number.isFinite(businessId)) return null;

  if (opts?.userEmail && isAdminAllowedEmail(opts.userEmail)) {
    const phone = String(biz.owner_whatsapp_phone ?? "").trim();
    return {
      businessId,
      slug: String(biz.slug ?? "").trim(),
      ownerWhatsappOptedIn: biz.owner_whatsapp_opted_in === true,
      ownerWhatsappPhone: phone || null,
    };
  }

  const ownerId = String(biz.user_id ?? "").trim();
  if (ownerId && ownerId === userId) {
    const phone = String(biz.owner_whatsapp_phone ?? "").trim();
    return {
      businessId,
      slug: String(biz.slug ?? "").trim(),
      ownerWhatsappOptedIn: biz.owner_whatsapp_opted_in === true,
      ownerWhatsappPhone: phone || null,
    };
  }

  const { data: membership } = await admin
    .from("business_users")
    .select("business_id")
    .eq("user_id", userId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (!membership?.business_id) return null;

  const phone = String(biz.owner_whatsapp_phone ?? "").trim();
  return {
    businessId,
    slug: String(biz.slug ?? "").trim(),
    ownerWhatsappOptedIn: biz.owner_whatsapp_opted_in === true,
    ownerWhatsappPhone: phone || null,
  };
}
