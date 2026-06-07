"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = [
  { segment: "settings", label: "פרטים אישיים" },
  { segment: "billing", label: "חיוב וחבילות" },
  { segment: "notifications", label: "התראות" },
  { segment: "users", label: "משתמשים" },
  { segment: "contact", label: "צור קשר" },
] as const;

export default function AccountSidebar({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/${encodeURIComponent(String(slug ?? "").trim().toLowerCase())}/account`;
  const accountPrefix = `/${String(slug ?? "").trim().toLowerCase()}/account/`;

  return (
    <aside className="rounded-2xl border border-zinc-200 bg-white p-2" dir="rtl">
      <nav className="space-y-1">
        {SECTIONS.map((it) => {
          const href = `${base}/${it.segment}`;
          const active = Boolean(pathname?.includes(`${accountPrefix}${it.segment}`));
          return (
            <Link
              key={it.segment}
              href={href}
              className={
                "block rounded-xl px-3 py-2 text-sm font-medium transition cursor-pointer " +
                (active
                  ? "bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200"
                  : "text-zinc-700 hover:bg-zinc-50")
              }
            >
              {it.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
