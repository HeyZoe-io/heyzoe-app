"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CRM_TYPE_OPTIONS, type CrmType } from "@/lib/crm/types";
import { dashboardDir, type DashboardLang } from "@/lib/dashboard-lang";
import { dashboardSettingsT } from "@/lib/dashboard-settings-i18n";
import {
  SALES_PATH_INPUT,
  SalesPathFieldLabel,
  SalesPathSectionBlock,
  SalesPathStepShell,
  useSalesPathSections,
} from "./sales-path-shell";

type SectionId = "website" | "booking" | "crm" | "social";

export type LinksStepPanelProps = {
  lang?: DashboardLang;
  websiteUrl: string;
  setWebsiteUrl: (v: string) => void;
  fetchSite: () => void | Promise<void>;
  fetchingUrl: boolean;
  fetchSiteError: string;
  fetchSiteNotice: string;
  arboxLink: string;
  setArboxLink: (v: string) => void;
  scheduleScanImageUrl: string;
  setScheduleScanImageUrl: (v: string) => void;
  scheduleScanMediaInputRef: React.RefObject<HTMLInputElement | null>;
  uploadingScheduleScanMedia: boolean;
  scheduleScanMediaUploadError: string;
  uploadMedia: (file: File, target: "opening" | "directions" | "schedule_cta" | "schedule_scan") => Promise<void>;
  scheduleDirectRegistration: boolean;
  setScheduleDirectRegistration: (v: boolean) => void;
  membershipsUrl: string;
  setMembershipsUrl: (v: string) => void;
  instagramUrl: string;
  setInstagramUrl: (v: string) => void;
  instagramIcon: React.ReactNode;
  crmType: CrmType;
  setCrmType: (v: CrmType) => void;
  crmApiKey: string;
  setCrmApiKey: (v: string) => void;
  crmBoxId: string;
  setCrmBoxId: (v: string) => void;
  crmArboxSourceId: string;
  setCrmArboxSourceId: (v: string) => void;
  crmArboxStatusId: string;
  setCrmArboxStatusId: (v: string) => void;
};

