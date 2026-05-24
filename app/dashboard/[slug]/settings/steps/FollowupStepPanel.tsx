"use client";

import { useEffect } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SALES_PATH_TEXTAREA,
  SalesPathFieldLabel,
  SalesPathSectionBlock,
  SalesPathStepShell,
  useSalesPathSections,
} from "./sales-path-shell";

type SectionId = "messages";

const SECTIONS = [{ id: "messages" as const, label: "הודעות", hint: "3 שלבי פולואפ" }];

export type FollowupStepPanelProps = {
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
  value,
  onChange,
  rows,
}: {
  value: string;
  onChange: (v: string) => void;
  rows: number;
}) {
  return (
    <textarea
      dir="rtl"
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={SALES_PATH_TEXTAREA}
    />
  );
}

export function FollowupStepPanel(props: FollowupStepPanelProps) {
  const {
    waSalesFollowup1,
    setWaSalesFollowup1,
    waSalesFollowup2,
    setWaSalesFollowup2,
    waSalesFollowup3,
    setWaSalesFollowup3,
    busyAction,
    onApplyDefaults,
  } = props;

  const { openSections, toggle, scrollToSection, activeNav, mainRef, setStepPrefix } =
    useSalesPathSections<SectionId>(SECTIONS, { messages: true });

  useEffect(() => {
    setStepPrefix("followup");
  }, [setStepPrefix]);

  const resetting = busyAction === "followup:defaults";

  return (
    <SalesPathStepShell
      stepNumber={5}
      title="פולואפ"
      description="הודעות פולואפ לליד שהפסיק לענות. השליחה לא תתבצע בלילות ובמהלך השבת, או אם עברו 24 שעות מהודעת המשתמש האחרונה (מגבלת מטא)."
      stepPrefix="followup"
      sections={SECTIONS}
      activeNav={activeNav}
      onNavClick={scrollToSection}
      mainRef={mainRef}
      navAriaLabel="ניווט בתוך פולואפ"
    >
      <SalesPathSectionBlock
        stepPrefix="followup"
        id="messages"
        title="הודעות פולואפ"
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
            איפוס לטקסטי ברירת מחדל
          </Button>
        }
      >
        <div>
          <SalesPathFieldLabel>הודעה ראשונה (~20 דקות אחרי תשובת הבוט)</SalesPathFieldLabel>
          <FollowupTextarea value={waSalesFollowup1} onChange={setWaSalesFollowup1} rows={5} />
        </div>
        <div>
          <SalesPathFieldLabel>הודעה שנייה (~שעתיים)</SalesPathFieldLabel>
          <FollowupTextarea value={waSalesFollowup2} onChange={setWaSalesFollowup2} rows={5} />
        </div>
        <div>
          <SalesPathFieldLabel>הודעה שלישית (~23 שעות)</SalesPathFieldLabel>
          <FollowupTextarea value={waSalesFollowup3} onChange={setWaSalesFollowup3} rows={6} />
        </div>
      </SalesPathSectionBlock>
    </SalesPathStepShell>
  );
}
