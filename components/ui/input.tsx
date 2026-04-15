import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-11 w-full rounded-2xl border border-[rgba(124,96,202,0.18)] bg-white/88 px-4 py-2 text-sm text-zinc-800 shadow-[0_12px_28px_rgba(110,78,176,0.08)] backdrop-blur-sm transition-all duration-200 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:border-[rgba(113,51,218,0.35)] hover:border-[rgba(113,51,218,0.24)]",
        className
      )}
      {...props}
    />
  );
}
