"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { dashboardLangFromParam } from "@/lib/dashboard-lang";

const i18n = {
  he: { logoAlt: (name: string) => `${name} לוגו` },
  en: { logoAlt: (name: string) => `${name} logo` },
} as const;

type BusinessBrandProps = {
  logoUrl: string | null;
  businessName: string;
};

export default function BusinessBrand({ logoUrl, businessName }: BusinessBrandProps) {
  const searchParams = useSearchParams();
  const lang = dashboardLangFromParam(searchParams.get("lang"));
  const t = i18n[lang];
  const [hideLogo, setHideLogo] = useState(false);
  const safeLogoUrl = (() => {
    if (!logoUrl) return null;
    try {
      const u = new URL(logoUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return logoUrl;
    } catch {
      return null;
    }
  })();

  if (!safeLogoUrl || hideLogo) {
    return <p className="text-center text-base font-semibold text-neutral-700">{businessName}</p>;
  }

  return (
    <img
      src={safeLogoUrl}
      alt={t.logoAlt(businessName)}
      className="h-20 w-20 rounded-full object-contain border border-neutral-200 bg-white shadow-sm"
      style={{ imageRendering: "auto" }}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (img.naturalWidth < 56 || img.naturalHeight < 56) {
          setHideLogo(true);
        }
      }}
      onError={() => setHideLogo(true)}
    />
  );
}
