import type { ReactNode } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import SlugDashboardNav from "./Nav";
import DashboardPwaPrompt from "@/app/components/DashboardPwaPrompt";
import DashboardHelpChatWidget from "@/app/components/DashboardHelpChatWidget";
import OwnerWhatsappOptInModal from "@/app/components/OwnerWhatsappOptInModal";

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
    <>
      <main className="min-h-screen bg-[#FAFAFA] px-4 py-6 sm:px-6 sm:py-8" dir="rtl">
        <div className="mx-auto max-w-6xl space-y-5">
          <div className="relative pt-1">
            <SlugDashboardNav slug={slug} />
          </div>
          {children}
        </div>
      </main>
      <DashboardHelpChatWidget slug={slug} />
      <DashboardPwaPrompt />
      {showOwnerWhatsappOptIn ? <OwnerWhatsappOptInModal slug={normSlug} /> : null}
    </>
  );
}
