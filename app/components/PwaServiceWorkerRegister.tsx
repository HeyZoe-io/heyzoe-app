"use client";

import { useEffect } from "react";

/**
 * Registers minimal `/sw.js` in production only (avoids interfering with HMR in dev).
 */
export default function PwaServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    void navigator.serviceWorker
      .register("/sw.js?v=2026-05-21-dashboard-ui", {
        scope: "/",
        type: "classic",
        updateViaCache: "none",
      })
      .then((reg) => {
        void reg?.update();
        reg?.addEventListener("updatefound", () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "activated" && navigator.serviceWorker.controller) {
              window.location.reload();
            }
          });
        });
      })
      .catch(() => {
        /* ignore — ad blockers / private mode */
      });
  }, []);

  return null;
}
