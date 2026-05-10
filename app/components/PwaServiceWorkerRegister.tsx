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
      .register("/sw.js", { scope: "/", type: "classic", updateViaCache: "none" })
      .catch(() => {
        /* ignore — ad blockers / private mode */
      });
  }, []);

  return null;
}
