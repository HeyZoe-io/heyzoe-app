import type { ReactNode } from "react";
import SlugDashboardNav from "./Nav";
import DashboardPwaPrompt from "@/app/components/DashboardPwaPrompt";

type Props = {
  children: ReactNode;
  params: Promise<{ slug: string }>;
};

export default async function SlugLayout({ children, params }: Props) {
  const { slug } = await params;

  return (
    <>
      <main className="min-h-screen bg-zinc-50 px-4 py-6">
        <div className="mx-auto max-w-5xl space-y-4">
          <SlugDashboardNav slug={slug} />
          {children}
        </div>
      </main>
      <DashboardPwaPrompt />
    </>
  );
}

