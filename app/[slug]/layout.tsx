import type { ReactNode } from "react";
import SlugDashboardNav from "./Nav";
import DashboardPwaPrompt from "@/app/components/DashboardPwaPrompt";
import DashboardHelpChatWidget from "@/app/components/DashboardHelpChatWidget";

type Props = {
  children: ReactNode;
  params: Promise<{ slug: string }>;
};

export default async function SlugLayout({ children, params }: Props) {
  const { slug } = await params;

  return (
    <>
      <main className="min-h-screen bg-[#FAFAFA] px-4 py-6 sm:px-6 sm:py-8" dir="rtl">
        <div className="mx-auto max-w-6xl space-y-5">
          <div className="sticky top-0 z-30 pt-1 isolate">
            <SlugDashboardNav slug={slug} />
          </div>
          {children}
        </div>
      </main>
      <DashboardHelpChatWidget slug={slug} />
      <DashboardPwaPrompt />
    </>
  );
}

