"use client";

import { useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { GripVertical, Link, Loader2, Plus, Sparkles, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, StepHeader } from "../settings-ui";
import { TRIAL_SERVICE_NAME_MAX_CHARS } from "@/lib/trial-service";

/** מפתח busyAction לג׳ינרט benefit_line מטאב אימון ניסיון */
const TRIAL_BENEFIT_BUSY_PREFIX = "trialBenefit:";

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
  benefit_line: string;
  trial_pick_media_url: string;
  trial_pick_media_type: "" | "image" | "video";
};

function TrialPickMediaUploadRow(props: {
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
  const isVideo = service.trial_pick_media_type === "video";
  const busy = uploadingTrialPickUiId === service.ui_id;
  const err = String(trialPickMediaUploadError ?? "").trim();
  const showPreview = Boolean(url) && !(err && trialPickFailedUiId === service.ui_id);
  const showRowUploadError = Boolean(err && trialPickFailedUiId === service.ui_id);

  return (
    <div className="pt-3 mt-3 border-t border-zinc-100 space-y-2">
      <div className="flex flex-row-reverse items-center gap-2 justify-start flex-wrap">
        <span className="text-xs font-medium text-zinc-700">מדיה עם התשובה בבחירת אימון (אופציונלי)</span>
        {planIsStarter ? (
          <span className="text-[11px] font-semibold text-amber-600 shrink-0" title="זמין בחבילת Pro">
            ⭐ Pro
          </span>
        ) : null}
      </div>
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
          className="w-full border-2 border-dashed border-zinc-200 rounded-xl p-5 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[#7133da]/40 hover:bg-[#f7f3ff]/50 transition-all disabled:opacity-60"
        >
          {busy ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-[#7133da]/60" />
              <p className="text-xs text-zinc-500">מעלה…</p>
            </>
          ) : (
            <>
              <Upload className="h-6 w-6 text-zinc-400" />
              <p className="text-xs text-zinc-600">לחץ להעלאת תמונה או סרטון</p>
              <p className="text-[11px] text-zinc-400">עד 16MB · JPG, PNG, GIF, MP4</p>
            </>
          )}
        </button>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 space-y-2">
          {isVideo ? (
            <video
              src={videoUrlForPreview(url)}
              className="mx-auto block max-h-48 max-w-full rounded-lg bg-black"
              muted
              playsInline
              preload="metadata"
              controls
            />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={url} alt="" className="mx-auto block max-h-48 max-w-full rounded-lg object-contain" />
          )}
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="gap-1 text-xs h-8"
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
              className="gap-1 text-xs h-8 text-red-600 border-red-200"
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
          className="text-sm text-red-700 text-right mt-2 px-3 py-2 rounded-xl border border-red-200 bg-red-50/80 leading-snug"
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
  } = props;

  const activeTrialBenefitUiId = useMemo(() => {
    if (typeof busyAction !== "string" || !busyAction.startsWith(TRIAL_BENEFIT_BUSY_PREFIX)) return null;
    const id = busyAction.slice(TRIAL_BENEFIT_BUSY_PREFIX.length);
    return id.trim() ? id : null;
  }, [busyAction]);

  const isTrialBenefitGenerating = activeTrialBenefitUiId !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <StepHeader
            n={3}
            title="אימון ניסיון"
            desc="אילו אימוני ניסיון אתם מציעים? ניתן לסרוק מהאתר, לערוך ולכתוב עצמאית."
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="-mt-2 sm:mt-0 rounded-xl border border-zinc-200 bg-gradient-to-b from-[#faf8ff] to-zinc-50/90 px-4 py-4 sm:py-5 text-center space-y-3">
          <Button
            type="button"
            variant="outline"
            className="gap-2 h-10 text-sm mx-auto shadow-sm border-[#7133da]/25 bg-white hover:bg-[#f7f3ff]"
            onClick={() => void fetchSite(3)}
            disabled={!websiteUrl.trim() || fetchingUrl}
          >
            {fetchingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {fetchingUrl ? "סורק..." : "סרוק מהאתר"}
          </Button>
          <p className="text-xs text-zinc-600 text-right leading-snug max-w-md mx-auto">
            {!websiteUrl.trim()
              ? "הוסיפו כתובת אתר בטאב «לינקים חשובים» ולחצו «סרוק» כדי למלא את הרשימה."
              : "הסריקה לא תשנה אימונים שכבר הזנתם, רק תוסיף חדשים במידה וזוהו."}
          </p>
        </div>

        {services.map((s, i) => (
          <div
            key={s.ui_id}
            onDragOver={(e) => onDragOver(e, i)}
            className="border border-[rgba(113,51,218,0.1)] rounded-2xl p-4 space-y-3 bg-white hover:border-[rgba(113,51,218,0.25)] transition-colors"
          >
            <div className="flex gap-2 items-center">
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
                className="inline-flex items-center justify-center p-1 -m-1 rounded-lg cursor-grab active:cursor-grabbing text-zinc-300 hover:text-zinc-500 shrink-0 touch-none select-none"
                aria-label="גרירה לשינוי סדר"
                title="גררו מהאייקון כדי לסדר מחדש"
              >
                <GripVertical className="h-4 w-4 pointer-events-none" />
              </span>
              <div className="flex-1 space-y-1">
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
                  placeholder="שם האימון (עד 15 תווים) *"
                  className="font-medium w-full"
                />
                <p className="text-[11px] text-zinc-500 text-right leading-snug pr-0.5">{`עד ${TRIAL_SERVICE_NAME_MAX_CHARS} תווים`}</p>
              </div>
              <button
                type="button"
                onClick={() => setServices((sv) => sv.filter((_, j) => j !== i))}
                className="p-1 text-zinc-400 hover:text-red-400"
                aria-label="הסר אימון"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="מחיר">
                <Input
                  dir="rtl"
                  value={s.price_text}
                  onChange={(e) => {
                    const arr = [...services];
                    arr[i] = { ...s, price_text: e.target.value };
                    setServices(arr);
                  }}
                  placeholder="₪ 80"
                />
              </Field>
              <Field label="משך">
                <Input
                  dir="rtl"
                  value={s.duration}
                  onChange={(e) => {
                    const arr = [...services];
                    arr[i] = { ...s, duration: e.target.value };
                    setServices(arr);
                  }}
                  placeholder="60 דק׳"
                />
              </Field>
            </div>

            <Field label="לינק סליקה *">
              <div className="flex gap-2 items-center">
                <Link className="h-4 w-4 text-zinc-400 shrink-0" />
                <Input
                  dir="ltr"
                  value={s.payment_link}
                  onChange={(e) => {
                    const arr = [...services];
                    arr[i] = { ...s, payment_link: e.target.value };
                    setServices(arr);
                  }}
                  placeholder="https://..."
                />
              </div>
            </Field>

            <Field label="מיקום">
              <Input
                dir="rtl"
                value={s.location_text}
                onChange={(e) => {
                  const arr = [...services];
                  arr[i] = { ...s, location_text: e.target.value };
                  setServices(arr);
                }}
                placeholder={address || "תל אביב"}
              />
            </Field>

            <Field
              label={
                <div className="flex flex-row-reverse flex-wrap items-center justify-between gap-2">
                  <span>תיאור</span>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 gap-1 text-xs shrink-0 border-[#7133da]/25 bg-white hover:bg-[#f7f3ff]"
                    disabled={isTrialBenefitGenerating}
                    onClick={() => {
                      runBusy(`${TRIAL_BENEFIT_BUSY_PREFIX}${s.ui_id}`, () => {
                        setServices((prev) =>
                          prev.map((row) =>
                            row.ui_id === s.ui_id
                              ? {
                                  ...row,
                                  benefit_line: deriveBenefitLineFromDescription(
                                    String(row.name ?? ""),
                                    String(row.description ?? "")
                                  ),
                                }
                              : row
                          )
                        );
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
                </div>
              }
              description="מייצר מחדש את ניסוח ההודעה אחרי בחירת האימון בשלב המכירות, לפי השם והתיאור הנוכחיים."
            >
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
                }}
                placeholder="תיאור קצר על האימון (ייסרק מהאתר אם קיים)"
                rows={4}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-[#7133da]/50"
              />
            </Field>

            <div className="space-y-3 rounded-xl border border-zinc-100 bg-zinc-50/70 p-3 text-right">
              <label className="flex flex-row-reverse items-center justify-end gap-2 text-right text-sm font-medium text-zinc-700">
                <span>חלוקה לרמות</span>
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
                  className="h-4 w-4 rounded border-zinc-300"
                />
              </label>
              {s.levels_enabled ? (
                <div className="space-y-2 text-right">
                  {(s.levels.length ? s.levels : ["מתחילים", "מתקדמים"]).map((level, levelIndex) => (
                    <div key={`${s.ui_id}-level-${levelIndex}`} className="flex flex-row-reverse items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const arr = [...services];
                          const nextLevels = [...(s.levels.length ? s.levels : ["מתחילים", "מתקדמים"])];
                          nextLevels.splice(levelIndex, 1);
                          arr[i] = { ...s, levels: nextLevels };
                          setServices(arr);
                        }}
                        className="p-1 text-zinc-400 hover:text-red-400"
                        aria-label="הסר רמה"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
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
                      />
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full gap-2 text-right"
                    onClick={() => {
                      const arr = [...services];
                      arr[i] = { ...s, levels: [...s.levels, ""] };
                      setServices(arr);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    הוסף רמה
                  </Button>
                </div>
              ) : null}
            </div>

            <TrialPickMediaUploadRow
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
      </CardContent>
    </Card>
  );
}

