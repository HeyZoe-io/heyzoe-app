import type { ReactNode } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { META_PRICING_NOTICE_KEY } from "@/lib/meta-pricing-notice";
import SlugLayoutChrome from "./SlugLayoutChrome";
import type { MetaPricingNoticeData } from "./MetaPricingNoticeModal";

/** מניעת CDN/דפדפן מלהגיש HTML ישן עם chunk hashes ישנים אחרי דיפלוי */
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = {
  children: ReactNode;
  params: Promise<{ slug: string }>;
};

export default async function SlugLayout({ children, params }: Props) {
  const { slug } = await params;
  const normSlug = String(slug ?? "").trim().toLowerCase();

  let showOwnerWhatsappOptIn = false;
  let zoeActivated = false;
  let businessId: number | null = null;
  let businessName = "";

  // Opt-in / Zoe flags — isolated try/catch. Ack lookup must never throw into this block.
  try {
    const admin = createSupabaseAdminClient();
    const { data: biz } = await admin
      .from("businesses")
      .select("id, name, owner_whatsapp_opted_in, zoe_activated")
      .eq("slug", normSlug)
      .maybeSingle();
    showOwnerWhatsappOptIn = biz?.owner_whatsapp_opted_in !== true;
    zoeActivated = biz?.zoe_activated === true;
    const idNum = biz?.id != null ? Number(biz.id) : NaN;
    if (Number.isFinite(idNum)) {
      businessId = idNum;
      businessName = String(biz?.name ?? "").trim() || normSlug;
    }
  } catch {
    showOwnerWhatsappOptIn = false;
    zoeActivated = false;
  }

  let metaPricingNotice: MetaPricingNoticeData | null = null;
  // Ack bootstrap via the cookie-authenticated anon client (SELECT policy is user-scoped).
  // Failures degrade to "not acknowledged" / null — never re-enter the opt-in catch above.
  if (businessId != null) {
    try {
      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        let acknowledged = false;
        try {
          const { data: ackRow, error: ackErr } = await supabase
            .from("notice_acknowledgments")
            .select("id")
            .eq("notice_key", META_PRICING_NOTICE_KEY)
            .eq("user_id", user.id)
            .eq("business_id", businessId)
            .maybeSingle();
          if (ackErr) {
            console.error("[SlugLayout] notice_ack_select_failed", {
              user_id: user.id,
              business_id: businessId,
              error: ackErr.message,
            });
            acknowledged = false;
          } else {
            acknowledged = Boolean(ackRow);
          }
        } catch (e) {
          console.error("[SlugLayout] notice_ack_select_threw", e);
          acknowledged = false;
        }

        const userName =
          (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "") ||
          (typeof user.user_metadata?.name === "string" ? user.user_metadata.name.trim() : "") ||
          String(user.email ?? "").trim();

        metaPricingNotice = {
          acknowledged,
          businessSlug: normSlug,
          businessName,
          userName,
          isPlatformAdmin: isAdminAllowedEmail(user.email ?? ""),
        };
      }
    } catch (e) {
      console.error("[SlugLayout] notice_ack_bootstrap_failed", {
        business_slug: normSlug,
        business_id: businessId,
        error: e instanceof Error ? e.message : String(e),
      });
      metaPricingNotice = null;
    }
  }

  return (
    <SlugLayoutChrome
      slug={slug}
      showOwnerWhatsappOptIn={showOwnerWhatsappOptIn}
      zoeActivated={zoeActivated}
      metaPricingNotice={metaPricingNotice}
    >
      {children}
    </SlugLayoutChrome>
  );
}
