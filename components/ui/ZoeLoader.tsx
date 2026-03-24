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
    <div className="min-h-screen w-full flex items-center justify-center bg-white/70 backdrop-blur-[2px]">
      <div className="flex flex-col items-center gap-3" dir="rtl">
        <div
          className="relative h-14 w-14 rounded-full border-4 border-black/10 animate-spin"
          style={{ borderTopColor: color, borderRightColor: color }}
          aria-hidden
        />
        <p className="text-sm font-medium text-zinc-600">{label}</p>
      </div>
    </div>
  );
}
