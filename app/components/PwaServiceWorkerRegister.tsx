"use client";

import { useEffect } from "react";

/**
 * Registers minimal `/sw.js` in production only (avoids interfering with HMR in dev).
 *
 * Do NOT auto-reload on SW activate: skipWaiting + clients.claim + location.reload
 * caused the admin/dashboard UI to hard-refresh on mobile (PWA / Chrome) whenever
 * an update was detected — including noisy update checks after tab focus.
 */
export default function PwaServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    void navigator.serviceWorker
      .register("/sw.js?v=2026-09-26-no-autoreload", {
        scope: "/",
        type: "classic",
        updateViaCache: "none",
      })
      .catch(() => {
        /* ignore — ad blockers / private mode */
      });
  }, []);

  return null;
}
