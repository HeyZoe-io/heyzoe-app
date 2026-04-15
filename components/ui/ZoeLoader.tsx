"use client";

type ZoeLoaderProps = {
  color?: string;
  label?: string;
};

export default function ZoeLoader({
  color = "#FFD646",
  label = "טוען...",
}: ZoeLoaderProps) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-white/35 backdrop-blur-md">
      <div className="hz-frost rounded-[28px] px-8 py-7 flex flex-col items-center gap-3.5" dir="rtl">
        <div
          className="relative h-14 w-14 rounded-full border-4 border-black/10 animate-spin shadow-[0_12px_28px_rgba(113,51,218,0.18)]"
          style={{ borderTopColor: color, borderRightColor: color }}
          aria-hidden
        />
        <p className="text-sm font-semibold text-zinc-700">{label}</p>
      </div>
    </div>
  );
}
