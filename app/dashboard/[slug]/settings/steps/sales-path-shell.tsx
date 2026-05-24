"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const SALES_PATH_INPUT =
  "h-10 rounded-lg border-zinc-200/90 bg-zinc-50/40 text-right shadow-none hover:bg-white focus-visible:ring-1 focus-visible:ring-[#7133da]/30 focus-visible:ring-offset-0";

export const SALES_PATH_TEXTAREA =
  "w-full resize-none rounded-lg border border-zinc-200/90 bg-zinc-50/40 px-3 py-2.5 text-right text-sm leading-relaxed text-zinc-800 shadow-none outline-none transition-colors placeholder:text-zinc-400 hover:bg-white focus:border-[#7133da]/35 focus:ring-1 focus:ring-[#7133da]/25";

export type SalesPathNavSection<T extends string> = {
  id: T;
  label: string;
  hint?: string;
};

export function SalesPathFieldLabel({
  children,
  hint,
  action,
}: {
  children: ReactNode;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
      <div>
        <span className="text-[13px] font-medium text-zinc-800">{children}</span>
        {hint ? <p className="mt-0.5 text-[11px] text-zinc-400">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function SalesPathSectionBlock({
  stepPrefix,
  id,
  title,
  hint,
  open,
  onToggle,
  filled,
  children,
  headerAction,
}: {
  stepPrefix: string;
  id: string;
  title: string;
  hint?: string;
  open: boolean;
  onToggle: () => void;
  filled?: boolean;
  children: ReactNode;
  headerAction?: ReactNode;
}) {
  const sectionDomId = `${stepPrefix}-section-${id}`;
  return (
    <section id={sectionDomId} className="scroll-mt-24 overflow-hidden rounded-xl border border-zinc-200/70 bg-white">
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3.5 text-right transition-colors hover:bg-zinc-50/90"
          aria-expanded={open}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={cn("h-1.5 w-1.5 shrink-0 rounded-full", filled ? "bg-[#7133da]" : "bg-zinc-200")}
                aria-hidden
              />
              <h3 className="text-sm font-semibold tracking-[-0.01em] text-zinc-900">{title}</h3>
            </div>
            {hint ? <p className="mt-0.5 pr-3.5 text-xs text-zinc-500">{hint}</p> : null}
          </div>
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200", open && "rotate-180")}
            aria-hidden
          />
        </button>
        {headerAction ? <div className="flex shrink-0 items-center pe-3">{headerAction}</div> : null}
      </div>
      {open ? <div className="space-y-4 border-t border-zinc-100 px-4 pb-4 pt-3">{children}</div> : null}
    </section>
  );
}

export function useSalesPathSections<T extends string>(
  sections: SalesPathNavSection<T>[],
  initialOpen: Partial<Record<T, boolean>>
) {
  const [openSections, setOpenSections] = useState<Record<T, boolean>>(() => {
    const base = {} as Record<T, boolean>;
    for (const s of sections) {
      base[s.id] = initialOpen[s.id] ?? false;
    }
    return base;
  });
  const [activeNav, setActiveNav] = useState<T>(sections[0]?.id ?? ("" as T));
  const mainRef = useRef<HTMLDivElement>(null);
  const stepPrefixRef = useRef<string>("step");

  const setStepPrefix = useCallback((prefix: string) => {
    stepPrefixRef.current = prefix;
  }, []);

  const toggle = useCallback((id: T) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
    setActiveNav(id);
  }, []);

  const scrollToSection = useCallback((id: T) => {
    setOpenSections((prev) => ({ ...prev, [id]: true }));
    setActiveNav(id);
    requestAnimationFrame(() => {
      document.getElementById(`${stepPrefixRef.current}-section-${id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, []);

  useEffect(() => {
    const prefix = stepPrefixRef.current;
    const ids = sections.map((s) => `${prefix}-section-${s.id}`);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible?.target?.id) return;
        const id = visible.target.id.replace(`${prefix}-section-`, "") as T;
        if (sections.some((s) => s.id === id)) setActiveNav(id);
      },
      { root: null, rootMargin: "-20% 0px -55% 0px", threshold: [0, 0.25, 0.5] }
    );
    for (const domId of ids) {
      const el = document.getElementById(domId);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);

  return { openSections, toggle, scrollToSection, activeNav, mainRef, setStepPrefix };
}

export function SalesPathStepShell<T extends string>({
  stepNumber,
  title,
  description,
  stepPrefix,
  sections,
  activeNav,
  onNavClick,
  mainRef,
  children,
  navAriaLabel,
}: {
  stepNumber: number;
  title: string;
  description?: string;
  stepPrefix: string;
  sections: SalesPathNavSection<T>[];
  activeNav: T;
  onNavClick: (id: T) => void;
  mainRef: React.RefObject<HTMLDivElement | null>;
  children: ReactNode;
  navAriaLabel: string;
}) {
  return (
    <section className="mx-auto w-full max-w-3xl text-right" dir="rtl">
      <header className="mb-6 border-b border-zinc-200/60 pb-5">
        <p className="text-[11px] font-medium uppercase tracking-widest text-[#7133da]/80">שלב {stepNumber}</p>
        <h2 className="mt-1 text-xl font-bold tracking-[-0.02em] text-zinc-900 sm:text-2xl">{title}</h2>
        {description ? (
          <p className="mt-1.5 max-w-md text-sm leading-relaxed text-zinc-500">{description}</p>
        ) : null}
      </header>

      <div className="flex flex-col gap-6 lg:flex-row-reverse lg:items-start">
        <nav className="hidden shrink-0 lg:block lg:w-[168px]" aria-label={navAriaLabel}>
          <ul className="sticky top-24 space-y-0.5">
            {sections.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onNavClick(s.id)}
                  className={cn(
                    "w-full rounded-lg px-3 py-2 text-right transition-colors",
                    activeNav === s.id
                      ? "bg-[#7133da]/10 text-[#5c2ab8]"
                      : "text-zinc-600 hover:bg-zinc-100/80 hover:text-zinc-900"
                  )}
                >
                  <span className="block text-[13px] font-medium">{s.label}</span>
                  {s.hint ? <span className="block text-[11px] font-normal text-zinc-400">{s.hint}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div ref={mainRef} className="min-w-0 flex-1 space-y-3">
          {children}
        </div>
      </div>

      <nav className="mt-4 flex gap-1 overflow-x-auto pb-1 lg:hidden" aria-label={`${navAriaLabel} — מובייל`}>
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onNavClick(s.id)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              activeNav === s.id ? "bg-[#7133da] text-white" : "bg-zinc-100 text-zinc-600"
            )}
          >
            {s.label}
          </button>
        ))}
      </nav>
    </section>
  );
}

/** מעטפת Field קיימת — רק יישור ימין, בלי לשנות תוויות/תוכן */
export function SalesPathFieldWrap({
  label,
  children,
  description,
}: {
  label: ReactNode;
  children: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="w-full space-y-2 text-right">
      <div className="text-[13px] font-medium text-zinc-800">{label}</div>
      {description ? <div className="text-xs leading-relaxed text-zinc-500">{description}</div> : null}
      {children}
    </div>
  );
}
