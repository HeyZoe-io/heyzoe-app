"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { buildOwnerWhatsappConnectUrl } from "@/lib/notifications/owner-opt-in";

export default function OwnerWhatsappOptInModal({ slug }: { slug: string }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

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
