"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import SlugDashboardNav from "./Nav";
import { SettingsUnsavedProvider } from "./settings/settings-unsaved-context";
import DashboardPwaPrompt from "@/app/components/DashboardPwaPrompt";
import DashboardHelpChatWidget from "@/app/components/DashboardHelpChatWidget";
import OwnerWhatsappOptInModal from "@/app/components/OwnerWhatsappOptInModal";

export default function SlugLayoutChrome({
  slug,
  showOwnerWhatsappOptIn,
  zoeActivated,
  children,
}: {
  slug: string;
  showOwnerWhatsappOptIn: boolean;
  zoeActivated: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const normSlug = String(slug ?? "").trim().toLowerCase();
  const isAccountArea = normSlug && pathname.includes(`/${normSlug}/account`);

  const [activated, setActivated] = useState(zoeActivated);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  if (isAccountArea) {
    return <>{children}</>;
  }

  async function activateZoe() {
    setActivating(true);
    setActivateError(null);
    try {
      const res = await fetch("/api/whatsapp/activate-zoe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_slug: normSlug, activate: true }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        if (j?.error === "no_whatsapp_number") {
          setActivateError("אין מספר מחובר עדיין. חברו מספר WhatsApp לפני הפעלת זואי.");
          return;
        }
        throw new Error(`request_failed (${res.status})`);
      }
      setActivated(true);
    } catch (e) {
      console.error("[SlugLayoutChrome] activateZoe failed:", e);
      setActivateError("ההפעלה נכשלה, נסו שוב.");
    } finally {
      setActivating(false);
    }
  }

  return (
    <SettingsUnsavedProvider>
      <main className="min-h-screen bg-[#FAFAFA]" dir="rtl">
        {!activated ? (
          <div className="w-full bg-gradient-to-l from-[#7133da] to-[#ff92ff] px-4 py-3 sm:px-6">
            <div className="mx-auto flex max-w-6xl flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-medium text-white">
                  מסלול המכירה מוכן? הפעילו את זואי על המספר שלכם!
                </span>
                <button
                  type="button"
                  disabled={activating}
                  onClick={() => void activateZoe()}
                  className="shrink-0 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-[#7133da] disabled:opacity-60"
                >
                  {activating ? "מפעילים..." : "הפעלת זואי"}
                </button>
              </div>
              {activateError ? (
                <p className="text-sm font-medium text-white/95" role="alert">
                  {activateError}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="px-4 py-6 sm:px-6 sm:py-8">
          <div className="mx-auto max-w-6xl space-y-5">
            <div className="relative pt-1">
              <SlugDashboardNav slug={slug} />
            </div>
            {children}
          </div>
        </div>
      </main>
      <DashboardHelpChatWidget slug={slug} />
      <DashboardPwaPrompt />
      {showOwnerWhatsappOptIn ? <OwnerWhatsappOptInModal slug={normSlug} /> : null}
    </SettingsUnsavedProvider>
  );
}
