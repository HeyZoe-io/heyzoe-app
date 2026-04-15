import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "outline" | "ghost";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ className, variant = "default", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold tracking-[-0.01em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-50 hz-lift",
        variant === "default" &&
          "text-white shadow-[0_16px_35px_rgba(142,75,255,0.28)] bg-[linear-gradient(135deg,#5f2ee8_0%,#9043ff_42%,#ff78de_100%)] hover:brightness-[1.03] active:scale-[0.99]",
        variant === "outline" &&
          "border border-[rgba(120,92,200,0.18)] bg-white/80 text-zinc-900 shadow-[0_10px_24px_rgba(117,90,180,0.1)] backdrop-blur-sm hover:bg-white hover:border-[rgba(113,51,218,0.26)]",
        variant === "ghost" &&
          "bg-white/40 text-zinc-700 hover:bg-white/75 hover:text-zinc-900",
        className
      )}
      {...props}
    />
  );
}
