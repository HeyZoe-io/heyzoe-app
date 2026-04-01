"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import UserMenu from "@/app/components/UserMenu";

export default function SlugDashboardNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/${slug}`;

  const items: { href: string; label: string }[] = [
    { href: `${base}/analytics`, label: "אנליטיקס" },
    { href: `${base}/conversations`, label: "שיחות" },
    { href: `${base}/settings`, label: "הגדרות" },
  ];

  return (
    <nav className="mb-4 flex items-center justify-between gap-3 text-sm hz-wave hz-wave-1">
      <div className="flex items-center gap-2">
        <div className="hidden sm:flex items-center gap-1 font-semibold text-zinc-900 select-none">
          <span>HeyZ</span>
          <span className="text-[#35ff70]">O</span>
          <span>e</span>
        </div>
        <UserMenu />
      </div>
      <div className="flex justify-end gap-2">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={true}
              className={
                "px-3 py-1.5 transition font-medium " +
                (active
                  ? "rounded-[20px] text-white shadow-sm bg-[linear-gradient(135deg,#7133da,#ff92ff)]"
                  : "rounded-[20px] bg-[#ede9fe] text-zinc-600 hover:bg-[#e9e5ff]")
              }
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

