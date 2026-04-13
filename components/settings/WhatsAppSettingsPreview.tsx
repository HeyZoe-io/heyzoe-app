"use client";

import {
  fillAfterServicePickTemplate,
  getWhatsAppOpeningPreviewSections,
  type SalesFlowConfig,
} from "@/lib/sales-flow";

type PreviewStep = 1 | 2 | 3 | 4 | 5;

type Props = {
  step: PreviewStep;
  botName: string;
  businessName: string;
  openingMediaUrl: string;
  openingMediaType: "image" | "video" | "";
  salesFlowConfig: SalesFlowConfig;
  services: { name: string; price_text: string; benefit_line?: string }[];
  businessTagline: string;
  traits: string[];
  address: string;
  followupAfterRegistration: string;
  followupAfterHourNoRegistration: string;
  followupDayAfterTrial: string;
};

function Bubble({
  from,
  children,
  className = "",
}: {
  from: "bot" | "user";
  children: React.ReactNode;
  className?: string;
}) {
  const isBot = from === "bot";
  return (
    <div className={`flex w-full ${isBot ? "justify-start" : "justify-end"}`}>
      <div
        dir="rtl"
        className={`max-w-[92%] rounded-lg px-2.5 py-1.5 text-[12px] leading-snug shadow-sm text-right ${isBot ? "bg-white text-zinc-900 rounded-tl-none" : "bg-[#dcf8c6] text-zinc-900 rounded-tr-none"} ${className}`}
      >
        {children}
      </div>
    </div>
  );
}

function WaButton({ children }: { children: React.ReactNode }) {
  return (
    <div
      dir="rtl"
      className="w-full rounded-md border border-[#d1d7db] bg-white px-2 py-1.5 text-right text-[11px] font-medium text-[#027eb5]"
    >
      {children}
    </div>
  );
}

