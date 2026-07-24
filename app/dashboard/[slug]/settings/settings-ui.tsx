"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  dashboardDir,
  dashboardLangFromParam,
  dashboardTextAlign,
  type DashboardLang,
} from "@/lib/dashboard-lang";
import { dashboardSettingsT, settingsStepHref } from "@/lib/dashboard-settings-i18n";
import { useSettingsGuardedLinkClick } from "@/app/[slug]/settings/settings-unsaved-context";

export const DASHBOARD_SETTINGS_SHELL = "mx-auto w-full max-w-4xl px-4 sm:px-6";
export const DASHBOARD_CENTERED_CONTENT =
  "text-center [&_input]:text-center [&_textarea]:text-center";

export function salesPathSteps(lang: DashboardLang): readonly string[] {
  return dashboardSettingsT(lang).salesPathSteps;
}

function salesPathStepFromSearchParams(raw: string | null): number {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(5, Math.trunc(parsed)));
}

export function SalesPathSubNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lang = dashboardLangFromParam(searchParams.get("lang"));
  const t = dashboardSettingsT(lang);
  const steps = [...t.salesPathSteps];
  const base = `/${slug}/settings`;
  const guardedLinkClick = useSettingsGuardedLinkClick();
  if (!pathname?.endsWith("/settings")) return null;
  const step = salesPathStepFromSearchParams(searchParams.get("step"));

  return (
    <div className="w-full border-t border-zinc-200/70 mt-3 pt-4 pb-1">
      <div className={`${DASHBOARD_SETTINGS_SHELL} flex flex-col items-stretch gap-3`}>
        <nav
          className="flex min-w-0 justify-center overflow-x-auto pb-0.5"
          aria-label={t.salesPathNavAria}
          dir={dashboardDir(lang)}
        >
          <div className="inline-flex min-w-max items-center gap-0.5 rounded-2xl bg-zinc-100/80 p-1 sm:gap-1">
            {steps.map((label, i) => {
              const n = i + 1;
              const active = step === n;
              const href = settingsStepHref(base, n, lang);
              return (
                <Link
                  key={n}
                  href={href}
                  prefetch={true}
                  onClick={(e) => guardedLinkClick(e, href)}
                  className={[
                    dashboardStepTabClass(active),
                    "inline-flex items-center rounded-xl px-3 py-2 sm:px-4",
                    active ? "bg-white shadow-sm ring-1 ring-[#7133da]/15" : "hover:bg-white/60",
                  ].join(" ")}
                  aria-current={active ? "page" : undefined}
                >
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

export function dashboardMainTabClass(active: boolean) {
  return [
    TAB_MAIN_BASE,
    "px-2 py-2 text-[13px] sm:px-4 sm:text-[18px]",
    active ? "text-[#7133da]" : "text-zinc-600 hover:text-zinc-900",
  ].join(" ");
}

export function dashboardStepTabClass(active: boolean) {
  return [
    TAB_STEP_BASE,
    "text-[12px] sm:text-sm",
    active ? "text-[#7133da]" : "text-zinc-600 hover:text-zinc-900",
  ].join(" ");
}

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
        <h2 className="text-2xl font-extrabold tracking-[-0.03em] text-zinc-900 sm:text-[1.9rem]">{title}</h2>
      </div>
      {desc ? <p className="mx-auto max-w-2xl text-base leading-7 text-zinc-500">{desc}</p> : null}
    </div>
  );
}

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
  inlineAlign = "center",
  lang,
  labelAction,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  description?: string;
  inline?: boolean;
  inlineAlign?: "center" | "start";
  lang?: DashboardLang;
  /** כפתור/פעולה בשורת הכותרת (למשל ג׳נרט מחדש) — בצד ימין של התיבה */
  labelAction?: React.ReactNode;
}) {
  const dir = lang ? dashboardDir(lang) : "rtl";
  const textAlign = lang ? dashboardTextAlign(lang) : "right";

  if (inline) {
    const rowAlign = inlineAlign === "start" ? "sm:items-start" : "sm:items-center";
    return (
      <div className={`w-full space-y-2 ${className}`}>
        <div className={`flex w-full flex-col items-stretch gap-2 sm:flex-row ${rowAlign} sm:gap-4`} dir={dir}>
          <div className="shrink-0 text-[0.95rem] font-semibold tracking-[-0.01em] text-zinc-800" style={{ textAlign }}>
            {label}
          </div>
          <div className="min-w-0 w-full flex-1">{children}</div>
        </div>
        {description ? <p className="text-center text-xs leading-6 text-zinc-500">{description}</p> : null}
      </div>
    );
  }

  return (
    <div className={`w-full space-y-2 ${className}`}>
      <div className="flex w-full items-center justify-between gap-2">
        <div
          className="min-w-0 flex-1 text-[0.95rem] font-semibold tracking-[-0.01em] text-zinc-800"
          style={{ textAlign }}
        >
          {label}
        </div>
        {labelAction ? <div className="shrink-0">{labelAction}</div> : null}
      </div>
      {description ? (
        <p className="text-xs leading-6 text-zinc-500" style={{ textAlign }}>
          {description}
        </p>
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
  lang,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  lang?: DashboardLang;
}) {
  return (
    <textarea
      dir={lang ? dashboardDir(lang) : "rtl"}
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full resize-none rounded-2xl border border-[rgba(124,96,202,0.18)] bg-white/88 px-4 py-3 text-center text-sm leading-6 text-zinc-800 shadow-[0_12px_28px_rgba(110,78,176,0.08)] backdrop-blur-sm transition-all duration-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#7133da]/30 focus:ring-offset-2 focus:ring-offset-white focus:border-[rgba(113,51,218,0.35)] hover:border-[rgba(113,51,218,0.24)]"
    />
  );
}
