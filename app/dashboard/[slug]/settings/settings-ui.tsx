"use client";

export function StepHeader({ n, title, desc }: { n: number; title: string; desc?: string }) {
  return (
    <div className="mb-7">
      <div className="mb-2 flex items-center gap-3">
        <span className="hz-glow flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(113,51,218,0.16),rgba(255,146,255,0.22))] text-sm font-extrabold text-[#7133da] shadow-[0_14px_28px_rgba(113,51,218,0.14)] ring-1 ring-white/70">
          {n}
        </span>
        <h2 className="text-[1.45rem] font-extrabold tracking-[-0.03em] text-zinc-900">{title}</h2>
      </div>
      {desc ? (
        <p className="mr-13 max-w-[42rem] text-[0.95rem] leading-7 text-zinc-500">{desc}</p>
      ) : null}
    </div>
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

