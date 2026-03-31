import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export default async function DashboardSlugLayout({ children }: Props) {
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-6">
      <div className="mx-auto max-w-5xl space-y-4">{children}</div>
    </main>
  );
}

