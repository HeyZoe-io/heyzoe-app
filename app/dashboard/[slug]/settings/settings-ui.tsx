"use client";

/** עמודת תוכן ממורכזת במסלול מכירה — רוחב אחיד לכותרת, טאבים ושדות */
export const DASHBOARD_SETTINGS_SHELL =
  "mx-auto w-full max-w-4xl px-4 sm:px-6";

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

/** תפריט שלבים (לינקים, על העסק…) — קטן יותר, אותו סגנון בלי קו תחתון */
export function dashboardStepTabClass(active: boolean) {
  return [
    TAB_STEP_BASE,
    "px-3 py-2 text-sm",
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
  return <section className={`w-full ${className}`.trim()}>{children}</section>;
}

export function StepHeader({ n, title, desc }: { n: number; title: string; desc?: string }) {
  return (
    <div className="mb-8 text-right">
      <div className="mb-2 flex items-baseline justify-start gap-3">
        <span className="text-base font-bold tabular-nums text-[#7133da]/75">{n}</span>
        <h2 className="text-2xl font-extrabold tracking-[-0.03em] text-zinc-900 sm:text-[1.9rem]">
          {title}
        </h2>
      </div>
      {desc ? (
        <p className="text-base leading-7 text-zinc-500">{desc}</p>
      ) : null}
    </div>
  );
}

/** כותרות סשנים בתוך שלב מכירה (סשן פתיחה, חימום…) */
export function SalesSessionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-lg font-bold tracking-tight text-zinc-900 text-right sm:text-xl">{children}</h3>
  );
}

export function Field({
  label,
  children,
  className = "",
  description,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** שורת הסבר מתחת לכותרת (למשל לפני שדה הקלט) */
  description?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      <div className="block text-[0.95rem] font-semibold tracking-[-0.01em] text-zinc-800">{label}</div>
      {description ? (
        <p className="text-xs leading-6 text-zinc-500 text-right">{description}</p>
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
      className="w-full resize-none rounded-2xl border border-[rgba(124,96,202,0.18)] bg-white/88 px-4 py-3 text-sm leading-6 text-zinc-800 shadow-[0_12px_28px_rgba(110,78,176,0.08)] backdrop-blur-sm transition-all duration-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#7133da]/30 focus:ring-offset-2 focus:ring-offset-white focus:border-[rgba(113,51,218,0.35)] hover:border-[rgba(113,51,218,0.24)]"
    />
  );
}

