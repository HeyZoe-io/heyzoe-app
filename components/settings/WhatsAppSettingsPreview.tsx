"use client";

type PreviewStep = 1 | 2 | 3 | 4 | 5;

export type SalesFlowBlockPreview = { intro: string; question: string; options: string[] };

type Props = {
  step: PreviewStep;
  botName: string;
  businessName: string;
  openingMediaUrl: string;
  openingMediaType: "image" | "video" | "";
  welcomeIntro: string;
  welcomeQuestion: string;
  welcomeOptions: string[];
  salesFlowBlocks: SalesFlowBlockPreview[];
  services: { name: string; price_text: string }[];
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
  welcomeIntro,
  welcomeQuestion,
  welcomeOptions,
  salesFlowBlocks,
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

        <div className="p-2 space-y-1.5 min-h-[280px] max-h-[420px] overflow-y-auto">
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
                  <span className="text-zinc-500">הוסיפו שירותים</span>
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
              {(welcomeIntro.trim() || welcomeQuestion.trim()) && (
                <Bubble from="bot">
                  {welcomeIntro.trim() ? (
                    <p className="whitespace-pre-wrap text-zinc-900 text-right">{welcomeIntro.trim()}</p>
                  ) : null}
                  {welcomeQuestion.trim() ? (
                    <p className={`whitespace-pre-wrap text-zinc-900 text-right ${welcomeIntro.trim() ? "mt-1.5 pt-1.5 border-t border-zinc-200" : ""}`}>
                      {welcomeQuestion.trim()}
                    </p>
                  ) : null}
                </Bubble>
              )}
              {welcomeOptions.some((o) => o.trim()) && (
                <div className="space-y-1 pt-0.5">
                  {welcomeOptions.map(
                    (o, i) =>
                      o.trim() && (
                        <WaButton key={i}>{o.trim()}</WaButton>
                      )
                  )}
                </div>
              )}
              {salesFlowBlocks.map((b, bi) =>
                b.intro.trim() || b.question.trim() || b.options.some((o) => o.trim()) ? (
                  <div key={bi} className="space-y-1 pt-1 border-t border-zinc-300/50">
                    <p className="text-[9px] text-zinc-500 text-right">המשך מסלול — שלב {bi + 2}</p>
                    <Bubble from="bot">
                      {b.intro.trim() ? <p className="whitespace-pre-wrap text-zinc-900 text-right">{b.intro.trim()}</p> : null}
                      {b.question.trim() ? (
                        <p className={`whitespace-pre-wrap text-zinc-900 text-right ${b.intro.trim() ? "mt-1 pt-1 border-t border-zinc-200" : ""}`}>
                          {b.question.trim()}
                        </p>
                      ) : null}
                    </Bubble>
                    {b.options.some((o) => o.trim()) ? (
                      <div className="space-y-1">
                        {b.options.map(
                          (o, i) =>
                            o.trim() && (
                              <WaButton key={i}>{o.trim()}</WaButton>
                            )
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null
              )}
              {!welcomeIntro.trim() && !welcomeQuestion.trim() && !openingMediaUrl && !salesFlowBlocks.some((b) => b.intro.trim() || b.question.trim()) && (
                <Bubble from="bot">
                  <span className="text-zinc-500">הגדירו מסלול מכירה — מדיה, פתיחה ושאלה</span>
                </Bubble>
              )}
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
