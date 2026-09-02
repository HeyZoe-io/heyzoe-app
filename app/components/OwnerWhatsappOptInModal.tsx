"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { buildOwnerWhatsappConnectUrl } from "@/lib/notifications/owner-opt-in";

const STORAGE_PREFIX = "hz_owner_wa_optin_shown_date";

function israelToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

function storageKey(slug: string) {
  return `${STORAGE_PREFIX}:${slug}`;
}

function alreadyShownToday(slug: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(slug)) === israelToday();
  } catch {
    return false;
  }
}

function markShownToday(slug: string) {
  try {
    window.localStorage.setItem(storageKey(slug), israelToday());
  } catch {
    // ignore quota / private mode
  }
}

function subscribeNoop() {
  return () => {};
}

export default function OwnerWhatsappOptInModal({ slug }: { slug: string }) {
  const shownToday = useSyncExternalStore(
    subscribeNoop,
    () => alreadyShownToday(slug),
    () => true
  );
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (shownToday) return;
    markShownToday(slug);
  }, [shownToday, slug]);

  if (shownToday || dismissed) return null;

  const connectUrl = buildOwnerWhatsappConnectUrl(slug);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="owner-wa-optin-title"
      dir="rtl"
    >
      <div className="w-full max-w-md rounded-2xl border border-fuchsia-200 bg-white p-6 shadow-xl text-right">
        <h2 id="owner-wa-optin-title" className="text-lg font-semibold text-zinc-900">
          חיבור ווטסאפ להתראות
        </h2>
        <p className="mt-2 text-sm text-zinc-600 leading-relaxed">
          כדי לקבל התראות על לידים, שיחות ממתינות ועוד — חברו את הווטסאפ שלכם פעם אחת. אחרי שליחת ההודעה בוואטסאפ,
          רעננו את הדף.
        </p>
        <div className="mt-5 flex flex-wrap gap-2 justify-start">
          <a
            href={connectUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-2xl px-4 py-2.5 text-sm font-semibold text-white shadow-[0_16px_35px_rgba(142,75,255,0.28)] bg-[linear-gradient(135deg,#5f2ee8_0%,#9043ff_42%,#ff78de_100%)] hover:brightness-[1.03]"
          >
            חבר ווטסאפ
          </a>
          <Button type="button" variant="outline" onClick={() => setDismissed(true)}>
            אחר כך
          </Button>
        </div>
        </div>
    </div>
  );
}
