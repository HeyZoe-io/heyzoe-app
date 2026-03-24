"use client";

import { useState } from "react";

type BusinessBrandProps = {
  logoUrl: string | null;
  businessName: string;
};

export default function BusinessBrand({ logoUrl, businessName }: BusinessBrandProps) {
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
      alt={`${businessName} לוגו`}
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
