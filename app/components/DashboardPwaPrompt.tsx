"use client";

import { useEffect, useMemo, useState } from "react";

type PlatformKind = "ios" | "android" | "other";

function detectPlatform(userAgent: string): PlatformKind {
  const ua = userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);
  if (isIOS) return "ios";
  if (isAndroid) return "android";
  return "other";
}

function isMobileUA(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  return /iphone|ipad|ipod|android/.test(ua);
}

function readNumber(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function readBool(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeNumber(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
}

function writeBool(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // ignore
  }
}

export default function DashboardPwaPrompt() {
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState<PlatformKind>("other");

  const keys = useMemo(
    () => ({
      lastSeenMs: "zoe_pwa_dash_last_seen_ms",
      snoozeUntilMs: "zoe_pwa_dash_snooze_until_ms",
      understoodForever: "zoe_pwa_dash_understood_forever",
    }),
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isStandalone =
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      (window.navigator as any).standalone === true;
    if (isStandalone) return;

    const ua = window.navigator.userAgent || "";
    if (!isMobileUA(ua)) return;

    const p = detectPlatform(ua);
    if (p === "other") return;
    setPlatform(p);

    if (readBool(keys.understoodForever)) return;

    const now = Date.now();
    const lastSeen = readNumber(keys.lastSeenMs);
    const snoozeUntil = readNumber(keys.snoozeUntilMs) ?? 0;

    if (now < snoozeUntil) return;

    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    if (lastSeen && now - lastSeen < threeDaysMs) return;

    // show and record exposure time
    setVisible(true);
    writeNumber(keys.lastSeenMs, now);
  }, [keys.lastSeenMs, keys.snoozeUntilMs, keys.understoodForever]);

  if (!visible) return null;

  const instructions =
    platform === "ios"
      ? "ב-iOS Safari: לחצו על כפתור השיתוף ואז 'הוספה למסך הבית'."
      : "ב-Android Chrome: לחצו על התפריט ⋮ ואז 'הוספה למסך הבית'.";

  const closeFor30Days = () => {
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    writeNumber(keys.snoozeUntilMs, now + thirtyDaysMs);
    setVisible(false);
  };

  const understoodForever = () => {
    writeBool(keys.understoodForever, true);
    setVisible(false);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-4 sm:hidden">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white/95 shadow-[0_10px_40px_rgba(0,0,0,0.15)] backdrop-blur-md px-4 py-3 text-right">
        <div className="flex items-start gap-3">
          <div className="mt-1 h-8 w-8 rounded-full bg-yellow-300 flex items-center justify-center text-xs font-semibold text-zinc-900 select-none">
            HZ
          </div>
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium text-zinc-900">הוספה למסך הבית</p>
            <p className="text-xs text-zinc-600">{instructions}</p>
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={understoodForever}
                className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50 cursor-pointer"
              >
                הבנתי
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={closeFor30Days}
            className="ml-1 text-xs text-zinc-400 hover:text-zinc-600 cursor-pointer"
            aria-label="סגור"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

