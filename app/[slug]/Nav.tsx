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
    <header className="mb-2 border-b border-zinc-200/90">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <Link
            href={`${base}/analytics`}
            prefetch={true}
            className="hidden sm:flex items-center select-none shrink-0"
            aria-label="HeyZoe — לדשבורד"
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
              href={`${base}/settings?step=1`}
              prefetch={true}
              className="hidden md:flex items-center gap-2 text-xs font-medium text-orange-700 hover:text-orange-800 transition underline-offset-2 hover:underline"
              style={{ direction: "rtl" }}
              aria-label="המספר בתהליך אימות — מעבר למסלול מכירה"
            >
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-orange-500" />
              </span>
              <span>המספר בתהליך אימות, בינתיים בוא נבנה את זואי!</span>
            </Link>
          ) : null}
        </div>
        <nav
          className="flex min-w-0 flex-1 justify-end gap-0 overflow-x-auto sm:gap-1"
          aria-label="אזורי דשבורד"
        >
          {items.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={true}
                className={
                  "shrink-0 whitespace-nowrap px-3 py-2.5 text-sm transition-colors border-b-2 -mb-px " +
                  (active
                    ? "border-[#7133da] font-semibold text-[#7133da]"
                    : "border-transparent font-medium text-zinc-600 hover:border-zinc-300 hover:text-zinc-900")
                }
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

