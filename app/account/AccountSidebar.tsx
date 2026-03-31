"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items: Array<{ href: string; label: string }> = [
  { href: "/account/settings", label: "פרטים אישיים" },
  { href: "/account/billing", label: "חיוב וחבילות" },
  { href: "/account/users", label: "משתמשים" },
  { href: "/account/contact", label: "צור קשר" },
];

export default function AccountSidebar() {
  const pathname = usePathname();

  return (
    <aside className="rounded-2xl border border-zinc-200 bg-white p-2" dir="rtl">
      <nav className="space-y-1">
        {items.map((it) => {
          const active = pathname === it.href;
          return (
            <Link
              key={it.href}
              href={it.href}
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