function CrmFieldHint({ text, lang, explainAria }: { text: string; lang: DashboardLang; explainAria: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-label={explainAria}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zinc-200/90 text-[10px] font-bold leading-none text-zinc-600 hover:bg-zinc-300/90"
      >
        ?
      </button>
      {open ? (
        <span
          role="tooltip"
          dir={dashboardDir(lang)}
          className={`absolute right-0 top-full z-50 mt-1.5 w-[min(18rem,calc(100vw-2.5rem))] rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-[11px] leading-snug text-zinc-600 shadow-md ${lang === "en" ? "text-left" : "text-right"}`}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

export function LinksStepPanel(props: LinksStepPanelProps) {
  const {
    lang = "he",
    websiteUrl,
    setWebsiteUrl,
    fetchSite,
    fetchingUrl,
    fetchSiteError,
    fetchSiteNotice,
    arboxLink,
    setArboxLink,
    scheduleScanImageUrl,
    setScheduleScanImageUrl,
    scheduleScanMediaInputRef,
    uploadingScheduleScanMedia,
    scheduleScanMediaUploadError,
    uploadMedia,
    scheduleDirectRegistration,
    setScheduleDirectRegistration,
    membershipsUrl,
    setMembershipsUrl,
    instagramUrl,
    setInstagramUrl,
    instagramIcon,
    crmType,
    setCrmType,
    crmApiKey,
    setCrmApiKey,
    crmBoxId,
    setCrmBoxId,
    crmArboxSourceId,
    setCrmArboxSourceId,
    crmArboxStatusId,
    setCrmArboxStatusId,
  } = props;
  const t = dashboardSettingsT(lang);
  const sections = useMemo(
    () => [
      { id: "website" as const, label: t.links.sections.website.label, hint: t.links.sections.website.hint },
      { id: "booking" as const, label: t.links.sections.booking.label, hint: t.links.sections.booking.hint },
      { id: "crm" as const, label: t.links.sections.crm.label, hint: t.links.sections.crm.hint },
      { id: "social" as const, label: t.links.sections.social.label, hint: t.links.sections.social.hint },
    ],
    [t]
  );

  const { openSections, toggle, scrollToSection, activeNav, mainRef, setStepPrefix } =
    useSalesPathSections<SectionId>(sections, { website: true, booking: false, crm: false, social: false });

  useEffect(() => {
    setStepPrefix("links");
  }, [setStepPrefix]);

  const filled = useMemo(
    () => ({
      website: Boolean(websiteUrl.trim()),
      booking: Boolean(arboxLink.trim() || membershipsUrl.trim()),
      crm: Boolean(crmType && crmApiKey.trim()),
      social: Boolean(instagramUrl.trim()),
    }),
    [websiteUrl, arboxLink, membershipsUrl, crmType, crmApiKey, crmBoxId, instagramUrl]
  );

  return (
    <SalesPathStepShell
      stepNumber={1}
      title={t.links.title}
      description={t.links.description}
      stepPrefix="links"
      sections={sections}
      activeNav={activeNav}
      onNavClick={scrollToSection}
      mainRef={mainRef}
      navAriaLabel={t.links.navAria}
      lang={lang}
    >
      <SalesPathSectionBlock
        stepPrefix="links"
        id="website"
        title={t.links.websiteLink}
        hint={t.links.websiteHint}
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
            {fetchingUrl ? t.scanning : t.scan}
          </Button>
        </div>
        {fetchingUrl ? (
          <p className="text-sm text-[#7133da] flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t.links.analyzing}
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
        title={t.links.bookingLinks}
        open={openSections.booking}
        onToggle={() => toggle("booking")}
        filled={filled.booking}
        titleAction={
          <>
            <input
              ref={scheduleScanMediaInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                void uploadMedia(f, "schedule_scan");
                e.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              className={[
                "text-xs font-semibold underline underline-offset-4",
                "text-[#2f6feb] hover:text-[#1f5bd6]",
                "disabled:opacity-60 disabled:no-underline",
              ].join(" ")}
              onClick={() => scheduleScanMediaInputRef.current?.click()}
              disabled={uploadingScheduleScanMedia}
              title={t.links.uploadScheduleImageTitle}
            >
              {uploadingScheduleScanMedia ? t.uploading : t.links.uploadScheduleImage}
            </button>
          </>
        }
      >
        <div>
          <SalesPathFieldLabel>{t.links.scheduleLink}</SalesPathFieldLabel>
          <Input
            dir="ltr"
            value={arboxLink}
            onChange={(e) => setArboxLink(e.target.value)}
            placeholder="https://..."
            className={SALES_PATH_INPUT}
          />
          {scheduleScanImageUrl.trim() ? (
            <div className="mt-3 rounded-xl border border-[#7133da]/15 bg-[#f9f6ff]/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2" dir={dashboardDir(lang)}>
                <p className="text-xs font-semibold text-zinc-800">{t.links.scheduleImagePreferred}</p>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs border-zinc-200 bg-white hover:bg-red-50/70 text-red-600"
                  onClick={() => setScheduleScanImageUrl("")}
                >
                  {t.remove}
                </Button>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={scheduleScanImageUrl.trim()}
                alt=""
                className="mt-2 w-full max-h-52 rounded-lg object-contain bg-white"
              />
              <p className="mt-2 text-[11px] text-zinc-500 leading-snug" dir={dashboardDir(lang)}>
                {t.links.scheduleImageTip}
              </p>
            </div>
          ) : null}
          {scheduleScanMediaUploadError ? (
            <p className="mt-2 text-sm text-red-600" role="alert">
              {scheduleScanMediaUploadError}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-100 bg-zinc-50/60 px-3 py-2">
            <span className="text-sm font-medium text-zinc-800">{t.links.directRegistration}</span>
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
              <span>{scheduleDirectRegistration ? t.yes : t.no}</span>
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
          <SalesPathFieldLabel>{t.links.membershipsLink}</SalesPathFieldLabel>
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
        id="crm"
        title={t.links.crmTitle}
        hint={t.links.crmHint}
        open={openSections.crm}
        onToggle={() => toggle("crm")}
        filled={filled.crm}
      >
        <p className="text-[11px] leading-snug text-zinc-500">
          {t.links.crmIntro}
        </p>
        <div>
          <SalesPathFieldLabel>{t.links.crmType}</SalesPathFieldLabel>
          <select
            value={crmType}
            onChange={(e) => setCrmType(e.target.value as CrmType)}
            className={`${SALES_PATH_INPUT} w-full px-3 text-right`}
            dir={dashboardDir(lang)}
          >
            {CRM_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value || "none"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {crmType ? (
          <div className="space-y-4">
            <div>
              <SalesPathFieldLabel>{t.links.apiKey}</SalesPathFieldLabel>
              <Input
                dir="ltr"
                type="password"
                autoComplete="off"
                value={crmApiKey}
                onChange={(e) => setCrmApiKey(e.target.value)}
                placeholder={t.links.apiKeyPlaceholder}
                className={cnInputLtr()}
              />
            </div>
            {crmType === "arbox" ? (
              <div className="space-y-4">
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-medium text-zinc-800">{t.links.branchId}</span>
                    <CrmFieldHint text={t.links.branchIdHint} lang={lang} explainAria={t.explainAria} />
                  </div>
                  <Input
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="off"
                    value={crmBoxId}
                    onChange={(e) => setCrmBoxId(e.target.value)}
                    placeholder="0000"
                    className={cnInputLtr()}
                  />
                </div>
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-medium text-zinc-800">{t.links.leadStatus}</span>
                    <CrmFieldHint text={t.links.leadStatusHint} lang={lang} explainAria={t.explainAria} />
                  </div>
                  <Input
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="off"
                    value={crmArboxStatusId}
                    onChange={(e) => setCrmArboxStatusId(e.target.value)}
                    placeholder="00000"
                    className={cnInputLtr()}
                  />
                </div>
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-medium text-zinc-800">{t.links.leadSource}</span>
                    <CrmFieldHint text={t.links.leadSourceHint} lang={lang} explainAria={t.explainAria} />
                  </div>
                  <Input
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="off"
                    value={crmArboxSourceId}
                    onChange={(e) => setCrmArboxSourceId(e.target.value)}
                    placeholder="00000"
                    className={cnInputLtr()}
                  />
                </div>
              </div>
            ) : null}
            <p className="text-[11px] leading-snug text-zinc-500">
              {t.links.apiKeySecure}
            </p>
          </div>
        ) : (
          <p className="text-[11px] leading-snug text-zinc-500">{t.links.selectCrm}</p>
        )}
      </SalesPathSectionBlock>

      <SalesPathSectionBlock
        stepPrefix="links"
        id="social"
        title={t.links.instagramLink}
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
