"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function SlugDashboardNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/${slug}`;

  const items: { href: string; label: string }[] = [
    { href: `${base}/analytics`, label: "אנליטיקס" },
    { href: `${base}/conversations`, label: "שיחות" },
    { href: `${base}/settings`, label: "הגדרות" },
  ];

  return (
    <nav className="mb-4 flex justify-end gap-2 text-sm">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              "rounded-full border px-3 py-1.5 transition " +
              (active
                ? "border-fuchsia-500 bg-fuchsia-600 text-white shadow-sm"
                : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50")
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

