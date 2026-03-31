"use client";

import { useEffect, useState } from "react";

type PlatformKind = "ios" | "android" | "other";

function detectPlatform(userAgent: string): PlatformKind {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "other";
}

export default function PwaInstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState<PlatformKind>("other");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isStandalone =
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      // iOS Safari heuristic
      (window.navigator as any).standalone === true;

    if (isStandalone) return;

    const ua = window.navigator.userAgent || "";
    const p = detectPlatform(ua);
    setPlatform(p);

    if (p === "other") return;

    const storageKey = "zoe_pwa_prompt_dismissed";
    if (window.localStorage.getItem(storageKey) === "1") return;

    setVisible(true);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("zoe_pwa_prompt_dismissed", "1");
    }
    setVisible(false);
  };

  const instructions =
    platform === "ios"
      ? "ב-iOS Safari: לחצו על כפתור השיתוף למטה ואז 'הוספה למסך הבית'."
      : "ב-Android Chrome: לחצו על התפריט ⋮ ואז 'הוספה למסך הבית'.";

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-4 sm:hidden">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white/95 shadow-[0_10px_40px_rgba(0,0,0,0.15)] backdrop-blur-md px-4 py-3 text-right">
        <div className="flex items-start gap-3">
          <div className="mt-1 h-8 w-8 rounded-full bg-yellow-300 flex items-center justify-center text-xs font-semibold text-zinc-900">
            Zoe
          </div>
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium text-zinc-900">הוספה למסך הבית</p>
            <p className="text-xs text-zinc-600">{instructions}</p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="ml-1 text-xs text-zinc-400 hover:text-zinc-600"
          >
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}

