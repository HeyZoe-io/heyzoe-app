"use client";

import { useEffect } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dashboardDir, type DashboardLang } from "@/lib/dashboard-lang";
import { dashboardSettingsT } from "@/lib/dashboard-settings-i18n";
import {
  SALES_PATH_TEXTAREA,
  SalesPathFieldLabel,
  SalesPathSectionBlock,
  SalesPathStepShell,
  useSalesPathSections,
} from "./sales-path-shell";

type SectionId = "messages";

export type FollowupStepPanelProps = {
  lang?: DashboardLang;
  waSalesFollowup1: string;
  setWaSalesFollowup1: (v: string) => void;
  waSalesFollowup2: string;
  setWaSalesFollowup2: (v: string) => void;
  waSalesFollowup3: string;
  setWaSalesFollowup3: (v: string) => void;
  busyAction: string | null;
  onApplyDefaults: () => void | Promise<void>;
};

function FollowupTextarea({
  lang,
  value,
  onChange,
  rows,
}: {
  lang: DashboardLang;
  value: string;
  onChange: (v: string) => void;
  rows: number;
}) {
  return (
    <textarea
      dir={dashboardDir(lang)}
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={SALES_PATH_TEXTAREA}
    />
  );
}

export function FollowupStepPanel(props: FollowupStepPanelProps) {
  const {
    lang = "he",
    waSalesFollowup1,
    setWaSalesFollowup1,
    waSalesFollowup2,
    setWaSalesFollowup2,
    waSalesFollowup3,
    setWaSalesFollowup3,
    busyAction,
    onApplyDefaults,
  } = props;
  const t = dashboardSettingsT(lang);
  const sections = [{ id: "messages" as const, label: t.followup.sections.messages.label, hint: t.followup.sections.messages.hint }];

  const { openSections, toggle, scrollToSection, activeNav, mainRef, setStepPrefix } =
    useSalesPathSections<SectionId>(sections, { messages: true });

  useEffect(() => {
    setStepPrefix("followup");
  }, [setStepPrefix]);

  const resetting = busyAction === "followup:defaults";

  return (
    <SalesPathStepShell
      stepNumber={5}
      title={t.followup.title}
      description={t.followup.description}
      stepPrefix="followup"
      sections={sections}
      activeNav={activeNav}
      onNavClick={scrollToSection}
      mainRef={mainRef}
      navAriaLabel={t.followup.navAria}
      lang={lang}
    >
      <SalesPathSectionBlock
        stepPrefix="followup"
        id="messages"
        title={t.followup.messages}
        open={openSections.messages}
        onToggle={() => toggle("messages")}
        filled={
          Boolean(waSalesFollowup1.trim()) ||
          Boolean(waSalesFollowup2.trim()) ||
          Boolean(waSalesFollowup3.trim())
        }
        headerAction={
          <Button
            type="button"
            variant="outline"
            className="gap-1 text-xs py-1.5 px-3 h-auto"
            disabled={resetting}
            onClick={() => void onApplyDefaults()}
          >
            {resetting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {t.followup.resetDefaults}
          </Button>
        }
      >
        <div>
          <SalesPathFieldLabel>{t.followup.msg1}</SalesPathFieldLabel>
          <FollowupTextarea lang={lang} value={waSalesFollowup1} onChange={setWaSalesFollowup1} rows={5} />
        </div>
        <div>
          <SalesPathFieldLabel>{t.followup.msg2}</SalesPathFieldLabel>
          <FollowupTextarea lang={lang} value={waSalesFollowup2} onChange={setWaSalesFollowup2} rows={5} />
        </div>
        <div>
          <SalesPathFieldLabel>{t.followup.msg3}</SalesPathFieldLabel>
          <FollowupTextarea lang={lang} value={waSalesFollowup3} onChange={setWaSalesFollowup3} rows={6} />
        </div>
      </SalesPathSectionBlock>
    </SalesPathStepShell>
  );
}
