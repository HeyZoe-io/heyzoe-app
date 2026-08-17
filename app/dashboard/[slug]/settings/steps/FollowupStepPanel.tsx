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
  waSalesFollowup1Enabled: boolean;
  setWaSalesFollowup1Enabled: (v: boolean) => void;
  waSalesFollowup2Enabled: boolean;
  setWaSalesFollowup2Enabled: (v: boolean) => void;
  waSalesFollowup3Enabled: boolean;
  setWaSalesFollowup3Enabled: (v: boolean) => void;
  busyAction: string | null;
  onApplyDefaults: () => void | Promise<void>;
};

function FollowupToggle({
  checked,
  onChange,
  labelOn,
  labelOff,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  labelOn: string;
  labelOff: string;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        checked
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-zinc-200 bg-white text-zinc-600"
      }`}
    >
      <span>{checked ? labelOn : labelOff}</span>
      <span
        className={`h-4 w-7 rounded-full p-0.5 transition-colors ${
          checked ? "bg-emerald-500" : "bg-zinc-300"
        }`}
        aria-hidden
      >
        <span
          className={`block h-3 w-3 rounded-full bg-white transition-transform ${
            checked ? "translate-x-0" : "-translate-x-3"
          }`}
        />
      </span>
    </button>
  );
}

function FollowupTextarea({
  lang,
  value,
  onChange,
  rows,
  disabled,
}: {
  lang: DashboardLang;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  disabled?: boolean;
}) {
  return (
    <textarea
      dir={dashboardDir(lang)}
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${SALES_PATH_TEXTAREA}${disabled ? " opacity-50" : ""}`}
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
    waSalesFollowup1Enabled,
    setWaSalesFollowup1Enabled,
    waSalesFollowup2Enabled,
    setWaSalesFollowup2Enabled,
    waSalesFollowup3Enabled,
    setWaSalesFollowup3Enabled,
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
          <SalesPathFieldLabel
            action={
              <FollowupToggle
                checked={waSalesFollowup1Enabled}
                onChange={setWaSalesFollowup1Enabled}
                labelOn={t.followup.enabledOn}
                labelOff={t.followup.enabledOff}
                ariaLabel={t.followup.enabledAria(1)}
              />
            }
          >
            {t.followup.msg1}
          </SalesPathFieldLabel>
          {!waSalesFollowup1Enabled ? (
            <p className="mb-1.5 text-[11px] text-zinc-500">{t.followup.disabledHint}</p>
          ) : null}
          <FollowupTextarea
            lang={lang}
            value={waSalesFollowup1}
            onChange={setWaSalesFollowup1}
            rows={5}
            disabled={!waSalesFollowup1Enabled}
          />
        </div>
        <div>
          <SalesPathFieldLabel
            action={
              <FollowupToggle
                checked={waSalesFollowup2Enabled}
                onChange={setWaSalesFollowup2Enabled}
                labelOn={t.followup.enabledOn}
                labelOff={t.followup.enabledOff}
                ariaLabel={t.followup.enabledAria(2)}
              />
            }
          >
            {t.followup.msg2}
          </SalesPathFieldLabel>
          {!waSalesFollowup2Enabled ? (
            <p className="mb-1.5 text-[11px] text-zinc-500">{t.followup.disabledHint}</p>
          ) : null}
          <FollowupTextarea
            lang={lang}
            value={waSalesFollowup2}
            onChange={setWaSalesFollowup2}
            rows={5}
            disabled={!waSalesFollowup2Enabled}
          />
        </div>
        <div>
          <SalesPathFieldLabel
            action={
              <FollowupToggle
                checked={waSalesFollowup3Enabled}
                onChange={setWaSalesFollowup3Enabled}
                labelOn={t.followup.enabledOn}
                labelOff={t.followup.enabledOff}
                ariaLabel={t.followup.enabledAria(3)}
              />
            }
          >
            {t.followup.msg3}
          </SalesPathFieldLabel>
          {!waSalesFollowup3Enabled ? (
            <p className="mb-1.5 text-[11px] text-zinc-500">{t.followup.disabledHint}</p>
          ) : null}
          <FollowupTextarea
            lang={lang}
            value={waSalesFollowup3}
            onChange={setWaSalesFollowup3}
            rows={6}
            disabled={!waSalesFollowup3Enabled}
          />
        </div>
      </SalesPathSectionBlock>
    </SalesPathStepShell>
  );
}
