"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import UserMenu from "@/app/components/UserMenu";

export default function SlugDashboardNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/${slug}`;

  const items: { href: string; label: string }[] = [
    { href: `${base}/analytics`, label: "אנליטיקס" },
    { href: `${base}/conversations`, label: "שיחות" },
    { href: `${base}/contacts`, label: "אנשי קשר" },
    { href: `${base}/settings`, label: "הגדרות" },
  ];

  return (
    <nav className="mb-4 flex items-center justify-between gap-3 text-sm hz-wave hz-wave-1">
      <div className="flex items-center gap-2">
        <Link
          href={`${base}/analytics`}
          prefetch={true}
          className="hidden sm:flex items-center select-none"
          aria-label="HeyZoe — לדשבורד"
          onClick={() => {
            // Close potential open dropdowns etc by forcing navigation; Link handles it.
          }}
        >
          <Image
            src="/heyzoe-logo.png"
            alt="HeyZoe"
            width={220}
            height={48}
            priority
            className="h-8 w-auto"
          />
        </Link>
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

