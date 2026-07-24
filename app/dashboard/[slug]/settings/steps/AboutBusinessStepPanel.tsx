"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dashboardDir, type DashboardLang } from "@/lib/dashboard-lang";
import { dashboardSettingsT } from "@/lib/dashboard-settings-i18n";
import { cn } from "@/lib/utils";
import type { FactQuestion } from "@/lib/fact-questions";
import { factFromQuestionAnswer } from "@/lib/fact-questions";
import {
  SALES_PATH_INPUT,
  SALES_PATH_TEXTAREA,
  SalesPathFieldLabel,
  SalesPathSectionBlock,
  SalesPathStepShell,
  useSalesPathSections,
} from "./sales-path-shell";

const INPUT = SALES_PATH_INPUT;

function autosizeFactTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.max(el.scrollHeight, 40)}px`;
}

/** כרטיסיית עובדה בודדת — תצוגה מקוצרת / עריכה ב-textarea בלחיצה */
function FactCard({
  value,
  onChange,
  placeholder,
  dir,
  canRemove,
  onRemove,
  removeAriaLabel,
  indexLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  dir: "rtl" | "ltr";
  canRemove: boolean;
  onRemove: () => void;
  removeAriaLabel: string;
  indexLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    const el = taRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    try {
      el.setSelectionRange(len, len);
    } catch {
      /* ignore */
    }
    autosizeFactTextarea(el);
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    autosizeFactTextarea(taRef.current);
  }, [editing, value]);

  return (
    <li className="flex items-start gap-2">
      <span className="mt-2.5 w-5 shrink-0 text-center text-[11px] tabular-nums text-zinc-400">
        {indexLabel}
      </span>
      {editing ? (
        <textarea
          ref={taRef}
          dir={dir}
          value={value}
          placeholder={placeholder}
          rows={1}
          onChange={(e) => {
            onChange(e.target.value);
            autosizeFactTextarea(e.target);
          }}
          onBlur={() => setEditing(false)}
          className={cn(
            SALES_PATH_TEXTAREA,
            "min-h-10 flex-1 [field-sizing:content]"
          )}
        />
      ) : (
        <button
          type="button"
          dir={dir}
          onClick={() => setEditing(true)}
          className={cn(
            INPUT,
            "flex h-auto min-h-10 flex-1 cursor-text items-start px-3 py-2 text-start"
          )}
          aria-label={placeholder}
        >
          <span
            className={cn(
              "line-clamp-2 w-full whitespace-pre-wrap break-words text-sm leading-snug",
              value.trim() ? "text-zinc-800" : "text-zinc-400"
            )}
          >
            {value.trim() ? value : placeholder}
          </span>
        </button>
      )}
      {canRemove ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="mt-1.5 shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500"
          aria-label={removeAriaLabel}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ) : (
        <span className="w-8 shrink-0" />
      )}
    </li>
  );
}

type SectionId = "contact" | "identity" | "location" | "knowledge";

function traitPlaceholder(index: number, lang: DashboardLang): string {
  const about = dashboardSettingsT(lang).about;
  if (index === 0) return about.traitPlaceholder0;
  if (index === 1) return about.traitPlaceholder1;
  if (index === 2) return about.traitPlaceholder2;
  return about.traitPlaceholderN;
}

export type AboutBusinessStepPanelProps = {
  lang?: DashboardLang;
  whatsAppSlot: React.ReactNode;
  customerServicePhone: string;
  setCustomerServicePhone: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  businessNameEditing: boolean;
  setBusinessNameEditing: (v: boolean) => void;
  botName: string;
  setBotName: (v: string) => void;
  businessTagline: string;
  setBusinessTagline: (v: string) => void;
  address: string;
  setAddress: (v: string) => void;
  directions: string;
  setDirections: (v: string) => void;
  planIsStarter: boolean;
  onDirectionsMediaClick: () => void;
  onStarterMediaBlocked: () => void;
  promotions: string;
  setPromotions: (v: string) => void;
  traits: string[];
  setTraits: React.Dispatch<React.SetStateAction<string[]>>;
  factQuestions: FactQuestion[];
  factAnswers: Record<string, string>;
  setFactAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  factQuestionIdx: number;
  setFactQuestionIdx: React.Dispatch<React.SetStateAction<number>>;
  addFactLine: (value: string) => void;
};

export function AboutBusinessStepPanel(props: AboutBusinessStepPanelProps) {
  const {
    lang = "he",
    whatsAppSlot,
    customerServicePhone,
    setCustomerServicePhone,
    name,
    setName,
    businessNameEditing,
    setBusinessNameEditing,
    botName,
    setBotName,
    businessTagline,
    setBusinessTagline,
    address,
    setAddress,
    directions,
    setDirections,
    planIsStarter,
    onDirectionsMediaClick,
    onStarterMediaBlocked,
    promotions,
    setPromotions,
    traits,
    setTraits,
    factQuestions,
    factAnswers,
    setFactAnswers,
    factQuestionIdx,
    setFactQuestionIdx,
    addFactLine,
  } = props;
  const t = dashboardSettingsT(lang);
  const sections = useMemo(
    () => [
      { id: "contact" as const, label: t.about.sections.contact.label, hint: t.about.sections.contact.hint },
      { id: "identity" as const, label: t.about.sections.identity.label, hint: t.about.sections.identity.hint },
      { id: "location" as const, label: t.about.sections.location.label, hint: t.about.sections.location.hint },
      { id: "knowledge" as const, label: t.about.sections.knowledge.label, hint: t.about.sections.knowledge.hint },
    ],
    [t]
  );

  const { openSections, toggle, scrollToSection, activeNav, mainRef, setStepPrefix } =
    useSalesPathSections<SectionId>(sections, {
      contact: true,
      identity: true,
      location: false,
      knowledge: false,
    });

  useEffect(() => {
    setStepPrefix("about");
  }, [setStepPrefix]);

  const sectionFilled = useMemo(
    () => ({
      contact: Boolean(customerServicePhone.trim()),
      identity: Boolean(name.trim() || botName.trim() || businessTagline.trim()),
      location: Boolean(address.trim() || directions.trim()),
      knowledge: traits.some((t) => t.trim()) || Boolean(promotions.trim()),
    }),
    [customerServicePhone, name, botName, businessTagline, address, directions, traits, promotions]
  );

  const currentFactQ = factQuestions[factQuestionIdx] ?? factQuestions[0];

  return (
    <SalesPathStepShell
      stepNumber={2}
      title={t.about.title}
      description={t.about.description}
      stepPrefix="about"
      sections={sections}
      activeNav={activeNav}
      onNavClick={scrollToSection}
      mainRef={mainRef}
      navAriaLabel={t.about.navAria}
      lang={lang}
    >
          <SalesPathSectionBlock
            stepPrefix="about"
            id="contact"
            title={t.about.phones}
            hint={t.about.phonesHint}
            open={openSections.contact}
            onToggle={() => toggle("contact")}
            filled={sectionFilled.contact}
          >
            <div className="space-y-4">{whatsAppSlot}</div>
            <div>
              <SalesPathFieldLabel hint={t.about.customerServiceHint}>{t.about.customerService}</SalesPathFieldLabel>
              <Input
                dir="ltr"
                className={cn(INPUT, "font-mono text-sm")}
                value={customerServicePhone}
                onChange={(e) => setCustomerServicePhone(e.target.value)}
                placeholder="05…"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
              />
            </div>
          </SalesPathSectionBlock>

          <SalesPathSectionBlock
            stepPrefix="about"
            id="identity"
            title={t.about.identity}
            hint={t.about.identityHint}
            open={openSections.identity}
            onToggle={() => toggle("identity")}
            filled={sectionFilled.identity}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <SalesPathFieldLabel>{t.about.businessName}</SalesPathFieldLabel>
                {name.trim() && !businessNameEditing ? (
                  <div className="flex items-stretch overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50/60">
                    <div className="flex-1 px-3 py-2.5 text-sm font-semibold text-zinc-900">{name}</div>
                    <button
                      type="button"
                      onClick={() => setBusinessNameEditing(true)}
                      className="shrink-0 border-r border-zinc-200 px-3 text-xs font-medium text-[#7133da] hover:bg-[#f0eaff]"
                    >
                      {t.edit}
                    </button>
                  </div>
                ) : (
                  <Input
                    dir={dashboardDir(lang)}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => {
                      if (name.trim()) setBusinessNameEditing(false);
                    }}
                    placeholder={t.about.businessName}
                    className={INPUT}
                    autoFocus={businessNameEditing}
                  />
                )}
              </div>
              <div>
                <SalesPathFieldLabel>{t.about.botName}</SalesPathFieldLabel>
                <Input
                  dir={dashboardDir(lang)}
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  placeholder="Zoe"
                  className={INPUT}
                />
              </div>
            </div>
            <div>
              <SalesPathFieldLabel hint={t.about.taglineHint}>{t.about.tagline}</SalesPathFieldLabel>
              <Input
                dir={dashboardDir(lang)}
                value={businessTagline}
                onChange={(e) => setBusinessTagline(e.target.value)}
                placeholder="Pilates studio for strength and wellness"
                className={INPUT}
              />
            </div>
          </SalesPathSectionBlock>

          <SalesPathSectionBlock
            stepPrefix="about"
            id="location"
            title={`${t.about.sections.location.label} & ${t.about.directions}`}
            open={openSections.location}
            onToggle={() => toggle("location")}
            filled={sectionFilled.location}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <SalesPathFieldLabel>{t.about.address}</SalesPathFieldLabel>
                <Input
                  dir={dashboardDir(lang)}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Herzl St 5, Tel Aviv"
                  autoComplete="street-address"
                  className={INPUT}
                />
              </div>
              <div>
                <SalesPathFieldLabel
                  action={
                    <button
                      type="button"
                      onClick={() => {
                        if (planIsStarter) {
                          onStarterMediaBlocked();
                          return;
                        }
                        onDirectionsMediaClick();
                      }}
                      className="text-[11px] font-medium text-[#027eb5] hover:text-[#02638f]"
                    >
                      {t.about.uploadFile}
                    </button>
                  }
                >
                  {t.about.directions}
                </SalesPathFieldLabel>
                <Input
                  dir={dashboardDir(lang)}
                  value={directions}
                  onChange={(e) => setDirections(e.target.value)}
                  placeholder="Parking behind the building, entrance on the right…"
                  className={INPUT}
                />
              </div>
            </div>
          </SalesPathSectionBlock>

          <SalesPathSectionBlock
            stepPrefix="about"
            id="knowledge"
            title={t.about.knowledge}
            hint={t.about.knowledgeHint}
            open={openSections.knowledge}
            onToggle={() => toggle("knowledge")}
            filled={sectionFilled.knowledge}
          >
            <div>
              <SalesPathFieldLabel hint={t.about.factsHint}>{t.about.facts}</SalesPathFieldLabel>
              <ul className="space-y-2">
                {traits.map((row, i) => (
                  <FactCard
                    key={i}
                    indexLabel={String(i + 1)}
                    value={row}
                    placeholder={traitPlaceholder(i, lang)}
                    dir={dashboardDir(lang)}
                    canRemove={traits.length > 1}
                    removeAriaLabel={t.about.removeRow}
                    onChange={(next) =>
                      setTraits((prev) => {
                        const copy = [...prev];
                        copy[i] = next;
                        return copy;
                      })
                    }
                    onRemove={() => setTraits((prev) => prev.filter((_, j) => j !== i))}
                  />
                ))}
              </ul>
              <Button
                type="button"
                variant="outline"
                className="mt-2 h-9 w-full gap-1 border-dashed text-xs"
                onClick={() => setTraits((prev) => [...prev, ""])}
              >
                <Plus className="h-3.5 w-3.5" />
                {t.about.addFact}
              </Button>
            </div>

            <div>
              <SalesPathFieldLabel>{t.about.promotions}</SalesPathFieldLabel>
              <Input
                dir={dashboardDir(lang)}
                value={promotions}
                onChange={(e) => setPromotions(e.target.value)}
                placeholder="20% off new memberships until end of month"
                className={INPUT}
              />
            </div>

            {factQuestions.length > 0 && currentFactQ ? (
              <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/50 p-3">
                <p className="mb-2 text-[11px] font-medium text-zinc-500">{t.about.suggestedQuestion}</p>
                <p className="mb-2 text-sm font-medium text-zinc-800">{currentFactQ.question}</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    dir={dashboardDir(lang)}
                    value={factAnswers[currentFactQ.id] ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFactAnswers((m) => ({ ...m, [currentFactQ.id]: v }));
                    }}
                    placeholder={currentFactQ.placeholder}
                    className={cn(INPUT, "flex-1")}
                  />
                  <div className="flex shrink-0 gap-2">
                    {factQuestions.length > 1 ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 px-3 text-xs"
                        onClick={() =>
                          setFactQuestionIdx((i) =>
                            factQuestions.length ? (i + 1) % factQuestions.length : 0
                          )
                        }
                      >
                        {t.about.anotherQuestion}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 gap-1 px-3 text-xs"
                      onClick={() => {
                        addFactLine(
                          factFromQuestionAnswer(currentFactQ.question, factAnswers[currentFactQ.id] ?? "")
                        );
                        if (factQuestions.length > 1) {
                          setFactQuestionIdx((i) => (i + 1) % factQuestions.length);
                        }
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t.about.addToFacts}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">{t.about.factsComplete}</p>
            )}
          </SalesPathSectionBlock>
    </SalesPathStepShell>
  );
}
