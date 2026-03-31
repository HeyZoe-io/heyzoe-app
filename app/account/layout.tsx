import type { ReactNode } from "react";
import Link from "next/link";
import UserMenu from "@/app/components/UserMenu";

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-6" dir="rtl">
      <div className="mx-auto max-w-4xl space-y-4">
        <nav className="flex items-center justify-between">
          <UserMenu />
          <Link href="/dashboard/settings" className="text-sm text-zinc-600 hover:text-zinc-900">
            חזרה לדשבורד
          </Link>
        </nav>
        {children}
      </div>
    </main>
  );
}

