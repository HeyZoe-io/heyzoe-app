"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  formatAgorot,
  META_PRICING_NOTICE_KEY,
  META_RATES_IL,
  metaMonthlyExampleBillableMessages,
  metaMonthlyExampleIls,
  metaMonthlyExampleMessages,
  usdRateToAgorot,
  usdRateToIls,
} from "@/lib/meta-pricing-notice";

export type MetaPricingNoticeData = {
  acknowledged: boolean;
  businessSlug: string;
  businessName: string;
  userName: string;
  /** Platform admin (isAdminAllowedEmail) — may dismiss without acknowledging. UI-only; never persisted. */
  isPlatformAdmin: boolean;
};

function MetaPricingFlowDiagram() {
  const serviceAgorot = formatAgorot(usdRateToAgorot(META_RATES_IL.service));
  const exampleMessages = metaMonthlyExampleMessages().toLocaleString("en-US");
  const exampleIls = metaMonthlyExampleIls();
  const freeTier = META_RATES_IL.freeServiceMessagesPerNumberPerMonth.toLocaleString("en-US");

  return (
    <svg width="100%" viewBox="0 0 520 450" preserveAspectRatio="xMidYMid meet" role="img">
      <title>עדכון מחירי מטא החל מ-1.10.26</title>
      <desc>
        ליד ממודעת Click to WhatsApp מקבל 72 שעות חינם, וליד מכל מקור אחר מחויב כ-{serviceAgorot} אגורות לכל הודעה
        יוצאת אחרי {freeTier} הודעות שירות חינם בחודש לכל מספר עסקי
      </desc>
      <defs>
        <marker id="arrow2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path
            d="M2 1L8 5L2 9"
            fill="none"
            stroke="context-stroke"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </marker>
      </defs>

      <rect x="165" y="20" width="190" height="48" rx="8" fill="#F4E9FC" stroke="#bc74e9" strokeWidth="0.5" />
      <text x="260" y="44" textAnchor="middle" dominantBaseline="central" direction="rtl" fill="#52246F" fontSize="15.5" fontWeight="500">
        ליד פותח שיחה
      </text>

      <path d="M260 68 L260 86 L390 86 L390 108" fill="none" stroke="#bc74e9" strokeWidth="1.5" markerEnd="url(#arrow2)" />
      <path d="M260 68 L260 86 L130 86 L130 108" fill="none" stroke="#bc74e9" strokeWidth="1.5" markerEnd="url(#arrow2)" />

      <rect x="275" y="108" width="230" height="62" rx="8" fill="#F4E9FC" stroke="#bc74e9" strokeWidth="0.5" />
      <text x="390" y="130" textAnchor="middle" dominantBaseline="central" direction="rtl" fill="#52246F" fontSize="15.5" fontWeight="500">
        ממודעת Click to WhatsApp
      </text>
      <text x="390" y="152" textAnchor="middle" dominantBaseline="central" direction="rtl" fill="#7A3FA3" fontSize="13">
        קמפיין למטרת וואטסאפ
      </text>

      <rect x="15" y="108" width="230" height="62" rx="8" fill="#F4E9FC" stroke="#bc74e9" strokeWidth="0.5" />
      <text x="130" y="130" textAnchor="middle" dominantBaseline="central" direction="rtl" fill="#52246F" fontSize="15.5" fontWeight="500">
        מכל מקור אחר
      </text>
      <text x="130" y="152" textAnchor="middle" dominantBaseline="central" direction="rtl" fill="#7A3FA3" fontSize="13">
        אתר, טופס לידים, קישור וכו׳
      </text>

      <line x1="390" y1="170" x2="390" y2="208" stroke="#bc74e9" strokeWidth="1.5" markerEnd="url(#arrow2)" />
      <line x1="130" y1="170" x2="130" y2="208" stroke="#bc74e9" strokeWidth="1.5" markerEnd="url(#arrow2)" />

      <rect x="275" y="208" width="230" height="62" rx="8" fill="#bc74e9" stroke="#9B4FCB" strokeWidth="0.5" />
      <text x="390" y="230" textAnchor="middle" dominantBaseline="central" direction="rtl" fill="#FFFFFF" fontSize="15.5" fontWeight="500">
        72 שעות חינם
      </text>
      <text x="390" y="252" textAnchor="middle" dominantBaseline="central" direction="rtl" fill="#FFFFFF" fontSize="13">
        כל ההודעות, כולל תבניות
      </text>

      <rect x="15" y="208" width="230" height="62" rx="8" fill="#F4E9FC" stroke="#bc74e9" strokeWidth="0.5" />
      <text x="130" y="230" textAnchor="middle" dominantBaseline="central" direction="rtl" fill="#52246F" fontSize="15.5" fontWeight="500">
        24 שעות בתשלום
      </text>
      <text x="130" y="252" textAnchor="middle" dominantBaseline="central" direction="rtl" fill="#7A3FA3" fontSize="13">
        כ-{serviceAgorot} אגורות לכל הודעה
      </text>

      <line x1="390" y1="270" x2="390" y2="308" stroke="#bc74e9" strokeWidth="1.5" markerEnd="url(#arrow2)" />
      <line x1="130" y1="270" x2="130" y2="308" stroke="#bc74e9" strokeWidth="1.5" markerEnd="url(#arrow2)" />

      <rect x="275" y="308" width="230" height="62" rx="8" fill="#F4E9FC" stroke="#bc74e9" strokeWidth="0.5" />
      <text x="390" y="330" textAnchor="middle" dominantBaseline="central" direction="rtl" fill="#52246F" fontSize="15.5" fontWeight="500">
        אחרי 72 השעות
      </text>
      <text x="390" y="352" textAnchor="middle" dominantBaseline="central" direction="rtl" fill="#7A3FA3" fontSize="13">
        כ-{serviceAgorot} אגורות לכל הודעה
      </text>

      <rect x="15" y="308" width="230" height="62" rx="8" fill="#F4E9FC" stroke="#bc74e9" strokeWidth="0.5" />
      <text x="130" y="330" textAnchor="middle" dominantBaseline="central" direction="rtl" fill="#52246F" fontSize="15.5" fontWeight="500">
        200 שיחות × 8 הודעות
      </text>
      <text x="130" y="352" textAnchor="middle" dominantBaseline="central" direction="rtl" fill="#7A3FA3" fontSize="13">
        {exampleMessages} פחות {freeTier} חינם = כ-{exampleIls} ₪
      </text>

      <text x="260" y="396" textAnchor="middle" direction="rtl" fill="#7A3FA3" fontSize="13">
        {freeTier} הודעות השירות הראשונות בחודש חינם, לכל מספר עסקי
      </text>
      <text x="260" y="416" textAnchor="middle" direction="rtl" fill="#7A3FA3" fontSize="13">
        סגול מלא = חינם · סגול בהיר = בתשלום
      </text>
      <text x="260" y="436" textAnchor="middle" direction="rtl" fill="#9C9A92" fontSize="13">
        התעריף נגבה בדולרים; המרה לשקלים לפי שער 14.9.26
      </text>
    </svg>
  );
}