export function WhatsAppSettingsPreview({
  step,
  botName,
  businessName,
  openingMediaUrl,
  openingMediaType,
  salesFlowConfig,
  services,
  businessTagline,
  traits,
  address,
  followupAfterRegistration,
  followupAfterHourNoRegistration,
  followupDayAfterTrial,
}: Props) {
  const facts = traits.map((f) => f.trim()).filter(Boolean);
  const tag = businessTagline.trim();

  const trialServices = services
    .filter((s) => s.name.trim())
    .map((s) => ({
      name: s.name.trim(),
      benefit_line: (s.benefit_line ?? "").trim(),
    }));

  const openingSections =
    step === 3
      ? getWhatsAppOpeningPreviewSections(
          salesFlowConfig,
          trialServices,
          botName.trim() || "זואי",
          businessName.trim() || "העסק",
          businessTagline
        )
      : [];

  const hasOpeningExtras = salesFlowConfig.opening_extra_steps.some(
    (st) => st.question.trim() || st.options.some((o) => o.trim())
  );
  const hasCtaPreview =
    salesFlowConfig.cta_body.trim() ||
    salesFlowConfig.cta_buttons.some((b) => b.label.trim()) ||
    salesFlowConfig.followup_after_next_class_body.trim() ||
    salesFlowConfig.cta_extra_steps.some(
      (st) => st.question.trim() || st.options.some((o) => o.trim())
    );

  const step3HasContent =
    !!openingMediaUrl ||
    openingSections.length > 0 ||
    hasOpeningExtras ||
    hasCtaPreview;

  return (
    <div className="w-full max-w-[280px] mx-auto shrink-0" dir="rtl">
      <p className="text-[11px] font-medium text-zinc-500 text-right mb-2">תצוגה מקדימה (ווטסאפ)</p>
      <div className="rounded-[20px] overflow-hidden border border-zinc-300 shadow-lg bg-[#e5ddd5]">
        <div className="bg-[#075e54] px-2 py-2 flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-white/20 shrink-0" />
          <div className="min-w-0 flex-1 text-right">
            <p className="text-[12px] font-semibold text-white truncate">{botName || "זואי"}</p>
            <p className="text-[9px] text-white/80 truncate">{businessName || "העסק"}</p>
          </div>
        </div>

        <div
          className={`p-2 space-y-1.5 min-h-[280px] overflow-y-auto ${step === 3 ? "max-h-[520px]" : "max-h-[420px]"}`}
        >
          {step === 1 && (
            <>
              {tag || facts.length > 0 || address.trim() ? (
                <Bubble from="bot">
                  <p className="font-medium text-[11px] text-[#075e54] mb-0.5 text-right">{businessName || "העסק"}</p>
                  {tag ? <p className="text-zinc-800 mb-1 text-right">{tag}</p> : null}
                  {facts.length > 0 ? (
                    <ul className="list-disc list-inside space-y-0.5 text-zinc-800 text-right pr-1">
                      {facts.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  ) : null}
                  {address.trim() ? <p className="mt-1 text-zinc-600 text-right">📍 {address.trim()}</p> : null}
                </Bubble>
              ) : (
                <Bubble from="bot">
                  <span className="text-zinc-500">מלאו פרטי עסק — כאן תופיע הדמיה</span>
                </Bubble>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <Bubble from="bot">
                {services.filter((s) => s.name.trim()).length ? (
                  <ul className="space-y-1 text-right">
                    {services
                      .filter((s) => s.name.trim())
                      .slice(0, 5)
                      .map((s, i) => (
                        <li key={i}>
                          {s.name.trim()}
                          {s.price_text.trim() ? ` — ${s.price_text.trim()}` : ""}
                        </li>
                      ))}
                  </ul>
                ) : (
                  <span className="text-zinc-500">הוסיפו אימוני ניסיון</span>
                )}
              </Bubble>
            </>
          )}

          {step === 3 && (
            <>
              {openingMediaUrl ? (
                <div className="flex justify-start">
                  <div className="rounded-lg overflow-hidden max-w-[85%] border border-white/80 shadow-sm bg-black/5">
                    {openingMediaType === "video" ? (
                      <video src={openingMediaUrl} className="max-h-32 w-full object-cover" muted playsInline />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={openingMediaUrl} alt="" className="max-h-32 w-full object-cover" />
                    )}
                  </div>
                </div>
              ) : null}

              {openingSections.length > 0 ? (
                <div className="space-y-1.5">
                  {openingSections.map((sec, idx) =>
                    sec.kind === "text" ? (
                      <Bubble key={`t-${idx}`} from="bot">
                        <p className="whitespace-pre-wrap text-zinc-900 text-right text-[11px] leading-relaxed">
                          {sec.text}
                        </p>
                      </Bubble>
                    ) : (
                      <div key={`b-${idx}`} className="space-y-1">
                        {sec.labels
                          .map((lbl) => lbl.trim())
                          .filter(Boolean)
                          .map((lbl, j) => (
                            <WaButton key={j}>{lbl}</WaButton>
                          ))}
                      </div>
                    )
                  )}
                  {trialServices.length > 1 && salesFlowConfig.after_service_pick.trim() ? (
                    <>
                      <Bubble from="user">
                        <span className="text-zinc-900 text-[11px]">
                          {trialServices[0]?.name ?? "בחירת אימון"}
                        </span>
                      </Bubble>
                      <Bubble from="bot">
                        <p className="whitespace-pre-wrap text-zinc-900 text-right text-[11px] leading-relaxed">
                          {fillAfterServicePickTemplate(
                            salesFlowConfig.after_service_pick,
                            trialServices[0]?.name ?? "",
                            trialServices[0]?.benefit_line ?? ""
                          )}
                        </p>
                      </Bubble>
                      <p className="text-[8px] text-zinc-500 text-right px-0.5 leading-tight">
                        דוגמה אחרי בחירת אימון (שם ותיאור מהאימון הראשון בהגדרות)
                      </p>
                    </>
                  ) : null}
                </div>
              ) : null}

              {trialServices.length > 3 ? (
                <p className="text-[9px] text-amber-900/90 text-right px-1 leading-snug bg-amber-50/90 rounded-md py-1 border border-amber-200/80">
                  מעל 3 אימונים: בפועל נשלחת רשימה ממוספרת — כאן מוצגת דוגמה לפי ההגדרות.
                </p>
              ) : null}

              {salesFlowConfig.opening_extra_steps.map((st) =>
                st.question.trim() || st.options.some((o) => o.trim()) ? (
                  <div key={st.id} className="space-y-1 pt-0.5 border-t border-dashed border-zinc-300/60">
                    <p className="text-[9px] text-zinc-500 text-right">שאלת פתיחה נוספת</p>
                    {st.question.trim() ? (
                      <Bubble from="bot">
                        <p className="whitespace-pre-wrap text-zinc-900 text-right text-[11px]">{st.question.trim()}</p>
                      </Bubble>
                    ) : null}
                    <div className="space-y-1">
                      {st.options.map(
                        (o, j) =>
                          o.trim() && (
                            <WaButton key={j}>{o.trim()}</WaButton>
                          )
                      )}
                    </div>
                  </div>
                ) : null
              )}

              <div className="space-y-1.5 pt-1 border-t border-zinc-400/50">
                <p className="text-[9px] text-[#075e54] text-right font-medium">הנעה לפעולה (דוגמה אחרי הפלואו)</p>
                {salesFlowConfig.cta_body.trim() ? (
                  <Bubble from="bot">
                    <p className="whitespace-pre-wrap text-zinc-900 text-right text-[11px] leading-relaxed">
                      {salesFlowConfig.cta_body.trim()}
                    </p>
                  </Bubble>
                ) : null}
                {salesFlowConfig.cta_buttons.some((b) => b.label.trim()) ? (
                  <div className="space-y-1">
                    {salesFlowConfig.cta_buttons.map(
                      (b, i) =>
                        b.label.trim() && (
                          <WaButton key={b.id}>
                            {i + 1}. {b.label.trim()}
                          </WaButton>
                        )
                    )}
                    <p className="text-[8px] text-zinc-500 text-right leading-tight px-0.5">
                      סוגי כפתור: שיעור קרוב (Arbox) · הרשמה לניסיון · מערכת שעות · קישור מנויים
                    </p>
                  </div>
                ) : null}
                {salesFlowConfig.followup_after_next_class_body.trim() ? (
                  <div className="space-y-1 pt-1 border-t border-dotted border-zinc-300/80">
                    <p className="text-[9px] text-[#075e54] text-right font-medium">
                      אחרי «מתי השיעור קרוב?» (הודעה שנייה אוטומטית)
                    </p>
                    <Bubble from="bot">
                      <p className="whitespace-pre-wrap text-zinc-900 text-right text-[11px] leading-relaxed">
                        {salesFlowConfig.followup_after_next_class_body.trim()}
                      </p>
                    </Bubble>
                    <div className="space-y-1">
                      {salesFlowConfig.followup_after_next_class_options.map(
                        (lbl, i) =>
                          lbl.trim() && (
                            <WaButton key={i}>
                              {i + 1}. {lbl.trim()}
                            </WaButton>
                          )
                      )}
                    </div>
                  </div>
                ) : null}
                {salesFlowConfig.cta_extra_steps.map((st) =>
                  st.question.trim() || st.options.some((o) => o.trim()) ? (
                    <div key={st.id} className="space-y-1 pt-0.5 border-t border-dotted border-zinc-300/70">
                      <p className="text-[9px] text-zinc-500 text-right">שאלה בהנעה לפעולה</p>
                      {st.question.trim() ? (
                        <Bubble from="bot">
                          <p className="whitespace-pre-wrap text-zinc-900 text-right text-[11px]">{st.question.trim()}</p>
                        </Bubble>
                      ) : null}
                      <div className="space-y-1">
                        {st.options.map(
                          (o, j) =>
                            o.trim() && (
                              <WaButton key={j}>
                                {j + 1}. {o.trim()}
                              </WaButton>
                            )
                        )}
                      </div>
                    </div>
                  ) : null
                )}
                {!hasCtaPreview && (
                  <p className="text-[9px] text-zinc-500 text-right">מלאו גוף וכפתורי הנעה לפעולה בהגדרות</p>
                )}
              </div>

              {!step3HasContent ? (
                <Bubble from="bot">
                  <span className="text-zinc-500">הגדירו מסלול מכירה — מדיה, טקסטים ואימוני ניסיון</span>
                </Bubble>
              ) : null}
            </>
          )}

          {step === 4 && (
            <Bubble from="bot">
              <span className="text-zinc-600">חיבור פייסבוק ופיקסל — אין הודעת צ׳אט כאן</span>
            </Bubble>
          )}

          {step === 5 && (
            <>
              {followupAfterRegistration.trim() && <Bubble from="bot">{followupAfterRegistration.trim()}</Bubble>}
              {followupAfterHourNoRegistration.trim() && (
                <Bubble from="bot">{followupAfterHourNoRegistration.trim()}</Bubble>
              )}
              {followupDayAfterTrial.trim() && <Bubble from="bot">{followupDayAfterTrial.trim()}</Bubble>}
              {!followupAfterRegistration.trim() &&
                !followupAfterHourNoRegistration.trim() &&
                !followupDayAfterTrial.trim() && (
                  <Bubble from="bot">
                    <span className="text-zinc-500">הודעות פולואפ</span>
                  </Bubble>
                )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
