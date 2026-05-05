"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import UserMenu from "@/app/components/UserMenu";
import { useEffect, useState } from "react";

export default function SlugDashboardNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/${slug}`;
  const [metaStatus, setMetaStatus] = useState<null | "CONNECTED" | "PENDING" | "UNVERIFIED" | "not_provisioned">(null);

  const items: { href: string; label: string }[] = [
    { href: `${base}/settings`, label: "מסלול מכירה" },
    { href: `${base}/conversations`, label: "שיחות" },
    { href: `${base}/contacts`, label: "אנשי קשר" },
    { href: `${base}/analytics`, label: "אנליטיקס" },
  ];

  useEffect(() => {
    let mounted = true;
    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/dashboard/whatsapp-status?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
        const j = (await res.json().catch(() => ({}))) as any;
        const st = String(j?.status ?? "").trim().toUpperCase();
        if (!mounted) return;
        if (st === "CONNECTED" || st === "PENDING" || st === "UNVERIFIED") {
          setMetaStatus(st as any);
          return;
        }
        if (st === "NOT_PROVISIONED" || st === "not_provisioned") {
          setMetaStatus("not_provisioned");
          return;
        }
        setMetaStatus(null);
      } catch {
        if (!mounted) return;
        setMetaStatus(null);
      }
    };
    void fetchStatus();
    const id = window.setInterval(fetchStatus, 15_000);
    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, [slug]);

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
        {metaStatus === "PENDING" ? (
          <Link
            href={`${base}/settings?step=4`}
            prefetch={true}
            className="hidden md:flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 transition"
            style={{ direction: "rtl" }}
            aria-label="המספר בתהליך אימות — מעבר למסלול מכירה"
          >
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-orange-500" />
            </span>
            <span>המספר בתהליך אימות, בינתיים בוא נבנה את זואי!</span>
          </Link>
        ) : null}
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