export default function MetaPricingNoticeModal({ notice }: { notice: MetaPricingNoticeData }) {
  const [acknowledged, setAcknowledged] = useState(notice.acknowledged);
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Admin-only escape hatch: session-local, never written to notice_acknowledgments.
  // Reappears on next load since it's plain component state, not persisted anywhere.
  const [adminDismissed, setAdminDismissed] = useState(false);

  useEffect(() => {
    if (!notice.isPlatformAdmin) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setAdminDismissed(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [notice.isPlatformAdmin]);

  if (acknowledged || adminDismissed) return null;

  const serviceAgorot = formatAgorot(usdRateToAgorot(META_RATES_IL.service));
  const marketingAgorot = formatAgorot(usdRateToAgorot(META_RATES_IL.marketing));
  const freeTier = META_RATES_IL.freeServiceMessagesPerNumberPerMonth.toLocaleString("en-US");
  const exampleMessages = metaMonthlyExampleMessages().toLocaleString("en-US");
  const exampleBillable = metaMonthlyExampleBillableMessages().toLocaleString("en-US");
  const exampleIls = metaMonthlyExampleIls();

  async function handleConfirm() {
    if (!checked || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/notice-acknowledgments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_slug: notice.businessSlug,
          notice_key: META_PRICING_NOTICE_KEY,
        }),
      });
      if (!res.ok) throw new Error(`request_failed (${res.status})`);
      setAcknowledged(true);
    } catch (e) {
      console.error("[MetaPricingNoticeModal] ack failed:", e);
      setError("שמירת האישור נכשלה, נסי שוב");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="meta-pricing-notice-title"
      dir="rtl"
      onClick={notice.isPlatformAdmin ? () => setAdminDismissed(true) : undefined}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-fuchsia-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-6 text-right">
          <div className="flex items-start justify-between gap-3">
            <h2 id="meta-pricing-notice-title" className="text-lg font-semibold text-zinc-900">
              עדכון מחירי מטא
            </h2>
            {notice.isPlatformAdmin ? (
              <button
                type="button"
                aria-label="סגור"
                onClick={() => setAdminDismissed(true)}
                className="shrink-0 rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              >
                ✕
              </button>
            ) : null}
          </div>

          <div className="mt-4">
            <MetaPricingFlowDiagram />
          </div>

          <div className="mt-5 space-y-3 text-sm leading-relaxed text-zinc-700">
            <h3 className="text-base font-semibold text-zinc-900">הנוסח במילים</h3>
            <p>
              <span className="font-semibold text-zinc-900">שיחות ממודעת Click to WhatsApp:</span> חינם למשך 72
              שעות, כולל טמפלייטים (אוטומציות).
            </p>
            <p>
              <span className="font-semibold text-zinc-900">שיחות שהתחילו לא ממודעת Click to WhatsApp:</span> כ-
              {serviceAgorot} אגורות ({usdRateToIls(META_RATES_IL.service)} ₪) להודעה יוצאת, אחרי {freeTier}{" "}
              הודעות שירות חינם בחודש לכל מספר עסקי. החיוב מתחיל מההודעה ה-1,001, והמסגרת מתאפסת בתחילת כל חודש
              ולא נגררת. 200 שיחות בחודש × 8 הודעות = {exampleMessages} הודעות, מהן {exampleBillable} בחיוב = כ-
              {exampleIls} ₪.
            </p>
            <p>
              <span className="font-semibold text-zinc-900">טמפלייטים (אוטומציות) ללא שינוי:</span> כ-{serviceAgorot}{" "}
              אגורות ({usdRateToIls(META_RATES_IL.utility)} ₪) ליוטיליטי, כ-{marketingAgorot} אגורות (
              {usdRateToIls(META_RATES_IL.marketing)} ₪) למרקטינג. התבניות לא נכנסות ל-{freeTier} ההודעות
              החינמיות ומחויבות מההודעה הראשונה.
            </p>
            <p>
              <span className="font-semibold text-zinc-900">לתשומת לבכם:</span> מטא דורשת אמצעי תשלום מעודכן
              בחשבון עד 30.9.2026. חשבון ללא אמצעי תשלום עלול להיחסם ממסירת הודעות שירות מ-1.10.
            </p>
          </div>

          <label className="mt-5 flex items-start gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#bc74e9]"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            <span>קראתי ואני מאשר/ת שהבנתי את השינוי במחירון מטא ואת השלכותיו על עלויות ההודעות.</span>
          </label>

          {error ? (
            <p className="mt-3 text-sm font-medium text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex justify-start">
            <Button type="button" disabled={!checked || submitting} onClick={() => void handleConfirm()}>
              {submitting ? "שומר..." : "מאשר/ת"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
