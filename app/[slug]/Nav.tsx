"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import UserMenu from "@/app/components/UserMenu";
import {
  SalesPathSubNav,
  dashboardMainTabClass,
} from "@/app/dashboard/[slug]/settings/settings-ui";

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
    <header className="mb-5 border-0 shadow-none">
      <div className="relative flex items-center justify-between gap-3 pb-2 min-h-[48px] sm:min-h-[52px]">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3 z-[1]">
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
              className="hidden lg:flex items-center gap-2 text-xs font-light text-orange-700 hover:text-orange-800 transition"
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
          className="absolute left-1/2 top-1/2 z-[2] flex w-max max-w-[calc(100vw-5rem)] sm:max-w-[min(100%,calc(100vw-14rem))] -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-4 overflow-x-auto px-1 sm:gap-8"
          aria-label="אזורי דשבורד"
        >
          {items.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={true}
                className={dashboardMainTabClass(active)}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* מאזן ויזואלי מול לוגו + משתמש */}
        <div className="hidden sm:block w-[88px] shrink-0 z-[1]" aria-hidden="true" />
      </div>
      <Suspense fallback={null}>
        <SalesPathSubNav slug={slug} />
      </Suspense>
    </header>
  );
}
