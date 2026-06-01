"use client";

import { useEffect, useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import {
  Loader2,
  Sparkles,
  Upload,
  X,
  Trash2,
  Plus,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, StepPanel, Textarea } from "../settings-ui";
import {
  SalesPathSectionBlock,
  SalesPathStepShell,
  useSalesPathSections,
} from "./sales-path-shell";
import {
  ctaLockedKindForSlot,
  ctaSlotRoleLabel,
  salesFlowApplyLockedSubChoice,
  salesFlowSubChoiceForSlot,
  type CtaSlotSubChoice,
  type OfferKind,
  type SalesFlowConfig,
  type SecondaryPurchaseCtaDelivery,
  type SalesFlowCtaButton,
  type SalesFlowExtraStep,
  WARMUP_MAX_BUTTONS,
  WARMUP_MIN_BUTTONS,
  createDefaultWarmupExtraStep,
} from "@/lib/sales-flow";

type ServiceItem = {
  ui_id: string;
  name: string;
  price_text: string;
  duration: string;
  payment_link: string;
  service_slug: string;
  location_text: string;
  description: string;
  levels_enabled: boolean;
  levels: string[];
  offer_kind: OfferKind;
  course_start_date: string;
  course_end_date: string;
  course_sessions_count: string;
  benefit_line: string;
  trial_pick_media_url: string;
  trial_pick_media_type: "image" | "video" | "";
  schedule_slots: { id: string; day: string; time: string }[];
  course_cycles: { id: string; start_date: string; end_date: string; schedule_slots: { id: string; day: string; time: string }[] }[];
};

type CtaOfferTab = "trial" | "workshop" | "course";

type Step4SalesFlowProps = {
  planIsStarter: boolean;
  onStarterMediaBlocked: () => void;
  openingMediaUrl: string;
  openingMediaType: "image" | "video" | "";
  uploadingMedia: boolean;
  mediaInputRef: RefObject<HTMLInputElement | null>;
  scheduleCtaMediaInputRef: RefObject<HTMLInputElement | null>;
  uploadingScheduleCtaMedia: boolean;
  scheduleCtaMediaUploadError: string;
  setScheduleCtaMediaUploadError: (v: string) => void;
  uploadMedia: (file: File, target: "opening" | "directions" | "schedule_cta") => Promise<void>;
  setOpeningMediaUrl: (v: string) => void;
  setOpeningMediaType: Dispatch<SetStateAction<"image" | "video" | "">>;
  setMediaUploadError: (v: string) => void;
  mediaUploadError: string;
  regenerateSalesFlowSection: (
    section: "opening" | "service_pick" | "warmup" | "cta" | "after_trial_registration",
    warmupOfferKind?: "trial" | "workshop" | "course"
  ) => void;
  regeneratingKey: string | null;
  salesFlowConfig: SalesFlowConfig;
  setSalesFlowConfig: Dispatch<SetStateAction<SalesFlowConfig>>;
  scheduleDirectRegistration?: boolean;
  warmupSessionEnabled?: boolean;
  setWarmupSessionEnabled: (v: boolean) => void;
  salesOpeningAutoText: string;
  trialServiceNames: string[];
  firstNamedService: ServiceItem | null;
  firstTrialForTemplates: { name: string; priceText: string; durationText: string };
  services: ServiceItem[];
  videoUrlForPreview: (url: string) => string;
  experienceQuestionForDisplay: (stored: string, serviceName: string) => string;
  experienceQuestionToStore: (typed: string, serviceName: string) => string;
  ctaBodyForDisplay: (stored: string) => string;
  ctaBodyToStore: (typed: string, priceText: string, durationText: string) => string;
  afterExperienceForDisplay: (stored: string, service: ServiceItem | null) => string;
  afterExperienceToStore: (typed: string, service: ServiceItem | null) => string;
  hasTrialOffers: boolean;
  hasWorkshopOffers: boolean;
  hasCourseOffers: boolean;
  workshopCtaSample: { priceText: string; durationText: string };
  courseCtaSample: { priceText: string; sessionsText: string; startDate: string; endDate: string };
  workshopCtaBodyForDisplayUi: (stored: string) => string;
  workshopCtaBodyToStore: (typed: string, priceText: string, durationText: string) => string;
  courseCtaBodyForDisplayUi: (stored: string) => string;
  courseCtaBodyToStore: (
    typed: string,
    priceText: string,
    sessionsText: string,
    startDate: string,
    endDate: string
  ) => string;
  uid: () => string;
};

function resolveOfferTab(
  preferred: CtaOfferTab,
  hasTrial: boolean,
  hasWorkshop: boolean,
  hasCourse: boolean
): CtaOfferTab {
  const ok =
    (preferred === "trial" && hasTrial) ||
    (preferred === "workshop" && hasWorkshop) ||
    (preferred === "course" && hasCourse);
  if (ok) return preferred;
  if (hasTrial) return "trial";
  if (hasWorkshop) return "workshop";
  return "course";
}

function WarmupButtonPairsEditor({
  options,
  replies,
  onChange,
  afterExperienceForDisplay,
  afterExperienceToStore,
  serviceForReply,
}: {
  options: string[];
  replies: string[];
  onChange: (nextOptions: string[], nextReplies: string[]) => void;
  afterExperienceForDisplay: (stored: string, service: ServiceItem | null) => string;
  afterExperienceToStore: (typed: string, service: ServiceItem | null) => string;
  serviceForReply: ServiceItem | null;
}) {
  const updatePair = (index: number, patch: { label?: string; reply?: string }) => {
    const nextOptions = [...options];
    const nextReplies = [...replies];
    if (patch.label !== undefined) nextOptions[index] = patch.label;
    if (patch.reply !== undefined) nextReplies[index] = patch.reply;
    onChange(nextOptions, nextReplies);
  };

  const removePair = (index: number) => {
    if (options.length <= WARMUP_MIN_BUTTONS) return;
    onChange(
      options.filter((_, i) => i !== index),
      replies.filter((_, i) => i !== index)
    );
  };

  const addPair = () => {
    if (options.length >= WARMUP_MAX_BUTTONS) return;
    onChange([...options, ""], [...replies, ""]);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-zinc-700 text-center">כפתורי תשובה</p>
      {options.map((label, i) => (
        <div key={i} className="rounded-xl border border-zinc-100 bg-white/80 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-zinc-700">כפתור {i + 1}</span>
            {options.length > WARMUP_MIN_BUTTONS ? (
              <button
                type="button"
                className="p-1 text-zinc-400 hover:text-red-500"
                onClick={() => removePair(i)}
                aria-label={`הסר כפתור ${i + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3" dir="rtl">
            <div className="min-w-0 flex-1 space-y-1">
              <span className="text-[11px] font-medium text-zinc-500">תוכן הכפתור</span>
              <Input
                dir="rtl"
                value={label}
                onChange={(e) => updatePair(i, { label: e.target.value })}
                placeholder={`כפתור ${i + 1}`}
              />
            </div>
            <ArrowLeft className="mx-auto h-5 w-5 shrink-0 text-zinc-400 sm:mt-8" aria-hidden />
            <div className="min-w-0 flex-1 space-y-1">
              <span className="text-[11px] font-medium text-zinc-500">תשובה</span>
              <Textarea
                rows={2}
                value={afterExperienceForDisplay(replies[i] ?? "", serviceForReply)}
                onChange={(v) =>
                  updatePair(i, { reply: afterExperienceToStore(v, serviceForReply) })
                }
                placeholder="משפט מעודד קצר אחרי לחיצה על הכפתור…"
              />
            </div>
          </div>
        </div>
      ))}
      {options.length < WARMUP_MAX_BUTTONS ? (
        <Button type="button" variant="outline" className="w-full gap-1 text-sm" onClick={addPair}>
          <Plus className="h-4 w-4" />
          הוסף כפתור ותשובה
        </Button>
      ) : null}
    </div>
  );
}

function SalesFlowExtraStepsEditor({
  steps,
  onChange,
  addButtonLabel,
  startAt = 1,
  questionHeaderClassName = "",
  uid,
  afterExperienceForDisplay,
  afterExperienceToStore,
  serviceForReply,
}: {
  steps: SalesFlowExtraStep[];
  onChange: (next: SalesFlowExtraStep[]) => void;
  addButtonLabel: string;
  startAt?: number;
  questionHeaderClassName?: string;
  uid: () => string;
  afterExperienceForDisplay: (stored: string, service: ServiceItem | null) => string;
  afterExperienceToStore: (typed: string, service: ServiceItem | null) => string;
  serviceForReply: ServiceItem | null;
}) {
  return (
    <div className="space-y-3 pt-3 border-t border-dashed border-zinc-200/90">
      {steps.map((st, si) => (
        <div
          key={st.id}
          className="border border-dashed border-zinc-200 rounded-xl p-3 space-y-3 bg-zinc-50/60"
        >
          <div className="flex justify-between items-center gap-2">
            <span
              className={`text-[0.95rem] font-semibold tracking-[-0.01em] text-zinc-800 ${questionHeaderClassName}`.trim()}
            >
              שאלה {si + startAt}
            </span>
            <button
              type="button"
              className="p-1 text-zinc-400 hover:text-red-500"
              onClick={() => onChange(steps.filter((x) => x.id !== st.id))}
              aria-label="הסר שאלה"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <Input
            dir="rtl"
            value={st.question}
            onChange={(e) => {
              const v = e.target.value;
              onChange(steps.map((x) => (x.id === st.id ? { ...x, question: v } : x)));
            }}
            placeholder="כתבו את השאלה כאן…"
          />
          <WarmupButtonPairsEditor
            options={st.options}
            replies={st.replies}
            onChange={(nextOptions, nextReplies) =>
              onChange(
                steps.map((x) =>
                  x.id === st.id ? { ...x, options: nextOptions, replies: nextReplies } : x
                )
              )
            }
            afterExperienceForDisplay={afterExperienceForDisplay}
            afterExperienceToStore={afterExperienceToStore}
            serviceForReply={serviceForReply}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        className="w-full gap-1 text-sm"
        onClick={() => onChange([...steps, createDefaultWarmupExtraStep(uid())])}
      >
        <Plus className="h-4 w-4" />
        {addButtonLabel}
      </Button>
    </div>
  );
}

export default function Step4SalesFlow(props: Step4SalesFlowProps) {
  const {
    planIsStarter,
    onStarterMediaBlocked,
    openingMediaUrl,
    openingMediaType,
    uploadingMedia,
    mediaInputRef,
    scheduleCtaMediaInputRef,
    uploadingScheduleCtaMedia,
    scheduleCtaMediaUploadError,
    setScheduleCtaMediaUploadError,
    uploadMedia,
    setOpeningMediaUrl,
    setOpeningMediaType,
    setMediaUploadError,
    mediaUploadError,
    regenerateSalesFlowSection,
    regeneratingKey,
    salesFlowConfig,
    setSalesFlowConfig,
    scheduleDirectRegistration = true,
    warmupSessionEnabled = true,
    setWarmupSessionEnabled,
    salesOpeningAutoText,
    trialServiceNames,
    firstNamedService,
    firstTrialForTemplates,
    services,
    videoUrlForPreview,
    experienceQuestionForDisplay,
    experienceQuestionToStore,
    ctaBodyForDisplay,
    ctaBodyToStore,
    afterExperienceForDisplay,
    afterExperienceToStore,
    hasTrialOffers,
    hasWorkshopOffers,
    hasCourseOffers,
    workshopCtaSample,
    courseCtaSample,
    workshopCtaBodyForDisplayUi,
    workshopCtaBodyToStore,
    courseCtaBodyForDisplayUi,
    courseCtaBodyToStore,
    uid,
  } = props;

  const isSalesGenerating = typeof regeneratingKey === "string" && regeneratingKey.startsWith("sales:");
  const isGen = (section: string, warmupTab?: CtaOfferTab) => {
    if (section === "warmup" && warmupTab) return regeneratingKey === `sales:warmup:${warmupTab}`;
    return regeneratingKey === `sales:${section}`;
  };

  const [ctaOfferTabPreferred, setCtaOfferTab] = useState<CtaOfferTab>(() => {
    if (hasTrialOffers) return "trial";
    if (hasWorkshopOffers) return "workshop";
    return "course";
  });
  const ctaOfferTab = useMemo(
    () =>
      resolveOfferTab(
        ctaOfferTabPreferred,
        hasTrialOffers,
        hasWorkshopOffers,
        hasCourseOffers
      ),
    [ctaOfferTabPreferred, hasTrialOffers, hasWorkshopOffers, hasCourseOffers]
  );

  const [warmOfferTabPreferred, setWarmOfferTab] = useState<CtaOfferTab>(() => {
    if (hasTrialOffers) return "trial";
    if (hasWorkshopOffers) return "workshop";
    return "course";
  });
  const warmOfferTab = useMemo(
    () =>
      resolveOfferTab(
        warmOfferTabPreferred,
        hasTrialOffers,
        hasWorkshopOffers,
        hasCourseOffers
      ),
    [warmOfferTabPreferred, hasTrialOffers, hasWorkshopOffers, hasCourseOffers]
  );

  const firstTrialSvcForWarmup = useMemo(() => {
    const row = services.find((s) => String(s?.name ?? "").trim() && s?.offer_kind === "trial");
    return row ?? firstNamedService;
  }, [services, firstNamedService]);

  const firstWorkshopSvcForWarmup = useMemo(
    () => services.find((s) => String(s?.name ?? "").trim() && s?.offer_kind === "workshop") ?? null,
    [services]
  );

  const showScheduleSelectionSession = scheduleDirectRegistration === false;
  const trialCtaButtonsForUi = useMemo(
    () =>
      showScheduleSelectionSession
        ? salesFlowConfig.cta_buttons.filter((b) => b.kind !== "schedule")
        : salesFlowConfig.cta_buttons,
    [showScheduleSelectionSession, salesFlowConfig.cta_buttons]
  );
  type SalesSectionId =
    | "media"
    | "opening"
    | "service_pick"
    | "warmup"
    | "schedule_selection"
    | "cta"
    | "after_trial";
  const SALES_SECTIONS: { id: SalesSectionId; label: string; hint?: string }[] = useMemo(
    () => [
      { id: "media", label: "מדיה", hint: "פתיחה" },
      { id: "opening", label: "פתיחה", hint: "סשן" },
      { id: "service_pick", label: "מוצר", hint: "שירות" },
      { id: "warmup", label: "חימום", hint: "סשן" },
      ...(showScheduleSelectionSession
        ? ([{ id: "schedule_selection", label: "יום ושעה", hint: "סשן" }] as const)
        : []),
      { id: "cta", label: "הנעה", hint: "לפעולה" },
      { id: "after_trial", label: "אחרי הרשמה", hint: "ניסיון" },
    ],
    [showScheduleSelectionSession]
  );
  const { openSections, toggle, scrollToSection, activeNav, mainRef, setStepPrefix } =
    useSalesPathSections<SalesSectionId>(SALES_SECTIONS, {
      media: true,
      opening: true,
      service_pick: false,
      warmup: false,
      schedule_selection: false,
      cta: false,
      after_trial: false,
    });

  useEffect(() => {
    setStepPrefix("sales");
  }, [setStepPrefix]);

  const firstCourseSvcForWarmup = useMemo(
    () => services.find((s) => String(s?.name ?? "").trim() && s?.offer_kind === "course") ?? null,
    [services]
  );

  const openingMediaConfigured = Boolean(String(openingMediaUrl ?? "").trim());
  /** אחרי העלאה שנכשלה לא מראים תצוגה של מדיה שמורה — רק מסגרת העלאה + הודעת שגיאה */
  const showOpeningMediaPreview = openingMediaConfigured && !String(mediaUploadError ?? "").trim();

  return (
    <StepPanel className="!text-right [&_input]:!text-right [&_textarea]:!text-right">
      <SalesPathStepShell
        stepNumber={4}
        title="מסלול מכירה"
        description="כאן נוצר תהליך המכירה של זואי. אני עונה גם על שאלות פתוחות :)"
        stepPrefix="sales"
        sections={SALES_SECTIONS}
        activeNav={activeNav}
        onNavClick={scrollToSection}
        mainRef={mainRef}
        navAriaLabel="ניווט בתוך מסלול מכירה"
      >
        <SalesPathSectionBlock
          stepPrefix="sales"
          id="media"
          title="מדיה לפתיחה (אופציונלי)"
          open={openSections.media}
          onToggle={() => toggle("media")}
          filled={showOpeningMediaPreview}
        >
        <div>
          <div className="flex flex-row-reverse items-center gap-2 mb-2 flex-wrap justify-center">
            <p className="text-sm font-medium text-zinc-700">מדיה לפתיחה (אופציונלי)</p>
            {planIsStarter ? (
              <span className="text-[11px] font-semibold text-amber-600 shrink-0" title="זמין בחבילת Pro">
                ⭐ Pro
              </span>
            ) : null}
          </div>
          {!showOpeningMediaPreview ? (
            <button
              type="button"
              disabled={uploadingMedia}
              onClick={() => {
                if (planIsStarter) {
                  onStarterMediaBlocked?.();
                  return;
                }
                if (!uploadingMedia) mediaInputRef.current?.click();
              }}
              className="w-full border-2 border-dashed border-zinc-300 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-[#7133da]/50 hover:bg-[#f7f3ff] transition-all disabled:opacity-60 disabled:pointer-events-none"
            >
              {uploadingMedia ? (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-[#7133da]/60" />
                  <p className="text-sm text-zinc-500">מעלה…</p>
                </>
              ) : (
                <>
                  <Upload className="h-8 w-8 text-zinc-400" />
                  <p className="text-sm text-zinc-500">לחץ להעלאת תמונה או סרטון</p>
                  <p className="text-xs text-zinc-400">
                    עד 16MB. JPG, PNG, GIF, MP4 (העלאה ישירה ל-Storage)
                  </p>
                </>
              )}
            </button>
          ) : (
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 space-y-3">
              {openingMediaType === "video" ? (
                <div className="relative mx-auto w-fit max-w-full">
                  <video
                    src={videoUrlForPreview(openingMediaUrl)}
                    className="block max-h-72 max-w-full rounded-xl bg-black"
                    muted
                    playsInline
                    preload="metadata"
                    controls
                  />
                  <p className="text-center text-xs text-emerald-600 mt-2 font-medium">
                    הווידאו הועלה - תצוגה מקדימה (אפשר להפעיל)
                  </p>
                </div>
              ) : (
                <div className="relative mx-auto w-fit max-w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={openingMediaUrl}
                    alt="מדיה לפתיחה"
                    className="mx-auto block max-h-72 max-w-full rounded-xl object-contain"
                  />
                  <p className="text-center text-xs text-emerald-600 mt-2 font-medium">התמונה הועלתה</p>
                </div>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1 text-xs py-1.5 px-3 h-auto"
                  disabled={uploadingMedia}
                  onClick={() => {
                    if (planIsStarter) {
                      onStarterMediaBlocked?.();
                      return;
                    }
                    mediaInputRef.current?.click();
                  }}
                >
                  <Upload className="h-4 w-4" />
                  החלף קובץ
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1 text-xs py-1.5 px-3 h-auto text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => {
                    setOpeningMediaUrl("");
                    setOpeningMediaType("");
                    setMediaUploadError("");
                  }}
                >
                  <X className="h-4 w-4" />
                  הסר מדיה
                </Button>
              </div>
            </div>
          )}
          {mediaUploadError ? (
            <p className="text-sm text-red-600 mt-2 text-center" role="alert">
              {mediaUploadError}
            </p>
          ) : null}
          <input
            ref={mediaInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void uploadMedia(f, "opening");
            }}
          />
        </div>
        </SalesPathSectionBlock>

        <SalesPathSectionBlock
          stepPrefix="sales"
          id="opening"
          title="סשן פתיחה"
          open={openSections.opening}
          onToggle={() => toggle("opening")}
          filled={Boolean(
            (salesFlowConfig.greeting_body_override !== undefined
              ? salesFlowConfig.greeting_body_override
              : salesOpeningAutoText
            )?.trim()
          )}
          headerAction={
            <Button
              type="button"
              variant="outline"
              className="gap-1 text-xs py-1.5 px-3 h-auto"
              disabled={isSalesGenerating}
              onClick={() => regenerateSalesFlowSection("opening")}
            >
              {isGen("opening") ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {isGen("opening") ? "מג׳נרט..." : "ג׳נרט מחדש"}
            </Button>
          }
        >
          <div className="space-y-3">
            <Field label="טקסט פתיחה ללקוח">
              <Textarea
                value={
                  salesFlowConfig.greeting_body_override !== undefined
                    ? salesFlowConfig.greeting_body_override
                    : salesOpeningAutoText
                }
                onChange={(v) => setSalesFlowConfig((c) => ({ ...c, greeting_body_override: v }))}
                rows={5}
                placeholder={salesOpeningAutoText}
              />
            </Field>
          </div>
        </SalesPathSectionBlock>

        <SalesPathSectionBlock
          stepPrefix="sales"
          id="service_pick"
          title="בחירת מוצר"
          open={openSections.service_pick}
          onToggle={() => toggle("service_pick")}
          filled={trialServiceNames.length > 0}
          headerAction={
            <Button
              type="button"
              variant="outline"
              className="gap-1 text-xs py-1.5 px-3 h-auto"
              disabled={isSalesGenerating}
              onClick={() => regenerateSalesFlowSection("service_pick")}
            >
              {isGen("service_pick") ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {isGen("service_pick") ? "מג׳נרט..." : "ג׳נרט מחדש"}
            </Button>
          }
        >
          <div className="space-y-3">
            {trialServiceNames.length > 1 ? (
              <>
                <Field label="שאלה + כפתורי בחירה" className="space-y-1">
                  <Textarea
                    value={salesFlowConfig.multi_service_question}
                    onChange={(v) => setSalesFlowConfig((c) => ({ ...c, multi_service_question: v }))}
                    rows={4}
                    placeholder="למשל: איזה אימון הכי מדבר אליך?"
                  />
                  <p className="text-[11px] leading-relaxed text-zinc-500">
                    כשיש תמונת מערכת שעות — נשלחת לפני השאלה; «(תמונה)» מוחלף בקישור רק כשאין תמונה.
                  </p>
                </Field>
                <div className="space-y-3">
                  {services.map((s: ServiceItem) =>
                    !s.name.trim() ? null : (
                      <div key={s.ui_id} className="space-y-2 rounded-xl border border-zinc-100 bg-white/80 p-3">
                        <div className="w-full rounded-xl border border-[#7133da]/20 bg-[#f5f3ff] px-3 py-2 text-center text-sm font-medium text-[#2d1a6e]">
                          {s.name.trim()}
                        </div>
                        <Field label="תשובה">
                          <div
                            dir="rtl"
                            className="min-h-[6rem] whitespace-pre-wrap rounded-lg border border-zinc-200/80 bg-zinc-50 px-3 py-2 text-sm leading-relaxed text-zinc-800"
                          >
                            {s.description.trim() ? (
                              s.description
                            ) : (
                              <span className="text-zinc-400">אין תיאור — הוסיפו בטאב «מוצרים»</span>
                            )}
                          </div>
                          <p className="text-[11px] leading-relaxed text-zinc-500">
                            נערך בטאב «מוצרים» (שדה תיאור).
                          </p>
                        </Field>
                      </div>
                    )
                  )}
                </div>
              </>
            ) : trialServiceNames.length === 1 ? (
              <>
                <p className="text-xs text-zinc-600 text-center leading-relaxed">
                  מוגדר שירות יחיד — אין שלב בחירה בין מוצרים. השאלה והכפתורים הבאים מופיעים ב«סשן חימום» למטה.
                </p>
                {(() => {
                  const firstNamedIndex = services.findIndex((s: ServiceItem) => s.name.trim());
                  if (firstNamedIndex < 0) return null;
                  const s = services[firstNamedIndex]!;
                  return (
                    <div key={s.ui_id} className="space-y-2 rounded-xl border border-zinc-100 bg-white/80 p-3">
                      <p className="text-xs font-medium text-zinc-700 text-center">תשובה לאימון: {s.name.trim()}</p>
                      <Field label="תשובה">
                        <div
                          dir="rtl"
                          className="min-h-[6rem] whitespace-pre-wrap rounded-lg border border-zinc-200/80 bg-zinc-50 px-3 py-2 text-sm leading-relaxed text-zinc-800"
                        >
                          {s.description.trim() ? (
                            s.description
                          ) : (
                            <span className="text-zinc-400">אין תיאור — הוסיפו בטאב «מוצרים»</span>
                          )}
                        </div>
                        <p className="text-[11px] leading-relaxed text-zinc-500">
                          נערך בטאב «מוצרים» (שדה תיאור).
                        </p>
                      </Field>
                    </div>
                  );
                })()}
              </>
            ) : (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-center">
                הוסיפו לפחות שירות אחד בטאב «מוצרים» כדי להגדיר את מסלול הבחירה.
              </p>
            )}
          </div>
        </SalesPathSectionBlock>

        <SalesPathSectionBlock
          stepPrefix="sales"
          id="warmup"
          title="סשן חימום"
          hint="פשוט שאלות שעושות חשק לבוא. אל תעמיסו 🙂"
          open={openSections.warmup}
          onToggle={() => toggle("warmup")}
          filled={warmupSessionEnabled && Boolean(salesFlowConfig.experience_question?.trim())}
          headerAction={
            warmupSessionEnabled ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-red-100 bg-white p-1.5 text-red-500 transition-colors hover:bg-red-50"
                  onClick={() => setWarmupSessionEnabled?.(false)}
                  aria-label="הסר סשן חימום"
                  title="הסר סשן חימום"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1 text-xs py-1.5 px-3 h-auto"
                  disabled={isSalesGenerating}
                  onClick={() => regenerateSalesFlowSection("warmup", warmOfferTab)}
                >
                  {isGen("warmup", warmOfferTab) ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {isGen("warmup", warmOfferTab) ? "מג׳נרט..." : "ג׳נרט מחדש"}
                </Button>
              </div>
            ) : null
          }
        >
          <div className="space-y-3">
            {!warmupSessionEnabled ? (
              <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 px-4 py-5 text-center">
                <p className="text-sm text-zinc-600">סשן החימום מוסר מהפלואו.</p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 gap-1"
                  onClick={() => setWarmupSessionEnabled?.(true)}
                >
                  <Plus className="h-4 w-4" />
                  הוסף סשן חימום
                </Button>
              </div>
            ) : trialServiceNames.length === 0 ? (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-center">
                כדי לערוך כאן — הוסיפו לפחות שירות אחד בטאב «מוצרים» (שלב 3).
              </p>
            ) : (
              <>
                <div
                  dir="rtl"
                  className="flex w-full flex-wrap gap-2 justify-start pb-1 border-b border-zinc-100 text-right"
                  role="tablist"
                  aria-label="סוג סשן חימום לעריכה"
                >
                  {hasTrialOffers ? (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={warmOfferTab === "trial"}
                      className={`text-xs font-medium rounded-full px-2.5 py-1 border transition-colors text-right ${
                        warmOfferTab === "trial"
                          ? "border-[#7133da]/25 bg-[#f8f5ff] text-[#4b2a86]"
                          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                      onClick={() => setWarmOfferTab("trial")}
                    >
                      שיעור ניסיון
                    </button>
                  ) : null}
                  {hasWorkshopOffers ? (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={warmOfferTab === "workshop"}
                      className={`text-xs font-medium rounded-full px-2.5 py-1 border transition-colors text-right ${
                        warmOfferTab === "workshop"
                          ? "border-[#7133da]/25 bg-[#f8f5ff] text-[#4b2a86]"
                          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                      onClick={() => setWarmOfferTab("workshop")}
                    >
                      סדנה
                    </button>
                  ) : null}
                  {hasCourseOffers ? (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={warmOfferTab === "course"}
                      className={`text-xs font-medium rounded-full px-2.5 py-1 border transition-colors text-right ${
                        warmOfferTab === "course"
                          ? "border-[#7133da]/25 bg-[#f8f5ff] text-[#4b2a86]"
                          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                      onClick={() => setWarmOfferTab("course")}
                    >
                      קורס
                    </button>
                  ) : null}
                </div>

                {warmOfferTab === "trial" && hasTrialOffers ? (
                  <>
                    <Field label="שאלה 1">
                      <Input
                        dir="rtl"
                        value={experienceQuestionForDisplay(
                          salesFlowConfig.experience_question,
                          trialServiceNames.length > 1 ? firstTrialForTemplates.name : trialServiceNames[0] ?? ""
                        )}
                        onChange={(e) => {
                          const sn =
                            trialServiceNames.length > 1 ? firstTrialForTemplates.name : trialServiceNames[0] ?? "";
                          setSalesFlowConfig((c) => ({
                            ...c,
                            experience_question: experienceQuestionToStore(e.target.value, sn),
                          }));
                        }}
                        placeholder={
                          trialServiceNames.length > 1
                            ? "למשל: יצא לך לנסות בעבר?"
                            : "למשל: יש לך כבר ניסיון בפילאטיס?"
                        }
                      />
                    </Field>
                    <WarmupButtonPairsEditor
                      options={salesFlowConfig.experience_options}
                      replies={salesFlowConfig.experience_replies}
                      onChange={(nextOptions, nextReplies) =>
                        setSalesFlowConfig((c) => ({
                          ...c,
                          experience_options: nextOptions,
                          experience_replies: nextReplies,
                        }))
                      }
                      afterExperienceForDisplay={afterExperienceForDisplay}
                      afterExperienceToStore={afterExperienceToStore}
                      serviceForReply={firstTrialSvcForWarmup}
                    />
                    <SalesFlowExtraStepsEditor
                      steps={salesFlowConfig.opening_extra_steps}
                      onChange={(next) => setSalesFlowConfig((c) => ({ ...c, opening_extra_steps: next }))}
                      addButtonLabel="הוסף שאלה בסשן חימום"
                      startAt={2}
                      uid={uid}
                      afterExperienceForDisplay={afterExperienceForDisplay}
                      afterExperienceToStore={afterExperienceToStore}
                      serviceForReply={firstTrialSvcForWarmup}
                    />
                  </>
                ) : null}

                {warmOfferTab === "workshop" && hasWorkshopOffers ? (
                  <>
                    <Field label="שאלה 1">
                      <Input
                        dir="rtl"
                        value={experienceQuestionForDisplay(
                          salesFlowConfig.experience_question_workshop ?? "",
                          firstWorkshopSvcForWarmup?.name?.trim() ?? ""
                        )}
                        onChange={(e) => {
                          const sn = firstWorkshopSvcForWarmup?.name?.trim() ?? "";
                          setSalesFlowConfig((c) => ({
                            ...c,
                            experience_question_workshop: experienceQuestionToStore(e.target.value, sn),
                          }));
                        }}
                        placeholder="למשל: איזו ציפייה יש לך מהסדנה?"
                      />
                    </Field>
                    <WarmupButtonPairsEditor
                      options={salesFlowConfig.experience_options_workshop ?? []}
                      replies={salesFlowConfig.experience_replies_workshop ?? []}
                      onChange={(nextOptions, nextReplies) =>
                        setSalesFlowConfig((c) => ({
                          ...c,
                          experience_options_workshop: nextOptions,
                          experience_replies_workshop: nextReplies,
                        }))
                      }
                      afterExperienceForDisplay={afterExperienceForDisplay}
                      afterExperienceToStore={afterExperienceToStore}
                      serviceForReply={firstWorkshopSvcForWarmup}
                    />
                    <SalesFlowExtraStepsEditor
                      steps={salesFlowConfig.opening_extra_steps_workshop ?? []}
                      onChange={(next) =>
                        setSalesFlowConfig((c) => ({ ...c, opening_extra_steps_workshop: next }))
                      }
                      addButtonLabel="הוסף שאלה בסשן חימום (סדנה)"
                      startAt={2}
                      uid={uid}
                      afterExperienceForDisplay={afterExperienceForDisplay}
                      afterExperienceToStore={afterExperienceToStore}
                      serviceForReply={firstWorkshopSvcForWarmup}
                    />
                  </>
                ) : null}

                {warmOfferTab === "course" && hasCourseOffers ? (
                  <>
                    <Field label="שאלה 1">
                      <Input
                        dir="rtl"
                        value={experienceQuestionForDisplay(
                          salesFlowConfig.experience_question_course ?? "",
                          firstCourseSvcForWarmup?.name?.trim() ?? ""
                        )}
                        onChange={(e) => {
                          const sn = firstCourseSvcForWarmup?.name?.trim() ?? "";
                          setSalesFlowConfig((c) => ({
                            ...c,
                            experience_question_course: experienceQuestionToStore(e.target.value, sn),
                          }));
                        }}
                        placeholder="למשל: יש לך ניסיון קודם בתחום?"
                      />
                    </Field>
                    <WarmupButtonPairsEditor
                      options={salesFlowConfig.experience_options_course ?? []}
                      replies={salesFlowConfig.experience_replies_course ?? []}
                      onChange={(nextOptions, nextReplies) =>
                        setSalesFlowConfig((c) => ({
                          ...c,
                          experience_options_course: nextOptions,
                          experience_replies_course: nextReplies,
                        }))
                      }
                      afterExperienceForDisplay={afterExperienceForDisplay}
                      afterExperienceToStore={afterExperienceToStore}
                      serviceForReply={firstCourseSvcForWarmup}
                    />
                    <SalesFlowExtraStepsEditor
                      steps={salesFlowConfig.opening_extra_steps_course ?? []}
                      onChange={(next) =>
                        setSalesFlowConfig((c) => ({
                          ...c,
                          opening_extra_steps_course: next,
                        }))
                      }
                      addButtonLabel="הוסף שאלה בסשן חימום (קורס)"
                      startAt={2}
                      uid={uid}
                      afterExperienceForDisplay={afterExperienceForDisplay}
                      afterExperienceToStore={afterExperienceToStore}
                      serviceForReply={firstCourseSvcForWarmup}
                    />
                  </>
                ) : null}
              </>
            )}
          </div>
        </SalesPathSectionBlock>

        {showScheduleSelectionSession ? (
          <SalesPathSectionBlock
            stepPrefix="sales"
            id="schedule_selection"
            title="בחירת מועד"
            hint="נשלח כשאין הרשמה ישירה ממערכת השעות"
            open={openSections.schedule_selection}
            onToggle={() => toggle("schedule_selection")}
            filled={Boolean(String(salesFlowConfig.after_schedule_selection ?? "").trim())}
          >
            <div className="space-y-3">
              <div className="rounded-xl border border-zinc-100 bg-white/80 p-3">
                <p className="mb-2 text-xs font-semibold text-zinc-700">שאלה + כפתורי בחירה</p>
                <div className="whitespace-pre-wrap rounded-lg bg-zinc-50 px-3 py-2 text-sm leading-relaxed text-zinc-800">
                  מתי נוח לך להגיע ל[שם האימון]?
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                  אימון/סדנה: כפתורי מועד לפי הלוח (למשל «יום שני ב19:00»). קורס: פסקת מחזורים + כפתורי «התחלה ב…» לפי מחזורי הקורס בטאב «מוצרים».
                </p>
              </div>

              <Field label="תשובה">
                <Textarea
                  value={salesFlowConfig.after_schedule_selection ?? ""}
                  onChange={(v) =>
                    setSalesFlowConfig((c) => ({
                      ...c,
                      after_schedule_selection: v,
                    }))
                  }
                  rows={2}
                  placeholder="מהמם! נדאג לשבץ אותך ל{serviceName} ביום {requested_date} בשעה {requested_time}"
                />
              </Field>
            </div>
          </SalesPathSectionBlock>
        ) : null}

        <SalesPathSectionBlock
          stepPrefix="sales"
          id="cta"
          title="סשן הנעה לפעולה"
          open={openSections.cta}
          onToggle={() => toggle("cta")}
          filled={Boolean(String(salesFlowConfig.cta_body ?? "").trim())}
          headerAction={
            <Button
              type="button"
              variant="outline"
              className="gap-1 text-xs py-1.5 px-3 h-auto"
              disabled={isSalesGenerating}
              onClick={() => regenerateSalesFlowSection("cta")}
            >
              {isGen("cta") ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {isGen("cta") ? "מג׳נרט..." : "ג׳נרט מחדש"}
            </Button>
          }
        >
          <div className="space-y-4">
            <div
              dir="rtl"
              className="flex w-full flex-wrap gap-2 justify-start pb-1 border-b border-zinc-100 text-right"
              role="tablist"
              aria-label="סוג סשן הנעה לפעולה"
            >
              {hasTrialOffers ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={ctaOfferTab === "trial"}
                  className={`text-xs font-medium rounded-full px-2.5 py-1 border transition-colors text-right ${
                    ctaOfferTab === "trial"
                      ? "border-[#7133da]/25 bg-[#f8f5ff] text-[#4b2a86]"
                      : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                  onClick={() => setCtaOfferTab("trial")}
                >
                  שיעור ניסיון
                </button>
              ) : null}
              {hasWorkshopOffers ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={ctaOfferTab === "workshop"}
                  className={`text-xs font-medium rounded-full px-2.5 py-1 border transition-colors text-right ${
                    ctaOfferTab === "workshop"
                      ? "border-[#7133da]/25 bg-[#f8f5ff] text-[#4b2a86]"
                      : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                  onClick={() => setCtaOfferTab("workshop")}
                >
                  סדנה
                </button>
              ) : null}
              {hasCourseOffers ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={ctaOfferTab === "course"}
                  className={`text-xs font-medium rounded-full px-2.5 py-1 border transition-colors text-right ${
                    ctaOfferTab === "course"
                      ? "border-[#7133da]/25 bg-[#f8f5ff] text-[#4b2a86]"
                      : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                  onClick={() => setCtaOfferTab("course")}
                >
                  קורס
                </button>
              ) : null}
            </div>

            {ctaOfferTab === "trial" && hasTrialOffers ? (
              <>
            <div>
              <Textarea
                value={ctaBodyForDisplay(
                  showScheduleSelectionSession
                    ? salesFlowConfig.cta_body_after_schedule
                    : salesFlowConfig.cta_body
                )}
                onChange={(v) =>
                  setSalesFlowConfig((c) => ({
                    ...c,
                    ...(showScheduleSelectionSession
                      ? {
                          cta_body_after_schedule: ctaBodyToStore(
                            v,
                            firstTrialForTemplates.priceText,
                            firstTrialForTemplates.durationText
                          ),
                        }
                      : {
                          cta_body: ctaBodyToStore(
                            v,
                            firstTrialForTemplates.priceText,
                            firstTrialForTemplates.durationText
                          ),
                        }),
                  }))
                }
                rows={4}
                placeholder={
                  showScheduleSelectionSession
                    ? "עכשיו רק נותר לשריין את מקומך באמצעות תשלום על האימון ניסיון. האימון עולה x שקלים, הוא נמשך x דקות ובאמת שהולך להיות כיף. שנתקדם?"
                    : "מה דעתך להגיע לאימון ניסיון בקרוב? האימון עולה x שקלים, הוא נמשך x דקות ובאמת שהולך להיות כיף."
                }
              />
              <p className="text-[11px] text-zinc-500 mt-1.5 text-center leading-relaxed">
                עלות ומשך האימון ימולאו אוטומטית על בסיס סוג האימון
                {showScheduleSelectionSession ? " · ללא כפתור מערכת שעות (נשלחה כבר בסשן קודם)" : ""}
              </p>
            </div>
            <div
              className={`grid grid-cols-1 gap-3 ${showScheduleSelectionSession ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}
            >
              {trialCtaButtonsForUi.map((b: SalesFlowCtaButton, bi: number) => {
                const locked = ctaLockedKindForSlot(bi, b.id);
                const slotSub = salesFlowSubChoiceForSlot(b, locked);
                return (
                  <div key={b.id} className="space-y-2 rounded-xl border border-zinc-100 bg-white/80 p-3">
                    <Field label={`כפתור ${bi + 1}`}>
                      <Input
                        dir="rtl"
                        value={b.label}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSalesFlowConfig((c) => ({
                            ...c,
                            cta_buttons: c.cta_buttons.map((x: SalesFlowCtaButton) => (x.id === b.id ? { ...x, label: v } : x)),
                          }));
                        }}
                      />
                    </Field>
                    <div className="space-y-1.5">
                      <label className="block text-center text-xs font-medium text-zinc-600">
                        {ctaSlotRoleLabel(locked)}
                      </label>
                      {locked === "trial" ? (
                        <p className="rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-2 text-center text-xs leading-relaxed text-zinc-600">
                          לינק מטאב «מוצרים»
                        </p>
                      ) : (
                        <>
                          <select
                            dir="rtl"
                            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800"
                            value={slotSub}
                            onChange={(e) => {
                              const sub = e.target.value as CtaSlotSubChoice;
                              setSalesFlowConfig((c) => ({
                                ...c,
                                cta_buttons: c.cta_buttons.map((x: SalesFlowCtaButton) =>
                                  x.id === b.id
                                    ? salesFlowApplyLockedSubChoice({ id: x.id, label: x.label }, x, locked, sub)
                                    : x
                                ),
                              }));
                            }}
                          >
                            {locked === "schedule" ? (
                              <>
                                <option value="link">לינק מטאב «לינקים»</option>
                                <option value="image">תמונה</option>
                                <option value="none">ללא</option>
                              </>
                            ) : (
                              <>
                                <option value="link">לינק</option>
                                <option value="range">טווח</option>
                                <option value="none">ללא</option>
                              </>
                            )}
                          </select>
                          {locked === "memberships" && slotSub === "range" ? (
                            <div className="w-full space-y-2 rounded-xl border border-dashed border-zinc-200 bg-[#fafafa] p-3">
                              <p className="text-center text-[11px] font-medium text-zinc-700">
                                טווח מחירים (יאספו להודעת ווטסאפ למנויים/כרטיסיות)
                              </p>
                              <div className="flex flex-row-reverse flex-wrap items-center justify-center gap-x-4 gap-y-2">
                                <div className="flex shrink-0 flex-row-reverse items-center gap-1.5">
                                  <span className="shrink-0 text-xs text-zinc-600">₪</span>
                                  <Input
                                    dir="rtl"
                                    inputMode="decimal"
                                    className="w-24 shrink-0"
                                    placeholder="מספר"
                                    value={String(b.memberships_price_range_min ?? "")}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      setSalesFlowConfig((c) => ({
                                        ...c,
                                        cta_buttons: c.cta_buttons.map((x: SalesFlowCtaButton) =>
                                          x.id === b.id ? { ...x, memberships_price_range_min: v } : x
                                        ),
                                      }));
                                    }}
                                  />
                                  <span className="shrink-0 text-xs font-medium text-zinc-700">בין:</span>
                                </div>
                                <div className="flex shrink-0 flex-row-reverse items-center gap-1.5">
                                  <span className="shrink-0 text-xs text-zinc-600">₪</span>
                                  <Input
                                    dir="rtl"
                                    inputMode="decimal"
                                    className="w-24 shrink-0"
                                    placeholder="מספר"
                                    value={String(b.memberships_price_range_max ?? "")}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      setSalesFlowConfig((c) => ({
                                        ...c,
                                        cta_buttons: c.cta_buttons.map((x: SalesFlowCtaButton) =>
                                          x.id === b.id ? { ...x, memberships_price_range_max: v } : x
                                        ),
                                      }));
                                    }}
                                  />
                                  <span className="shrink-0 text-xs font-medium text-zinc-700">ל־</span>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                    {b.kind === "schedule" && (b.schedule_cta_delivery ?? "link") === "image" ? (
                      <div className="w-full space-y-2 rounded-xl border border-dashed border-zinc-200 bg-[#fafafa] p-3">
                        {planIsStarter ? (
                          <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-center text-[11px] text-amber-800">
                            ⭐ Pro — העלאת תמונה למערכות שעות זמינה בחבילה המורחבת.
                          </p>
                        ) : (
                          <div className="flex flex-col items-stretch space-y-2">
                            <p className="text-center text-[11px] font-medium text-zinc-700">
                              תמונת מערכת השעות (אינסרט לפני תפריט ההמשך)
                            </p>
                            {String(b.schedule_cta_image_url ?? "").trim() ? (
                              <div className="mx-auto max-w-[200px] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={(b.schedule_cta_image_url ?? "").trim()}
                                  alt=""
                                  className="block h-auto max-h-40 w-full object-cover"
                                />
                              </div>
                            ) : null}
                            <div className="flex flex-row-reverse flex-wrap justify-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                className="h-8 gap-1 text-xs"
                                disabled={uploadingScheduleCtaMedia}
                                onClick={() => {
                                  if (planIsStarter) {
                                    onStarterMediaBlocked?.();
                                    return;
                                  }
                                  scheduleCtaMediaInputRef?.current?.click();
                                }}
                              >
                                {uploadingScheduleCtaMedia ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Upload className="h-3.5 w-3.5" />
                                )}
                                {uploadingScheduleCtaMedia ? "מעלה…" : "העלה תמונה"}
                              </Button>
                              {String(b.schedule_cta_image_url ?? "").trim() ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-8 border-red-200 text-xs text-red-600 hover:bg-red-50"
                                  onClick={() =>
                                    setSalesFlowConfig((c) => ({
                                      ...c,
                                      cta_buttons: c.cta_buttons.map((x: SalesFlowCtaButton) =>
                                        x.id === b.id
                                          ? { ...x, schedule_cta_image_url: "", schedule_cta_image_type: "" }
                                          : x
                                      ),
                                    }))
                                  }
                                >
                                  <X className="h-3.5 w-3.5" />
                                  הסר תמונה
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <input
              ref={scheduleCtaMediaInputRef}
              type="file"
              accept="image/jpeg,image/png,image/jpg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) {
                  setScheduleCtaMediaUploadError("");
                  void uploadMedia(f, "schedule_cta");
                }
              }}
            />
            {String(scheduleCtaMediaUploadError ?? "").trim() ? (
              <p className="text-sm text-red-600 text-center" role="alert">
                {String(scheduleCtaMediaUploadError).trim()}
              </p>
            ) : null}
              </>
            ) : null}

            {ctaOfferTab === "workshop" && hasWorkshopOffers ? (
              <>
                <div>
                  <Textarea
                    value={workshopCtaBodyForDisplayUi(salesFlowConfig.cta_workshop_body ?? "")}
                    onChange={(v) =>
                      setSalesFlowConfig((c) => ({
                        ...c,
                        cta_workshop_body: workshopCtaBodyToStore(
                          v,
                          workshopCtaSample.priceText,
                          workshopCtaSample.durationText
                        ),
                      }))
                    }
                    rows={4}
                    placeholder='מה דעתך על הסדנה שלנו? המחיר הוא x שקלים, היא נמשכת x דקות, ובאמת שהולך להיות כיף!'
                  />
                  <p className="text-[11px] text-zinc-500 mt-1.5 text-center leading-relaxed">
                    מחיר ומשך הסדנה יימשכו אוטומטית מהשירותים שמסוג «סדנה» בטאב «מוצרים»
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(salesFlowConfig.cta_workshop_buttons ?? []).map((b: SalesFlowCtaButton, bi: number) => {
                    const purchase = b.kind === "workshop_purchase";
                    const del: SecondaryPurchaseCtaDelivery =
                      b.secondary_purchase_delivery === "phone" ? "phone" : "link";
                    return (
                      <div key={b.id} className="space-y-2 rounded-xl border border-zinc-100 bg-white/80 p-3">
                        <Field label={`כפתור ${bi + 1}`}>
                          <Input
                            dir="rtl"
                            value={b.label}
                            onChange={(e) => {
                              const v = e.target.value;
                              setSalesFlowConfig((c) => ({
                                ...c,
                                cta_workshop_buttons: (c.cta_workshop_buttons ?? []).map((x: SalesFlowCtaButton) =>
                                  x.id === b.id ? { ...x, label: v } : x
                                ),
                              }));
                            }}
                          />
                        </Field>
                        <div className="space-y-1.5">
                          <label className="block text-center text-xs font-medium text-zinc-600">
                            {purchase ? "רכישת סדנה — אפשרות מסירה" : "יצירת קשר"}
                          </label>
                          {purchase ? (
                            <select
                              dir="rtl"
                              className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800"
                              value={del}
                              onChange={(e) => {
                                const next: SecondaryPurchaseCtaDelivery =
                                  e.target.value === "phone" ? "phone" : "link";
                                setSalesFlowConfig((c) => ({
                                  ...c,
                                  cta_workshop_buttons: (c.cta_workshop_buttons ?? []).map((x: SalesFlowCtaButton) =>
                                    x.id === b.id ? { ...x, secondary_purchase_delivery: next } : x
                                  ),
                                }));
                              }}
                            >
                              <option value="link">לינק (משדה השירות בטאב «מוצרים»)</option>
                              <option value="phone">מספר שירות לקוחות מהדשבורד</option>
                            </select>
                          ) : (
                            <p className="rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-2 text-center text-xs leading-relaxed text-zinc-600">
                              מסירה: מספר שירות לקוחות מהדשבורד (קבוע)
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}

            {ctaOfferTab === "course" && hasCourseOffers ? (
              <>
                <div>
                  <Textarea
                    value={courseCtaBodyForDisplayUi(salesFlowConfig.cta_course_body ?? "")}
                    onChange={(v) =>
                      setSalesFlowConfig((c) => ({
                        ...c,
                        cta_course_body: courseCtaBodyToStore(
                          v,
                          courseCtaSample.priceText,
                          courseCtaSample.sessionsText,
                          courseCtaSample.startDate,
                          courseCtaSample.endDate
                        ),
                      }))
                    }
                    rows={4}
                    placeholder="מה דעתך להצטרף לקורס שלנו? המחיר הוא x שקלים, הוא נמשך כ־x מפגשים, ובאמת שהולך להיות כיף! התאריכים: x עד x"
                  />
                  <p className="text-[11px] text-zinc-500 mt-1.5 text-center leading-relaxed">
                    מחיר, מספר מפגשים ותאריכי הקורס יימשכו אוטומטית מהשירותים שמסוג «קורס» בטאב «מוצרים»
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(salesFlowConfig.cta_course_buttons ?? []).map((b: SalesFlowCtaButton, bi: number) => {
                    const enroll = b.kind === "course_enroll";
                    const del: SecondaryPurchaseCtaDelivery =
                      b.secondary_purchase_delivery === "phone" ? "phone" : "link";
                    return (
                      <div key={b.id} className="space-y-2 rounded-xl border border-zinc-100 bg-white/80 p-3">
                        <Field label={`כפתור ${bi + 1}`}>
                          <Input
                            dir="rtl"
                            value={b.label}
                            onChange={(e) => {
                              const v = e.target.value;
                              setSalesFlowConfig((c) => ({
                                ...c,
                                cta_course_buttons: (c.cta_course_buttons ?? []).map((x: SalesFlowCtaButton) =>
                                  x.id === b.id ? { ...x, label: v } : x
                                ),
                              }));
                            }}
                          />
                        </Field>
                        <div className="space-y-1.5">
                          <label className="block text-center text-xs font-medium text-zinc-600">
                            {enroll ? "הצטרפות לקורס — אפשרות מסירה" : "יצירת קשר"}
                          </label>
                          {enroll ? (
                            <select
                              dir="rtl"
                              className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800"
                              value={del}
                              onChange={(e) => {
                                const next: SecondaryPurchaseCtaDelivery =
                                  e.target.value === "phone" ? "phone" : "link";
                                setSalesFlowConfig((c) => ({
                                  ...c,
                                  cta_course_buttons: (c.cta_course_buttons ?? []).map((x: SalesFlowCtaButton) =>
                                    x.id === b.id ? { ...x, secondary_purchase_delivery: next } : x
                                  ),
                                }));
                              }}
                            >
                              <option value="link">לינק (משדה השירות בטאב «מוצרים»)</option>
                              <option value="phone">מספר שירות לקוחות מהדשבורד</option>
                            </select>
                          ) : (
                            <p className="rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-2 text-center text-xs leading-relaxed text-zinc-600">
                              מסירה: מספר שירות לקוחות מהדשבורד (קבוע)
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}
          </div>
        </SalesPathSectionBlock>

        <SalesPathSectionBlock
          stepPrefix="sales"
          id="after_trial"
          title="אחרי הרשמה"
          open={openSections.after_trial}
          onToggle={() => toggle("after_trial")}
          filled={Boolean(salesFlowConfig.after_trial_registration_body?.trim())}
          headerAction={
            <Button
              type="button"
              variant="outline"
              className="gap-1 text-xs py-1.5 px-3 h-auto"
              disabled={isSalesGenerating}
              onClick={() => regenerateSalesFlowSection("after_trial_registration")}
            >
              {isGen("after_trial_registration") ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {isGen("after_trial_registration") ? "מג׳נרט..." : "ג׳נרט מחדש"}
            </Button>
          }
        >
          <div className="space-y-3">
            <p className="text-xs text-zinc-600 text-center leading-relaxed">יושלם אוטומטית מ«על העסק»</p>
            <Field label="תבנית להודעה ללקוח (זואי ממלאת פרטים)">
              <Textarea
                value={
                  showScheduleSelectionSession
                    ? salesFlowConfig.after_trial_registration_body_after_schedule
                    : salesFlowConfig.after_trial_registration_body
                }
                onChange={(v) =>
                  setSalesFlowConfig((c) => ({
                    ...c,
                    ...(showScheduleSelectionSession
                      ? { after_trial_registration_body_after_schedule: v }
                      : { after_trial_registration_body: v }),
                  }))
                }
                rows={12}
                placeholder={
                  showScheduleSelectionSession
                    ? "מתרגשים לראותך בקרוב ב{serviceName} בתאריך {requested_date} בשעה {requested_time}…"
                    : undefined
                }
              />
            </Field>
            {showScheduleSelectionSession ? (
              <p className="text-[11px] text-zinc-500 text-center leading-relaxed">
                בווטסאפ ימולאו אוטומטית שם האימון, התאריך והשעה שהליד בחר בסשן «יום ושעה»
              </p>
            ) : null}
          </div>
        </SalesPathSectionBlock>
      </SalesPathStepShell>
    </StepPanel>
  );
}

