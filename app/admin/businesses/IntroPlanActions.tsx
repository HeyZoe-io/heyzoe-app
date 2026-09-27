"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function IntroPlanActions({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<null | "starter" | "pro">(null);
  const [error, setError] = useState("");

  async function choose(which: "starter" | "pro") {
    setPending(which);
    setError("");
    try {
      const res = await fetch("/api/admin/businesses/plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, closeIntro: which }),
      });
      if (!res.ok) {
        setError("השמירה נכשלה");
        setPending(null);
        return;
      }
      router.refresh();
    } catch {
      setError("השמירה נכשלה");
      setPending(null);
    }
  }

  return (
    <div className="mt-2 flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending != null}
        onClick={() => void choose("starter")}
        className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] text-zinc-700 hover:border-[#7133da]/30 disabled:opacity-50"
      >
        {pending === "starter" ? "שומר…" : "אושר Starter · ₪299"}
      </button>
      <button
        type="button"
        disabled={pending != null}
        onClick={() => void choose("pro")}
        className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] text-zinc-700 hover:border-[#7133da]/30 disabled:opacity-50"
      >
        {pending === "pro" ? "שומר…" : "אושר Pro · ₪429"}
      </button>
      {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
    </div>
  );
}
