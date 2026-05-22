"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/** עמודת תוכן ממורכזת — מסלול מכירה + אנליטיקס */
export const DASHBOARD_SETTINGS_SHELL =
  "mx-auto w-full max-w-4xl px-4 sm:px-6";

/** מירכוז כותרות, תוויות, שדות וטקסט בתוך שדות (RTL) */
export const DASHBOARD_CENTERED_CONTENT =
  "text-center [&_input]:text-center [&_textarea]:text-center";

export const SALES_PATH_STEPS = [
  "לינקים",
  "על העסק",
  "מוצרים",
  "מכירה",
  "פולואפ",
] as const;

function salesPathStepFromSearchParams(raw: string | null): number {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(SALES_PATH_STEPS.length, Math.trunc(parsed)));
}

/** תפריט שלבי מסלול מכירה — מתחת לניווט הראשי, רק בדף ההגדרות */
export function SalesPathSubNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const base = `/${slug}/settings`;
  if (!pathname?.endsWith("/settings")) return null;

  const step = salesPathStepFromSearchParams(searchParams.get("step"));

  return (
    <div className="w-full border-t border-zinc-200/70 mt-3 pt-4 pb-1">
      <div className={`${DASHBOARD_SETTINGS_SHELL} flex flex-col items-stretch gap-3`}>
        <p className="text-center text-xs font-light tracking-wide text-zinc-500">
          שלבי הגדרת מסלול המכירה
        </p>
        <nav
          className="flex min-w-0 justify-center overflow-x-auto pb-0.5"
          aria-label="שלבי מסלול מכירה"
        >
          <div className="inline-flex min-w-max items-center gap-0.5 rounded-2xl bg-zinc-100/80 p-1 sm:gap-1">
            {SALES_PATH_STEPS.map((label, i) => {
              const n = i + 1;
              const active = step === n;
              return (
                <Link
                  key={n}
                  href={`${base}?step=${n}`}
                  prefetch={true}
                  className={[
                    dashboardStepTabClass(active),
                    "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 sm:px-4",
                    active ? "bg-white shadow-sm ring-1 ring-[#7133da]/15" : "hover:bg-white/60",
                  ].join(" ")}
                  aria-current={active ? "page" : undefined}
                >
                  <span
                    className={[
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums",
                      active ? "bg-[#7133da] text-white" : "bg-zinc-200/90 text-zinc-500",
                    ].join(" ")}
                    aria-hidden
                  >
                    {n}
                  </span>
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}

const TAB_MAIN_BASE =
  "shrink-0 whitespace-nowrap transition-colors font-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7133da]/30 focus-visible:ring-offset-2 rounded-md";
const TAB_STEP_BASE =
  "shrink-0 whitespace-nowrap transition-colors font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7133da]/30 focus-visible:ring-offset-2 rounded-md";

/** תפריט ראשי (מסלול מכירה, שיחות…) — גדול, ממורכז, משקל קל */
export function dashboardMainTabClass(active: boolean) {
  return [
    TAB_MAIN_BASE,
    "px-4 py-2 text-[17px] sm:text-[18px]",
    active ? "text-[#7133da]" : "text-zinc-600 hover:text-zinc-900",
  ].join(" ");
}

/** תפריט שלבים (לינקים, על העסק…) — קטן יותר, מתחת ל«מסלול מכירה» */
export function dashboardStepTabClass(active: boolean) {
  return [
    TAB_STEP_BASE,
    "text-[13px] sm:text-sm",
    active ? "text-[#7133da]" : "text-zinc-600 hover:text-zinc-900",
  ].join(" ");
}

/** תוכן טאב ישירות על רקע הדף — בלי מסגרת Card חיצונית */
export function StepPanel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`w-full ${DASHBOARD_CENTERED_CONTENT} ${className}`.trim()}>
      {children}
    </section>
  );
}

export function StepHeader({ n, title, desc }: { n: number; title: string; desc?: string }) {
  return (
    <div className="mb-8 text-center">
      <div className="mb-2 flex items-baseline justify-center gap-3">
        <span className="text-base font-bold tabular-nums text-[#7133da]/75">{n}</span>
        <h2 className="text-2xl font-extrabold tracking-[-0.03em] text-zinc-900 sm:text-[1.9rem]">
          {title}
        </h2>
      </div>
      {desc ? (
        <p className="mx-auto max-w-2xl text-base leading-7 text-zinc-500">{desc}</p>
      ) : null}
    </div>
  );
}

/** כותרות סשנים בתוך שלב מכירה (סשן פתיחה, חימום…) */
export function SalesSessionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-center text-lg font-bold tracking-tight text-zinc-900 sm:text-xl">{children}</h3>
  );
}

export function Field({
  label,
  children,
  className = "",
  description,
  inline = false,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** שורת הסבר מתחת לכותרת (למשל לפני שדה הקלט) */
  description?: string;
  /** כותרת באותה שורה עם השדה (RTL) */
  inline?: boolean;
}) {
  if (inline) {
    return (
      <div className={`mx-auto w-full max-w-2xl space-y-2 ${className}`}>
        <div
          className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-center sm:gap-4"
          dir="rtl"
        >
          <div className="shrink-0 text-center text-[0.95rem] font-semibold tracking-[-0.01em] text-zinc-800 sm:text-right">
            {label}
          </div>
          <div className="min-w-0 w-full flex-1">{children}</div>
        </div>
        {description ? (
          <p className="text-center text-xs leading-6 text-zinc-500">{description}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`mx-auto w-full max-w-2xl space-y-2 text-center ${className}`}>
      <div className="block text-[0.95rem] font-semibold tracking-[-0.01em] text-zinc-800">{label}</div>
      {description ? (
        <p className="text-xs leading-6 text-zinc-500">{description}</p>
      ) : null}
      {children}
    </div>
  );
}

export function Textarea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      dir="rtl"
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full resize-none rounded-2xl border border-[rgba(124,96,202,0.18)] bg-white/88 px-4 py-3 text-center text-sm leading-6 text-zinc-800 shadow-[0_12px_28px_rgba(110,78,176,0.08)] backdrop-blur-sm transition-all duration-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#7133da]/30 focus:ring-offset-2 focus:ring-offset-white focus:border-[rgba(113,51,218,0.35)] hover:border-[rgba(113,51,218,0.24)]"
    />
  );
}

