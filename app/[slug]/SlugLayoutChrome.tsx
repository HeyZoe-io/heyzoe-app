"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import SlugDashboardNav from "./Nav";
import DashboardPwaPrompt from "@/app/components/DashboardPwaPrompt";
import DashboardHelpChatWidget from "@/app/components/DashboardHelpChatWidget";
import OwnerWhatsappOptInModal from "@/app/components/OwnerWhatsappOptInModal";

export default function SlugLayoutChrome({
  slug,
  showOwnerWhatsappOptIn,
  children,
}: {
  slug: string;
  showOwnerWhatsappOptIn: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const normSlug = String(slug ?? "").trim().toLowerCase();
  const isAccountArea = normSlug && pathname.includes(`/${normSlug}/account`);

  if (isAccountArea) {
    return <>{children}</>;
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
