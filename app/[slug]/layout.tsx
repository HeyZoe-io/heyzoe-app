import type { ReactNode } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import SlugLayoutChrome from "./SlugLayoutChrome";

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
  try {
    const admin = createSupabaseAdminClient();
    const { data: biz } = await admin
      .from("businesses")
      .select("owner_whatsapp_opted_in")
      .eq("slug", normSlug)
      .maybeSingle();
    showOwnerWhatsappOptIn = biz?.owner_whatsapp_opted_in !== true;
  } catch {
    showOwnerWhatsappOptIn = false;
  }

  return (
    <SlugLayoutChrome slug={slug} showOwnerWhatsappOptIn={showOwnerWhatsappOptIn}>
      {children}
    </SlugLayoutChrome>
  );
}
