"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import UserMenu from "@/app/components/UserMenu";
import {
  SalesPathSubNav,
  dashboardMainTabClass,
} from "@/app/dashboard/[slug]/settings/settings-ui";
import { dashboardDir, dashboardHref, dashboardLangFromParam } from "@/lib/dashboard-lang";
import { settingsStepHref } from "@/lib/dashboard-settings-i18n";
import { useSettingsGuardedLinkClick } from "@/app/[slug]/settings/settings-unsaved-context";

const i18n = {
  he: {
    salesPath: "מסלול מכירה",
    conversations: "שיחות",
    leads: "לידים",
    analytics: "אנליטיקס",
    logoAria: "HeyZoe — לדשבורד",
    navAria: "אזורי דשבורד",
    verifyBannerAria: "המספר בתהליך אימות — מעבר למסלול מכירה",
    verifyBannerText: "המספר בתהליך אימות, בינתיים בוא נבנה את זואי!",
  },
  en: {
    salesPath: "Sales Path",
    conversations: "Conversations",
    leads: "Leads",
    analytics: "Analytics",
    logoAria: "HeyZoe — Dashboard",
    navAria: "Dashboard sections",
    verifyBannerAria: "Phone number verification in progress — go to Sales Path",
    verifyBannerText: "Phone number verification in progress — let's build Zoe in the meantime!",
  },
} as const;

function SlugDashboardNavInner({ slug }: { slug: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lang = dashboardLangFromParam(searchParams.get("lang"));
  const t = i18n[lang];
  const base = `/${slug}`;
  const guardedLinkClick = useSettingsGuardedLinkClick();
  const [metaStatus, setMetaStatus] = useState<null | "CONNECTED" | "PENDING" | "UNVERIFIED" | "not_provisioned">(null);

  const items: { href: string; label: string }[] = [
    { href: dashboardHref(`${base}/settings`, lang), label: t.salesPath },
    { href: dashboardHref(`${base}/conversations`, lang), label: t.conversations },
    { href: dashboardHref(`${base}/contacts`, lang), label: t.leads },
    { href: dashboardHref(`${base}/analytics`, lang), label: t.analytics },
  ];

  useEffect(() => {
    let mounted = true;
    let intervalId: number | null = null;

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

    const startPolling = () => {
      if (intervalId !== null) return;
      void fetchStatus();
      intervalId = window.setInterval(fetchStatus, 15_000);
    };

    const stopPolling = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibility = () => {
      if (document.hidden) stopPolling();
      else startPolling();
    };

    if (!document.hidden) startPolling();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      mounted = false;
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [slug]);

  return (
    <header className="mb-5 border-0 shadow-none">
      <div className="relative flex items-center justify-between gap-3 pb-2 min-h-[48px] sm:min-h-[52px]">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3 z-[1]">
          <Link
            href={dashboardHref(`${base}/analytics`, lang)}
            prefetch={true}
            onClick={(e) => guardedLinkClick(e, dashboardHref(`${base}/analytics`, lang))}
            className="hidden sm:flex items-center select-none shrink-0"
            aria-label={t.logoAria}
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
          <UserMenu slug={slug} />
          {metaStatus === "PENDING" ? (
            <Link
              href={settingsStepHref(`${base}/settings`, 1, lang)}
              prefetch={true}
              onClick={(e) =>
                guardedLinkClick(e, settingsStepHref(`${base}/settings`, 1, lang))
              }
              className="hidden lg:flex items-center gap-2 text-xs font-light text-orange-700 hover:text-orange-800 transition"
              style={{ direction: dashboardDir(lang) }}
              aria-label={t.verifyBannerAria}
            >
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-orange-500" />
              </span>
              <span>{t.verifyBannerText}</span>
            </Link>
          ) : null}
        </div>

        <nav
          className="absolute left-1/2 top-1/2 z-[2] flex w-max max-w-[calc(100vw-5rem)] sm:max-w-[min(100%,calc(100vw-14rem))] -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-4 overflow-x-auto px-1 sm:gap-8"
          aria-label={t.navAria}
        >
          {items.map((item) => {
            const active = pathname === item.href.split("?")[0];
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={true}
                onClick={(e) => guardedLinkClick(e, item.href)}
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

export default function SlugDashboardNav({ slug }: { slug: string }) {
  return (
    <Suspense fallback={null}>
      <SlugDashboardNavInner slug={slug} />
    </Suspense>
  );
}
