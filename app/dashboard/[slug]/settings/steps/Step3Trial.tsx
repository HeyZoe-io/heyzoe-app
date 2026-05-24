"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { GripVertical, Link, Loader2, Plus, Sparkles, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StepPanel } from "../settings-ui";
import {
  SALES_PATH_INPUT,
  SALES_PATH_TEXTAREA,
  SalesPathFieldLabel,
  SalesPathSectionBlock,
  SalesPathStepShell,
  useSalesPathSections,
} from "./sales-path-shell";
import { TRIAL_SERVICE_NAME_MAX_CHARS } from "@/lib/trial-service";
import { normalizeMasculinePredicatesAfterPracticeHead, type OfferKind } from "@/lib/sales-flow";

/** מפתח busyAction לג׳ינרט benefit_line מטאב אימון ניסיון */
const TRIAL_BENEFIT_BUSY_PREFIX = "trialBenefit:";

const PRODUCT_INPUT = SALES_PATH_INPUT;

function rtlCheckboxLabelRowClassName(fullWidth = true) {
  return [
    "flex flex-row items-center justify-end gap-3 text-right cursor-pointer select-none",
    fullWidth ? "w-full" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

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
  trial_pick_media_type: "" | "image" | "video";
};

/** צירוף מדיה: מוצג רק לאחר סימון; שומר הסרה מלאה בביטול סימון */
function TrialPickMediaAttachmentSection(props: {
  planIsStarter?: boolean;
  onStarterMediaBlocked?: () => void;
  uploadTrialPickMedia: (file: File, uiId: string) => void | Promise<void>;
  uploadingTrialPickUiId: string | null;
  trialPickMediaUploadError: string;
  trialPickFailedUiId: string | null;
  videoUrlForPreview: (url: string) => string;
  service: ServiceItem;
  setServices: Dispatch<SetStateAction<ServiceItem[]>>;
}) {
  const {
    planIsStarter,
    onStarterMediaBlocked,
    uploadTrialPickMedia,
    uploadingTrialPickUiId,
    trialPickMediaUploadError,
    trialPickFailedUiId,
    videoUrlForPreview,
    service,
    setServices,
  } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const url = String(service.trial_pick_media_url ?? "").trim();
  const hasMedia = Boolean(url);
  const [attachMedia, setAttachMedia] = useState(hasMedia);

  useEffect(() => {
    if (hasMedia) setAttachMedia(true);
  }, [hasMedia]);

  const isVideo = service.trial_pick_media_type === "video";
  const busy = uploadingTrialPickUiId === service.ui_id;
  const err = String(trialPickMediaUploadError ?? "").trim();
  const showPreview = Boolean(url) && !(err && trialPickFailedUiId === service.ui_id);
  const showRowUploadError = Boolean(err && trialPickFailedUiId === service.ui_id);

  const onToggleAttach = (checked: boolean) => {
    setAttachMedia(checked);
    if (!checked) {
      setServices((prev) =>
        prev.map((x) =>
          x.ui_id === service.ui_id ? { ...x, trial_pick_media_url: "", trial_pick_media_type: "" } : x
        )
      );
    }
  };

  return (
    <div className="rounded-lg border border-zinc-200/80 bg-zinc-50/40 p-4 text-right">
      <div className="space-y-1">
        <label dir="rtl" className={rtlCheckboxLabelRowClassName(true)}>
          <input
            type="checkbox"
            checked={attachMedia}
            onChange={(e) => onToggleAttach(e.target.checked)}
            className="h-4 w-4 shrink-0 rounded border-zinc-300 text-[#7133da] accent-[#7133da] focus:ring-2 focus:ring-[#7133da]/25 focus:ring-offset-2 focus:ring-offset-white"
          />
          <span className="text-sm font-semibold text-zinc-800 tracking-tight">צירוף מדיה</span>
        </label>
        {planIsStarter ? (
          <p className="text-[11px] font-semibold text-amber-600 text-center" title="זמין בחבילת Pro">
            ⭐ Pro
          </p>
        ) : null}
      </div>

      {attachMedia ? (
        <div className="mt-4 pt-4 border-t border-[rgba(113,51,218,0.1)] space-y-3 transition-opacity duration-200">
          {!showPreview ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (planIsStarter) {
                  onStarterMediaBlocked?.();
                  return;
                }
                inputRef.current?.click();
              }}
              className="w-full rounded-2xl border-2 border-dashed border-[rgba(113,51,218,0.22)] bg-white/70 px-4 py-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[#7133da]/45 hover:bg-[#f7f3ff]/60 transition-colors disabled:opacity-60 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
            >
              {busy ? (
                <>
                  <Loader2 className="h-7 w-7 animate-spin text-[#7133da]/65" aria-hidden />
                  <p className="text-xs text-zinc-500">מעלה…</p>
                </>
              ) : (
                <>
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#f3edff]/90 text-[#7133da]">
                    <Upload className="h-5 w-5 opacity-85" aria-hidden />
                  </div>
                  <p className="text-sm font-medium text-zinc-700">העלאת תמונה או סרטון</p>
                  <p className="text-[11px] text-zinc-500">עד 16MB · JPG, PNG, GIF, MP4</p>
                </>
              )}
            </button>
          ) : (
            <div className="rounded-2xl border border-[rgba(113,51,218,0.12)] bg-white/85 p-3 space-y-3 shadow-inner">
              {isVideo ? (
                <video
                  src={videoUrlForPreview(url)}
                  className="mx-auto block max-h-48 max-w-full rounded-xl bg-black"
                  muted
                  playsInline
                  preload="metadata"
                  controls
                />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={url} alt="" className="mx-auto block max-h-48 max-w-full rounded-xl object-contain" />
              )}
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1.5 text-xs h-9 rounded-xl border-[rgba(113,51,218,0.2)] bg-white hover:bg-[#f7f3ff]"
                  disabled={busy}
                  onClick={() => {
                    if (planIsStarter) {
                      onStarterMediaBlocked?.();
                      return;
                    }
                    inputRef.current?.click();
                  }}
                >
                  <Upload className="h-3.5 w-3.5" /> החלף
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1.5 text-xs h-9 rounded-xl text-red-600 border-red-200/80 hover:bg-red-50/80"
                  onClick={() =>
                    setServices((prev) =>
                      prev.map((x) =>
                        x.ui_id === service.ui_id ? { ...x, trial_pick_media_url: "", trial_pick_media_type: "" } : x
                      )
                    )
                  }
                >
                  <X className="h-3.5 w-3.5" /> הסר
                </Button>
              </div>
            </div>
          )}
          {showRowUploadError ? (
            <p
              className="text-sm text-red-700 text-center px-3 py-2.5 rounded-xl border border-red-200/80 bg-red-50/90 leading-snug"
              role="alert"
            >
              {err}
            </p>
          ) : null}
          <input
            ref={inputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void uploadTrialPickMedia(f, service.ui_id);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

export default function Step3Trial(props: {
  websiteUrl: string;
  address: string;
  fetchingUrl: boolean;
  services: ServiceItem[];
  setServices: React.Dispatch<React.SetStateAction<ServiceItem[]>>;
  fetchSite: (nextStepAfterScan?: number) => Promise<void>;
  deriveBenefitLineFromDescription: (serviceName: string, description: string) => string;
  isLegacyGeneratedServiceReply: (value: string, serviceName: string) => boolean;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragStart: (index: number) => void;
  onDragEnd: () => void;
  toSlug: (name: string) => string;
  uid: () => string;
  planIsStarter?: boolean;
  onStarterMediaBlocked?: () => void;
  uploadTrialPickMedia: (file: File, uiId: string) => void | Promise<void>;
  uploadingTrialPickUiId: string | null;
  trialPickMediaUploadError: string;
  trialPickFailedUiId: string | null;
  videoUrlForPreview: (url: string) => string;
  busyAction: string | null;
  runBusy: (key: string, fn: () => void | Promise<void>) => void;
  /** לאחר עדכון תיאור באימון — debounce לג׳נרט «בחירת סוג האימון» בטאב מכירה */
  scheduleAutoRegenSalesFromTrialDescription?: () => void;
  /** אחרי «ג׳נרט» ליד התיאור — מיידית (לא מחכה ל-debounce) */
  flushAutoRegenSalesFromTrialDescription?: () => void;
}) {
  const {
    websiteUrl,
    address,
    fetchingUrl,
    services,
    setServices,
    fetchSite,
    deriveBenefitLineFromDescription,
    isLegacyGeneratedServiceReply,
    onDragOver,
    onDragStart,
    onDragEnd,
    toSlug,
    uid,
    planIsStarter,
    onStarterMediaBlocked,
    uploadTrialPickMedia,
    uploadingTrialPickUiId,
    trialPickMediaUploadError,
    trialPickFailedUiId,
    videoUrlForPreview,
    busyAction,
    runBusy,
    scheduleAutoRegenSalesFromTrialDescription,
    flushAutoRegenSalesFromTrialDescription,
  } = props;

  const activeTrialBenefitUiId = useMemo(() => {
    if (typeof busyAction !== "string" || !busyAction.startsWith(TRIAL_BENEFIT_BUSY_PREFIX)) return null;
    const id = busyAction.slice(TRIAL_BENEFIT_BUSY_PREFIX.length);
    return id.trim() ? id : null;
  }, [busyAction]);

  const isTrialBenefitGenerating = activeTrialBenefitUiId !== null;

  type ProductsSectionId = "scan" | "products";
  const PRODUCT_SECTIONS = [
    { id: "scan" as const, label: "סריקה", hint: "מהאתר" },
    { id: "products" as const, label: "מוצרים", hint: "ההצעות שלכם" },
  ];
  const { openSections, toggle, scrollToSection, activeNav, mainRef, setStepPrefix } =
    useSalesPathSections<ProductsSectionId>(PRODUCT_SECTIONS, { scan: true, products: true });

  useEffect(() => {
    setStepPrefix("products");
  }, [setStepPrefix]);

  const productsFilled = services.some((s) => s.name.trim());

  return (
    <StepPanel className="!text-right [&_input]:!text-right [&_textarea]:!text-right">
      <SalesPathStepShell
        stepNumber={3}
        title="מוצרים"
        description={"מה זואי תציע לליד? סרקו מהאתר, הגדירו אימון ניסיון\\סדנה\\קורס וערכו"}
        stepPrefix="products"
        sections={PRODUCT_SECTIONS}
        activeNav={activeNav}
        onNavClick={scrollToSection}
        mainRef={mainRef}
        navAriaLabel="ניווט בתוך מוצרים"
      >
        <SalesPathSectionBlock
          stepPrefix="products"
          id="scan"
          title="סריקה מהאתר"
          open={openSections.scan}
          onToggle={() => toggle("scan")}
          filled={Boolean(websiteUrl.trim())}
        >
        <div
          dir="rtl"
          className="rounded-lg border border-zinc-200/80 bg-zinc-50/60 px-4 py-4 space-y-3"
        >
          <div className="flex justify-center w-full">
            <Button
              type="button"
              variant="outline"
              className="gap-2 h-10 text-sm shadow-sm border-[#7133da]/25 bg-white hover:bg-[#f7f3ff]"
              onClick={() => void fetchSite(3)}
              disabled={!websiteUrl.trim() || fetchingUrl}
            >
              {fetchingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {fetchingUrl ? "סורק..." : "סרוק מהאתר"}
            </Button>
          </div>
          <p className="text-xs text-zinc-600 leading-snug text-center w-full">
            {!websiteUrl.trim()
              ? "הוסיפו כתובת אתר בטאב «לינקים חשובים» ולחצו «סרוק» כדי למלא את הרשימה."
              : "הסריקה לא תשנה מוצרים שכבר הזנתם, רק תוסיף חדשים במידה וזוהו."}
          </p>
        </div>
        </SalesPathSectionBlock>

        <SalesPathSectionBlock
          stepPrefix="products"
          id="products"
          title="רשימת מוצרים"
          hint={`${services.length} פריטים`}
          open={openSections.products}
          onToggle={() => toggle("products")}
          filled={productsFilled}
        >
        {services.map((s, i) => (
          <article
            key={s.ui_id}
            onDragOver={(e) => onDragOver(e, i)}
            className="overflow-hidden rounded-xl border border-zinc-200/80 bg-white transition-colors hover:border-[#7133da]/25"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50/60 px-3 py-2.5" dir="rtl">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    onDragStart(i);
                  }}
                  onDragEnd={(e) => {
                    e.stopPropagation();
                    onDragEnd();
                  }}
                  className="inline-flex cursor-grab touch-none items-center justify-center rounded p-1 text-zinc-300 hover:text-zinc-500 active:cursor-grabbing"
                  aria-label="גרירה לשינוי סדר"
                  title="גררו מהאייקון כדי לסדר מחדש"
                >
                  <GripVertical className="h-4 w-4 pointer-events-none" />
                </span>
                <span className="text-xs font-medium text-zinc-500">מוצר {i + 1}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { k: "trial" as const, label: "אימון ניסיון" },
                    { k: "workshop" as const, label: "סדנה" },
                    { k: "course" as const, label: "קורס" },
                  ] as const
                ).map(({ k, label }) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      const arr = [...services];
                      arr[i] = { ...s, offer_kind: k };
                      setServices(arr);
                    }}
                    className={[
                      "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                      s.offer_kind === k
                        ? "border-[#7133da]/50 bg-[#f3edff] text-[#2d1a6e]"
                        : "border-zinc-200 bg-white text-zinc-600 hover:border-[#7133da]/30",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setServices((sv) => sv.filter((_, j) => j !== i))}
                  className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500"
                  aria-label="הסר אימון"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="space-y-4 p-4">
              <div>
                <SalesPathFieldLabel hint={`עד ${TRIAL_SERVICE_NAME_MAX_CHARS} תווים`}>שם האימון</SalesPathFieldLabel>
                <Input
                  dir="rtl"
                  value={s.name}
                  maxLength={TRIAL_SERVICE_NAME_MAX_CHARS}
                  onChange={(e) => {
                    const arr = [...services];
                    const newName = [...e.target.value].slice(0, TRIAL_SERVICE_NAME_MAX_CHARS).join("");
                    const slugFromName = toSlug(newName);
                    arr[i] = {
                      ...s,
                      name: newName,
                      service_slug: slugFromName || s.service_slug || `trial-${s.ui_id}`,
                    };
                    setServices(arr);
                  }}
                  placeholder="למשל אימון ניסיון"
                  className={PRODUCT_INPUT}
                />
              </div>

            {s.offer_kind === "course" ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <SalesPathFieldLabel>מחיר</SalesPathFieldLabel>
                  <Input
                    dir="rtl"
                    value={s.price_text}
                    onChange={(e) => {
                      const arr = [...services];
                      arr[i] = { ...s, price_text: e.target.value };
                      setServices(arr);
                    }}
                    placeholder="₪ 80"
                    className={PRODUCT_INPUT}
                  />
                </div>
                <div>
                  <SalesPathFieldLabel>תאריך התחלה</SalesPathFieldLabel>
                  <Input
                    dir="ltr"
                    type="date"
                    className={`${PRODUCT_INPUT} font-mono text-sm`}
                    value={s.course_start_date}
                    onChange={(e) => {
                      const arr = [...services];
                      arr[i] = { ...s, course_start_date: e.target.value };
                      setServices(arr);
                    }}
                  />
                </div>
                <div>
                  <SalesPathFieldLabel>תאריך סיום</SalesPathFieldLabel>
                  <Input
                    dir="ltr"
                    type="date"
                    className={`${PRODUCT_INPUT} font-mono text-sm`}
                    value={s.course_end_date}
                    onChange={(e) => {
                      const arr = [...services];
                      arr[i] = { ...s, course_end_date: e.target.value };
                      setServices(arr);
                    }}
                  />
                </div>
                <div>
                  <SalesPathFieldLabel>מספר מפגשים</SalesPathFieldLabel>
                  <Input
                    dir="rtl"
                    inputMode="numeric"
                    value={s.course_sessions_count}
                    onChange={(e) => {
                      const arr = [...services];
                      arr[i] = { ...s, course_sessions_count: e.target.value };
                      setServices(arr);
                    }}
                    placeholder="למשל 8"
                    className={PRODUCT_INPUT}
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <SalesPathFieldLabel>מחיר</SalesPathFieldLabel>
                  <Input
                    dir="rtl"
                    value={s.price_text}
                    onChange={(e) => {
                      const arr = [...services];
                      arr[i] = { ...s, price_text: e.target.value };
                      setServices(arr);
                    }}
                    placeholder="₪ 80"
                    className={PRODUCT_INPUT}
                  />
                </div>
                <div>
                  <SalesPathFieldLabel>משך (דקות)</SalesPathFieldLabel>
                  <Input
                    dir="rtl"
                    value={s.duration}
                    onChange={(e) => {
                      const arr = [...services];
                      arr[i] = { ...s, duration: e.target.value };
                      setServices(arr);
                    }}
                    placeholder="60"
                    className={PRODUCT_INPUT}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <SalesPathFieldLabel>לינק סליקה *</SalesPathFieldLabel>
                <div className="flex min-w-0 items-center gap-2">
                  <Link className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
                  <Input
                    dir="ltr"
                    value={s.payment_link}
                    onChange={(e) => {
                      const arr = [...services];
                      arr[i] = { ...s, payment_link: e.target.value };
                      setServices(arr);
                    }}
                    placeholder="https://..."
                    className={`${PRODUCT_INPUT} min-w-0 flex-1 text-left font-mono text-sm`}
                  />
                </div>
              </div>
              <div>
                <SalesPathFieldLabel>מיקום</SalesPathFieldLabel>
                <Input
                  dir="rtl"
                  value={s.location_text}
                  onChange={(e) => {
                    const arr = [...services];
                    arr[i] = { ...s, location_text: e.target.value };
                    setServices(arr);
                  }}
                  placeholder={address || "תל אביב"}
                  className={PRODUCT_INPUT}
                />
              </div>
            </div>

            <div>
              <SalesPathFieldLabel
                action={
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 gap-1 px-2.5 text-xs"
                    disabled={isTrialBenefitGenerating}
                    onClick={() => {
                      runBusy(`${TRIAL_BENEFIT_BUSY_PREFIX}${s.ui_id}`, () => {
                        setServices((prev) =>
                          prev.map((row) => {
                            if (row.ui_id !== s.ui_id) return row;
                            const description = normalizeMasculinePredicatesAfterPracticeHead(
                              String(row.description ?? "")
                            );
                            return {
                              ...row,
                              description,
                              benefit_line: deriveBenefitLineFromDescription(String(row.name ?? ""), description),
                            };
                          })
                        );
                        flushAutoRegenSalesFromTrialDescription?.();
                      });
                    }}
                  >
                    {activeTrialBenefitUiId === s.ui_id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {activeTrialBenefitUiId === s.ui_id ? "מג׳נרט..." : "ג׳נרט"}
                  </Button>
                }
              >
                תיאור
              </SalesPathFieldLabel>
              <textarea
                dir="rtl"
                value={s.description}
                onChange={(e) => {
                  const nextDesc = e.target.value;
                  const arr = [...services];
                  const prevBenefit = String(s.benefit_line ?? "");
                  const shouldAuto =
                    !prevBenefit.trim() || isLegacyGeneratedServiceReply(prevBenefit, String(s.name ?? ""));
                  arr[i] = {
                    ...s,
                    description: nextDesc,
                    ...(shouldAuto
                      ? { benefit_line: deriveBenefitLineFromDescription(String(s.name ?? ""), nextDesc) }
                      : null),
                  };
                  setServices(arr);
                  scheduleAutoRegenSalesFromTrialDescription?.();
                }}
                placeholder="תיאור קצר על האימון (ייסרק מהאתר אם קיים)"
                rows={4}
                className={SALES_PATH_TEXTAREA}
              />
            </div>

            <div className="space-y-3 rounded-lg border border-zinc-200/80 bg-zinc-50/40 p-4 text-right">
              <label dir="rtl" className={rtlCheckboxLabelRowClassName(true)}>
                <input
                  type="checkbox"
                  checked={s.levels_enabled}
                  onChange={(e) => {
                    const arr = [...services];
                    arr[i] = {
                      ...s,
                      levels_enabled: e.target.checked,
                      levels:
                        e.target.checked && s.levels.filter((level) => level.trim()).length === 0
                          ? ["מתחילים", "מתקדמים"]
                          : s.levels,
                    };
                    setServices(arr);
                  }}
                  className="h-4 w-4 shrink-0 rounded border-zinc-300 text-[#7133da] accent-[#7133da] focus:ring-2 focus:ring-[#7133da]/25 focus:ring-offset-2 focus:ring-offset-white"
                />
                <span className="text-sm font-semibold text-zinc-800 tracking-tight">חלוקה לרמות</span>
              </label>
              {s.levels_enabled ? (
                <div className="space-y-2 border-t border-zinc-200/70 pt-3">
                  {(s.levels.length ? s.levels : ["מתחילים", "מתקדמים"]).map((level, levelIndex) => (
                    <div key={`${s.ui_id}-level-${levelIndex}`} className="flex items-center gap-2">
                      <Input
                        dir="rtl"
                        value={level}
                        onChange={(e) => {
                          const arr = [...services];
                          const nextLevels = [...(s.levels.length ? s.levels : ["מתחילים", "מתקדמים"])];
                          nextLevels[levelIndex] = e.target.value;
                          arr[i] = { ...s, levels: nextLevels };
                          setServices(arr);
                        }}
                        placeholder={
                          levelIndex === 0 ? "מתחילים" : levelIndex === 1 ? "מתקדמים" : "רמה נוספת"
                        }
                        className={`${PRODUCT_INPUT} flex-1`}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const arr = [...services];
                          const nextLevels = [...(s.levels.length ? s.levels : ["מתחילים", "מתקדמים"])];
                          nextLevels.splice(levelIndex, 1);
                          arr[i] = { ...s, levels: nextLevels };
                          setServices(arr);
                        }}
                        className="shrink-0 rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500"
                        aria-label="הסר רמה"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 w-full gap-1 border-dashed text-xs"
                    onClick={() => {
                      const arr = [...services];
                      arr[i] = { ...s, levels: [...s.levels, ""] };
                      setServices(arr);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    הוסף רמה
                  </Button>
                </div>
              ) : null}
            </div>

            <TrialPickMediaAttachmentSection
              planIsStarter={planIsStarter}
              onStarterMediaBlocked={onStarterMediaBlocked}
              uploadTrialPickMedia={uploadTrialPickMedia}
              uploadingTrialPickUiId={uploadingTrialPickUiId}
              trialPickMediaUploadError={trialPickMediaUploadError}
              trialPickFailedUiId={trialPickFailedUiId}
              videoUrlForPreview={videoUrlForPreview}
              service={s}
              setServices={setServices}
            />
            </div>
          </article>
        ))}

        <Button
          variant="outline"
          onClick={() =>
            setServices((sv) => [
              ...sv,
              {
                ui_id: uid(),
                name: "",
                price_text: "",
                duration: "",
                payment_link: "",
                service_slug: "",
                location_text: address,
                description: "",
                levels_enabled: false,
                levels: [],
                offer_kind: "trial",
                course_start_date: "",
                course_end_date: "",
                course_sessions_count: "",
                benefit_line: "",
                trial_pick_media_url: "",
                trial_pick_media_type: "",
              },
            ])
          }
          className="w-full gap-2"
        >
          <Plus className="h-4 w-4" /> הוסף אימון
        </Button>
        </SalesPathSectionBlock>
      </SalesPathStepShell>
    </StepPanel>
  );
}

