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
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:pointer-events-none disabled:opacity-50",
        variant === "default" && "bg-zinc-900 text-white hover:bg-zinc-800",
        variant === "outline" && "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50",
        variant === "ghost" && "bg-transparent text-zinc-700 hover:bg-zinc-100",
        className
      )}
      {...props}
    />
  );
}
