"use client";

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
    <div className="mb-7 text-right">
      <div className="mb-2 flex items-center justify-start gap-3">
        <span className="text-sm font-bold tabular-nums text-[#7133da]/80">{n}</span>
        <h2 className="text-[1.45rem] font-extrabold tracking-[-0.03em] text-zinc-900">{title}</h2>
      </div>
      {desc ? (
        <p className="max-w-[42rem] text-[0.95rem] leading-7 text-zinc-500">{desc}</p>
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

