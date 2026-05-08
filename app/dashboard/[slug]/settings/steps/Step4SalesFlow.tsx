"use client";

import {
  Loader2,
  Sparkles,
  Upload,
  X,
  Trash2,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, StepHeader, Textarea } from "../settings-ui";
import type { SalesFlowCtaButton, SalesFlowExtraStep } from "@/lib/sales-flow";

export default function Step4SalesFlow(props: any) {
  const {
    planIsStarter,
    onStarterMediaBlocked,
    openingMediaUrl,
    openingMediaType,
    uploadingMedia,
    mediaInputRef,
    uploadMedia,
    setOpeningMediaUrl,
    setOpeningMediaType,
    setMediaUploadError,
    mediaUploadError,
    regenerateSalesFlowSection,
    regeneratingKey,
    salesFlowConfig,
    setSalesFlowConfig,
    salesOpeningAutoText,
    trialServiceNames,
    firstNamedService,
    firstTrialForTemplates,
    services,
    setServices,
    videoUrlForPreview,
    experienceQuestionForDisplay,
    experienceQuestionToStore,
    ctaBodyForDisplay,
    ctaBodyToStore,
    afterExperienceForDisplay,
    afterExperienceToStore,
    uid,
  } = props as any;

  const isSalesGenerating = typeof regeneratingKey === "string" && regeneratingKey.startsWith("sales:");
  const isGen = (section: string) => regeneratingKey === `sales:${section}`;

  const openingMediaConfigured = Boolean(String(openingMediaUrl ?? "").trim());
  /** אחרי העלאה שנכשלה לא מראים תצוגה של מדיה שמורה — רק מסגרת העלאה + הודעת שגיאה */
  const showOpeningMediaPreview = openingMediaConfigured && !String(mediaUploadError ?? "").trim();

  function SalesFlowExtraStepsEditor({
    steps,
    onChange,
    addButtonLabel,
    startAt = 1,
    questionHeaderClassName = "",
  }: {
    steps: SalesFlowExtraStep[];
    onChange: (next: SalesFlowExtraStep[]) => void;
    addButtonLabel: string;
    startAt?: number;
    questionHeaderClassName?: string;
  }) {
    return (
      <div className="space-y-3 pt-3 border-t border-dashed border-zinc-200/90">
        {steps.map((st, si) => (
          <div
            key={st.id}
            className="border border-dashed border-zinc-200 rounded-xl p-3 space-y-2 bg-zinc-50/60"
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
            <p className="text-[11px] text-zinc-500 text-right">כפתורי תשובה</p>
            {st.options.map((o, oi) => (
              <div key={oi} className="flex gap-2">
                <Input
                  dir="rtl"
                  className="flex-1"
                  value={o}
                  onChange={(e) => {
                    const v = e.target.value;
                    onChange(
                      steps.map((x) =>
                        x.id === st.id
                          ? { ...x, options: x.options.map((t, j) => (j === oi ? v : t)) }
                          : x
                      )
                    );
                  }}
                />
                <button
                  type="button"
                  className="p-1 text-zinc-400 hover:text-red-500 shrink-0"
                  onClick={() =>
                    onChange(
                      steps.map((x) =>
                        x.id === st.id ? { ...x, options: x.options.filter((_, j) => j !== oi) } : x
                      )
                    )
                  }
                  aria-label="הסר כפתור"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="w-full text-xs h-8"
              onClick={() =>
                onChange(steps.map((x) => (x.id === st.id ? { ...x, options: [...x.options, ""] } : x)))
              }
            >
              <Plus className="h-3 w-3" /> הוסף כפתור תשובה
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          className="w-full gap-1 text-sm"
          onClick={() => onChange([...steps, { id: uid(), question: "", options: ["", ""] }])}
        >
          <Plus className="h-4 w-4" />
          {addButtonLabel}
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <StepHeader
            n={4}
            title="מסלול מכירה"
            desc="כאן נוצר תהליך המכירה של זואי. במידה והליד ישאל שאלה פתוחה, זואי תוכל לענות על פי כל המידע שהזנת בטאבים הקודמים."
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <div className="flex flex-row-reverse items-center gap-2 mb-2 flex-wrap justify-start">
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
            <p className="text-sm text-red-600 mt-2 text-right" role="alert">
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

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-zinc-900 text-right">סשן פתיחה</p>
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
          </div>
          <div className="border border-zinc-200 rounded-2xl p-4 space-y-3 bg-white ring-1 ring-[#7133da]/[0.06]">
            <Field label="טקסט פתיחה ללקוח">
              <Textarea
                value={
                  salesFlowConfig.greeting_body_override !== undefined
                    ? salesFlowConfig.greeting_body_override
                    : salesOpeningAutoText
                }
                onChange={(v) => setSalesFlowConfig((c: any) => ({ ...c, greeting_body_override: v }))}
                rows={5}
                placeholder={salesOpeningAutoText}
              />
            </Field>
          </div>
        </div>

        <div className="space-y-2">
          <div dir="ltr" className="flex w-full flex-row items-center justify-start gap-3">
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
          </div>
          <div className="border border-zinc-200 rounded-2xl p-4 space-y-3 bg-white ring-1 ring-[#7133da]/[0.06]">
            {trialServiceNames.length > 1 ? (
              <>
                <Field label="בחירת סוג האימון" className="space-y-1">
                  <Textarea
                    value={salesFlowConfig.multi_service_question}
                    onChange={(v) => setSalesFlowConfig((c: any) => ({ ...c, multi_service_question: v }))}
                    rows={4}
                    placeholder="למשל: איזה אימון הכי מדבר אליך?"
                  />
                </Field>
                <div className="space-y-3">
                  {services.map((s: any, i: number) =>
                    !s.name.trim() ? null : (
                      <div key={s.ui_id} className="space-y-2 rounded-xl border border-zinc-100 bg-white/80 p-3">
                        <div className="w-full rounded-xl border border-[#7133da]/20 bg-[#f5f3ff] px-3 py-2 text-right text-sm font-medium text-[#2d1a6e]">
                          {s.name.trim()}
                        </div>
                        <Field label="תשובה">
                          <Textarea
                            rows={4}
                            value={s.benefit_line}
                            onChange={(v) => {
                              const arr = [...services];
                              arr[i] = { ...s, benefit_line: v };
                              setServices(arr);
                            }}
                            placeholder="למשל: איזה כיף! שיעורי עמידות ידיים שלנו הם דרך מעולה לבנות טכניקה נכונה, לחזק את הגוף ולהתקדם בהדרגה עד לעמידות ידיים יציבות ועצמאיות."
                          />
                        </Field>
                      </div>
                    )
                  )}
                </div>
              </>
            ) : trialServiceNames.length === 1 ? (
              <>
                <p className="text-xs text-zinc-600 text-right leading-relaxed">
                  מוגדר אימון ניסיון אחד - אין שלב בחירה בין אימונים. השאלה והכפתורים הבאים מופיעים ב«סשן חימום» למטה.
                </p>
                {(() => {
                  const firstNamedIndex = services.findIndex((s: any) => s.name.trim());
                  if (firstNamedIndex < 0) return null;
                  const s = services[firstNamedIndex]!;
                  return (
                    <div key={s.ui_id} className="space-y-2 rounded-xl border border-zinc-100 bg-white/80 p-3">
                      <p className="text-xs font-medium text-zinc-700 text-right">תשובה לאימון: {s.name.trim()}</p>
                      <Field label="תשובה">
                        <Textarea
                          rows={4}
                          value={s.benefit_line}
                          onChange={(v) => {
                            const arr = [...services];
                            arr[firstNamedIndex] = { ...s, benefit_line: v };
                            setServices(arr);
                          }}
                          placeholder="למשל: שיעורי עמידות ידיים שלנו הם דרך מעולה לבנות טכניקה נכונה, לחזק את הגוף ולהתקדם בהדרגה עד לעמידות ידיים יציבות ועצמאיות."
                        />
                      </Field>
                    </div>
                  );
                })()}
              </>
            ) : (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-right">
                הוסיפו לפחות אימון ניסיון אחד בטאב «אימון ניסיון» כדי להגדיר את מסלול הבחירה.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-zinc-900 text-right">סשן חימום</p>
            <Button
              type="button"
              variant="outline"
              className="gap-1 text-xs py-1.5 px-3 h-auto"
              disabled={isSalesGenerating}
              onClick={() => regenerateSalesFlowSection("warmup")}
            >
              {isGen("warmup") ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {isGen("warmup") ? "מג׳נרט..." : "ג׳נרט מחדש"}
            </Button>
          </div>
          <div className="border border-zinc-200 rounded-2xl p-4 space-y-3 bg-white">
            <p className="text-xs text-zinc-600 text-right leading-relaxed">
              פשוט שאלות שעושות חשק לבוא. אל תעמיסו 🙂 גם אחת מספיקה. שם האימון יג׳ונרט אוטומטית בצ׳אט, נא לא לשנות.
            </p>

            {trialServiceNames.length === 0 ? (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-right">
                כדי לערוך כאן את שאלת הניסיון והכפתורים - הוסיפו לפחות אימון ניסיון אחד בטאב «אימון ניסיון» (שלב 3).
              </p>
            ) : (
              <>
                <Field label="שאלה 1">
                  <Input
                    dir="rtl"
                    value={experienceQuestionForDisplay(
                      salesFlowConfig.experience_question,
                      trialServiceNames.length > 1 ? firstTrialForTemplates.name : trialServiceNames[0] ?? ""
                    )}
                    onChange={(e) => {
                      const sn = trialServiceNames.length > 1 ? firstTrialForTemplates.name : trialServiceNames[0] ?? "";
                      setSalesFlowConfig((c: any) => ({
                        ...c,
                        experience_question: experienceQuestionToStore(e.target.value, sn),
                      }));
                    }}
                    placeholder={
                      trialServiceNames.length > 1 ? "למשל: יצא לך לנסות בעבר?" : "למשל: יש לך כבר ניסיון בפילאטיס?"
                    }
                  />
                </Field>
                <p className="text-xs font-medium text-zinc-700 text-right">כפתורי תשובה</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {([0, 1, 2] as const).map((i) => (
                    <Field key={i} label={`כפתור ${i + 1}`}>
                      <Input
                        dir="rtl"
                        value={salesFlowConfig.experience_options[i]}
                        onChange={(e) => {
                          const next = [...salesFlowConfig.experience_options] as [string, string, string];
                          next[i] = e.target.value;
                          setSalesFlowConfig((c: any) => ({ ...c, experience_options: next }));
                        }}
                      />
                    </Field>
                  ))}
                </div>
                <Field label="תשובה">
                  <Textarea
                    value={afterExperienceForDisplay(salesFlowConfig.after_experience, firstNamedService)}
                    onChange={(v) =>
                      setSalesFlowConfig((c: any) => ({
                        ...c,
                        after_experience: afterExperienceToStore(v, firstNamedService),
                      }))
                    }
                    rows={3}
                    placeholder="משפט מעודד קצר לפני המשך הפלואו…"
                  />
                </Field>
                <SalesFlowExtraStepsEditor
                  steps={salesFlowConfig.opening_extra_steps}
                  onChange={(next) => setSalesFlowConfig((c: any) => ({ ...c, opening_extra_steps: next }))}
                  addButtonLabel="הוסף שאלה בסשן חימום"
                  startAt={2}
                />
              </>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-zinc-900 text-right">סשן הנעה לפעולה</p>
            <div className="flex items-center gap-2">
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
            </div>
          </div>
          <div className="border border-zinc-200 rounded-2xl p-4 space-y-4 bg-white">
            <div>
              <Textarea
                value={ctaBodyForDisplay(
                  salesFlowConfig.cta_body,
                  firstTrialForTemplates.priceText,
                  firstTrialForTemplates.durationText
                )}
                onChange={(v) =>
                  setSalesFlowConfig((c: any) => ({
                    ...c,
                    cta_body: ctaBodyToStore(
                      v,
                      firstTrialForTemplates.priceText,
                      firstTrialForTemplates.durationText
                    ),
                  }))
                }
                rows={4}
                placeholder="מה דעתך להגיע לאימון ניסיון בקרוב? האימון עולה x שקלים, הוא נמשך x דקות ובאמת שהולך להיות כיף."
              />
              <p className="text-[11px] text-zinc-500 mt-1.5 text-right leading-relaxed">
                עלות ומשך האימון ימולאו אוטומטית על בסיס סוג האימון
              </p>
            </div>
            {salesFlowConfig.cta_buttons.map((b: any, bi: number) => (
              <div key={b.id} className="flex flex-wrap gap-2 items-end border-t border-zinc-100 pt-3">
                <Field label={`כפתור ${bi + 1} - תווית`}>
                  <Input
                    dir="rtl"
                    className="min-w-[12rem]"
                    value={b.label}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSalesFlowConfig((c: any) => ({
                        ...c,
                        cta_buttons: c.cta_buttons.map((x: any) => (x.id === b.id ? { ...x, label: v } : x)),
                      }));
                    }}
                  />
                </Field>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-600 block">סוג</label>
                  <select
                    dir="rtl"
                    className="rounded-xl border border-zinc-300 px-3 py-2 text-sm text-zinc-800 bg-white min-w-[11rem]"
                    value={b.kind}
                    onChange={(e) => {
                      const kind = e.target.value as SalesFlowCtaButton["kind"];
                      setSalesFlowConfig((c: any) => ({
                        ...c,
                        cta_buttons: c.cta_buttons.map((x: any) => (x.id === b.id ? { ...x, kind } : x)),
                      }));
                    }}
                  >
                    <option value="schedule">מערכת שעות (לינק)</option>
                    <option value="trial">הרשמה לניסיון (לינק לאימון)</option>
                    <option value="memberships">מחירי מנויים (קישור מ«על העסק»)</option>
                    <option value="address">מה הכתובת? (שדה כתובת)</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-zinc-900 text-right">אחרי הרשמה לשיעור ניסיון</p>
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
          </div>
          <div className="border border-zinc-200 rounded-2xl p-4 space-y-3 bg-white">
            <p className="text-xs text-zinc-600 text-right leading-relaxed">יושלם אוטומטית מ«על העסק»</p>
            <Field label="תבנית להודעה ללקוח (זואי ממלאת פרטים)">
              <Textarea
                value={salesFlowConfig.after_trial_registration_body}
                onChange={(v) => setSalesFlowConfig((c: any) => ({ ...c, after_trial_registration_body: v }))}
                rows={12}
              />
            </Field>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

