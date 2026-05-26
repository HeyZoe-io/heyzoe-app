"use client";

import { useEffect, useMemo } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SALES_PATH_INPUT,
  SalesPathFieldLabel,
  SalesPathSectionBlock,
  SalesPathStepShell,
  useSalesPathSections,
} from "./sales-path-shell";

type SectionId = "website" | "booking" | "social";

const SECTIONS: { id: SectionId; label: string; hint: string }[] = [
  { id: "website", label: "אתר", hint: "סריקה אוטומטית" },
  { id: "booking", label: "קישורים", hint: "שעות ומנויים" },
  { id: "social", label: "רשתות", hint: "אינסטגרם" },
];

export type LinksStepPanelProps = {
  websiteUrl: string;
  setWebsiteUrl: (v: string) => void;
  fetchSite: () => void | Promise<void>;
  fetchingUrl: boolean;
  fetchSiteError: string;
  fetchSiteNotice: string;
  arboxLink: string;
  setArboxLink: (v: string) => void;
  scheduleDirectRegistration: boolean;
  setScheduleDirectRegistration: (v: boolean) => void;
  membershipsUrl: string;
  setMembershipsUrl: (v: string) => void;
  instagramUrl: string;
  setInstagramUrl: (v: string) => void;
  instagramIcon: React.ReactNode;
};

export function LinksStepPanel(props: LinksStepPanelProps) {
  const {
    websiteUrl,
    setWebsiteUrl,
    fetchSite,
    fetchingUrl,
    fetchSiteError,
    fetchSiteNotice,
    arboxLink,
    setArboxLink,
    scheduleDirectRegistration,
    setScheduleDirectRegistration,
    membershipsUrl,
    setMembershipsUrl,
    instagramUrl,
    setInstagramUrl,
    instagramIcon,
  } = props;

  const { openSections, toggle, scrollToSection, activeNav, mainRef, setStepPrefix } =
    useSalesPathSections<SectionId>(SECTIONS, { website: true, booking: false, social: false });

  useEffect(() => {
    setStepPrefix("links");
  }, [setStepPrefix]);

  const filled = useMemo(
    () => ({
      website: Boolean(websiteUrl.trim()),
      booking: Boolean(arboxLink.trim() || membershipsUrl.trim()),
      social: Boolean(instagramUrl.trim()),
    }),
    [websiteUrl, arboxLink, membershipsUrl, instagramUrl]
  );

  return (
    <SalesPathStepShell
      stepNumber={1}
      title="לינקים"
      description="זואי תג׳נרט מידע אוטומטית ותשלח לינקים רלוונטים ללידים."
      stepPrefix="links"
      sections={SECTIONS}
      activeNav={activeNav}
      onNavClick={scrollToSection}
      mainRef={mainRef}
      navAriaLabel="ניווט בתוך לינקים"
    >
      <SalesPathSectionBlock
        stepPrefix="links"
        id="website"
        title="לינק לאתר"
        hint="סרקו והמתינו דקה ליצירת תוכן אוטומטית"
        open={openSections.website}
        onToggle={() => toggle("website")}
        filled={filled.website}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input
            dir="ltr"
            placeholder="https://your-business.com"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void fetchSite()}
            className={cnInputLtr()}
          />
          <Button
            onClick={() => void fetchSite()}
            disabled={!websiteUrl || fetchingUrl}
            className="shrink-0 gap-2"
          >
            {fetchingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {fetchingUrl ? "סורק..." : "סרוק"}
          </Button>
        </div>
        {fetchingUrl ? (
          <p className="text-sm text-[#7133da] flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            מנתח את האתר - זה לוקח כמה שניות...
          </p>
        ) : null}
        {fetchSiteError ? (
          <p className="text-sm text-red-600" role="alert">
            {fetchSiteError}
          </p>
        ) : null}
        {fetchSiteNotice ? (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            {fetchSiteNotice}
          </p>
        ) : null}
      </SalesPathSectionBlock>

      <SalesPathSectionBlock
        stepPrefix="links"
        id="booking"
        title="קישורי מערכת"
        open={openSections.booking}
        onToggle={() => toggle("booking")}
        filled={filled.booking}
      >
        <div>
          <SalesPathFieldLabel>לינק מערכת שעות</SalesPathFieldLabel>
          <Input
            dir="ltr"
            value={arboxLink}
            onChange={(e) => setArboxLink(e.target.value)}
            placeholder="https://..."
            className={SALES_PATH_INPUT}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-100 bg-zinc-50/60 px-3 py-2">
            <span className="text-sm font-medium text-zinc-800">הרשמה ישירות מהמערכת?</span>
            <button
              type="button"
              role="switch"
              aria-checked={scheduleDirectRegistration}
              onClick={() => setScheduleDirectRegistration(!scheduleDirectRegistration)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                scheduleDirectRegistration
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-zinc-200 bg-white text-zinc-600"
              }`}
            >
              <span>{scheduleDirectRegistration ? "כן" : "לא"}</span>
              <span
                className={`h-4 w-7 rounded-full p-0.5 transition-colors ${
                  scheduleDirectRegistration ? "bg-emerald-500" : "bg-zinc-300"
                }`}
                aria-hidden
              >
                <span
                  className={`block h-3 w-3 rounded-full bg-white transition-transform ${
                    scheduleDirectRegistration ? "translate-x-0" : "-translate-x-3"
                  }`}
                />
              </span>
            </button>
          </div>
        </div>
        <div>
          <SalesPathFieldLabel>לינק לדף מנויים וכרטיסיות</SalesPathFieldLabel>
          <Input
            dir="ltr"
            value={membershipsUrl}
            onChange={(e) => setMembershipsUrl(e.target.value)}
            placeholder="https://..."
            className={SALES_PATH_INPUT}
          />
        </div>
      </SalesPathSectionBlock>

      <SalesPathSectionBlock
        stepPrefix="links"
        id="social"
        title="לינק לאינסטגרם"
        open={openSections.social}
        onToggle={() => toggle("social")}
        filled={filled.social}
      >
        <div className="flex flex-row-reverse gap-2 items-stretch">
          <span
            className="flex items-center justify-center w-11 shrink-0 rounded-lg border border-zinc-200 bg-gradient-to-br from-fuchsia-500/10 to-pink-500/15 text-pink-600"
            aria-hidden
          >
            {instagramIcon}
          </span>
          <Input
            dir="ltr"
            className={cnInputLtr("flex-1 min-w-0")}
            placeholder="https://instagram.com/..."
            value={instagramUrl}
            onChange={(e) => setInstagramUrl(e.target.value)}
          />
        </div>
      </SalesPathSectionBlock>
    </SalesPathStepShell>
  );
}

function cnInputLtr(extra?: string) {
  return [SALES_PATH_INPUT, "text-left font-mono text-sm", extra].filter(Boolean).join(" ");
}
