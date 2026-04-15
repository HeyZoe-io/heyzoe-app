import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-white/70 bg-white/75 px-3 py-1 text-xs font-semibold text-zinc-700 shadow-[0_10px_22px_rgba(111,82,181,0.09)] backdrop-blur-sm",
        className
      )}
      {...props}
    />
  );
}
