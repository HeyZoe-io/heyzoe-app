"use client";

import { useEffect, useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { FactQuestion } from "@/lib/fact-questions";
import { factFromQuestionAnswer } from "@/lib/fact-questions";
import {
  SALES_PATH_INPUT,
  SalesPathFieldLabel,
  SalesPathSectionBlock,
  SalesPathStepShell,
  useSalesPathSections,
} from "./sales-path-shell";

const INPUT = SALES_PATH_INPUT;

type SectionId = "contact" | "identity" | "location" | "knowledge";

const SECTIONS: { id: SectionId; label: string; hint: string }[] = [
  { id: "contact", label: "קשר", hint: "וואטסאפ ושירות" },
  { id: "identity", label: "זהות", hint: "שם ותיאור" },
  { id: "location", label: "מיקום", hint: "כתובת והגעה" },
  { id: "knowledge", label: "ידע לזואי", hint: "עובדות ומבצעים" },
];

function traitPlaceholder(index: number): string {
  if (index === 0) return "מתאים לשיקום פציעות";
  if (index === 1) return "מתאים לכל הרמות";
  if (index === 2) return "הסטודיו הגדול בעיר";
  return "מאפיין נוסף";
}

export type AboutBusinessStepPanelProps = {
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

  const { openSections, toggle, scrollToSection, activeNav, mainRef, setStepPrefix } =
    useSalesPathSections<SectionId>(SECTIONS, {
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
      title="על העסק"
      description="מה שזואי צריכה לדעת — מסודר לפי נושאים. פתחו רק את מה שרוצים לערוך."
      stepPrefix="about"
      sections={SECTIONS}
      activeNav={activeNav}
      onNavClick={scrollToSection}
      mainRef={mainRef}
      navAriaLabel="ניווט בתוך על העסק"
    >
          <SalesPathSectionBlock
            stepPrefix="about"
            id="contact"
            title="קשר ווואטסאפ"
            hint="מספרים שזואי משתמשת בהם בשיחה"
            open={openSections.contact}
            onToggle={() => toggle("contact")}
            filled={sectionFilled.contact}
          >
            <div className="space-y-4">{whatsAppSlot}</div>
            <div>
              <SalesPathFieldLabel hint="לפניות שלא דרך הבוט">טלפון שירות לקוחות</SalesPathFieldLabel>
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
            title="זהות העסק"
            hint="שם, בוט ותיאור קצר"
            open={openSections.identity}
            onToggle={() => toggle("identity")}
            filled={sectionFilled.identity}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <SalesPathFieldLabel>שם העסק</SalesPathFieldLabel>
                {name.trim() && !businessNameEditing ? (
                  <div className="flex items-stretch overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50/60">
                    <div className="flex-1 px-3 py-2.5 text-sm font-semibold text-zinc-900">{name}</div>
                    <button
                      type="button"
                      onClick={() => setBusinessNameEditing(true)}
                      className="shrink-0 border-r border-zinc-200 px-3 text-xs font-medium text-[#7133da] hover:bg-[#f0eaff]"
                    >
                      עריכה
                    </button>
                  </div>
                ) : (
                  <Input
                    dir="rtl"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => {
                      if (name.trim()) setBusinessNameEditing(false);
                    }}
                    placeholder="שם העסק"
                    className={INPUT}
                    autoFocus={businessNameEditing}
                  />
                )}
              </div>
              <div>
                <SalesPathFieldLabel hint="איך הבוט מציג את עצמו">שם הבוט</SalesPathFieldLabel>
                <Input
                  dir="rtl"
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  placeholder="זואי"
                  className={INPUT}
                />
              </div>
            </div>
            <div>
              <SalesPathFieldLabel hint="משפט אחד — זואי משתמשת בו בהקדמה">תיאור העסק</SalesPathFieldLabel>
              <Input
                dir="rtl"
                value={businessTagline}
                onChange={(e) => setBusinessTagline(e.target.value)}
                placeholder="סטודיו לפילאטיס מכשירים לחיטוב ובריאות הגוף"
                className={INPUT}
              />
            </div>
          </SalesPathSectionBlock>

          <SalesPathSectionBlock
            stepPrefix="about"
            id="location"
            title="מיקום והגעה"
            open={openSections.location}
            onToggle={() => toggle("location")}
            filled={sectionFilled.location}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <SalesPathFieldLabel>כתובת</SalesPathFieldLabel>
                <Input
                  dir="rtl"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="רחוב הרצל 5, תל אביב"
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
                      העלאת קובץ
                    </button>
                  }
                >
                  הנחיות הגעה
                </SalesPathFieldLabel>
                <Input
                  dir="rtl"
                  value={directions}
                  onChange={(e) => setDirections(e.target.value)}
                  placeholder="חנייה מאחורי הבניין, כניסה מימין…"
                  className={INPUT}
                />
              </div>
            </div>
          </SalesPathSectionBlock>

          <SalesPathSectionBlock
            stepPrefix="about"
            id="knowledge"
            title="ידע לזואי"
            hint="עובדות, מבצעים ושאלות משלימות"
            open={openSections.knowledge}
            onToggle={() => toggle("knowledge")}
            filled={sectionFilled.knowledge}
          >
            <div>
              <SalesPathFieldLabel hint="נקודות שכדאי שזואי תדע לציין">עובדות על העסק</SalesPathFieldLabel>
              <ul className="space-y-2">
                {traits.map((row, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-center text-[11px] tabular-nums text-zinc-400">
                      {i + 1}
                    </span>
                    <Input
                      dir="rtl"
                      value={row}
                      onChange={(e) =>
                        setTraits((prev) => {
                          const next = [...prev];
                          next[i] = e.target.value;
                          return next;
                        })
                      }
                      placeholder={traitPlaceholder(i)}
                      className={cn(INPUT, "flex-1")}
                    />
                    {traits.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => setTraits((prev) => prev.filter((_, j) => j !== i))}
                        className="shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500"
                        aria-label="הסר שורה"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : (
                      <span className="w-8 shrink-0" />
                    )}
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant="outline"
                className="mt-2 h-9 w-full gap-1 border-dashed text-xs"
                onClick={() => setTraits((prev) => [...prev, ""])}
              >
                <Plus className="h-3.5 w-3.5" />
                הוסף עובדה
              </Button>
            </div>

            <div>
              <SalesPathFieldLabel>הנחות ומבצעים</SalesPathFieldLabel>
              <Input
                dir="rtl"
                value={promotions}
                onChange={(e) => setPromotions(e.target.value)}
                placeholder="20% הנחה על מנויים חדשים עד סוף החודש"
                className={INPUT}
              />
            </div>

            {factQuestions.length > 0 && currentFactQ ? (
              <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/50 p-3">
                <p className="mb-2 text-[11px] font-medium text-zinc-500">שאלה מוצעת להשלמת הידע</p>
                <p className="mb-2 text-sm font-medium text-zinc-800">{currentFactQ.question}</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    dir="rtl"
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
                        שאלה אחרת
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
                      הוסף לעובדות
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">נראה שהעובדות כבר מכסות את רוב השאלות הנפוצות.</p>
            )}
          </SalesPathSectionBlock>
    </SalesPathStepShell>
  );
}
