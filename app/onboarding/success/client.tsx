"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function OnboardingSuccessClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = (searchParams.get("email") || "").trim().toLowerCase();

  const [seconds, setSeconds] = useState(0);
  const [ready, setReady] = useState<null | { slug: string }>(null);
  const [timedOut, setTimedOut] = useState(false);

  const dots = useMemo(() => ".".repeat(((seconds % 3) + 1) as 1 | 2 | 3), [seconds]);

  useEffect(() => {
    if (!email) return;

    let cancelled = false;
    const startedAt = Date.now();

    async function tick() {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= 60_000) {
        setTimedOut(true);
        return;
      }

      setSeconds(Math.floor(elapsed / 1000));

      try {
        const res = await fetch(`/api/check-payment-ready?email=${encodeURIComponent(email)}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as { ready?: boolean; slug?: string };
        if (data?.ready && data.slug) {
          setReady({ slug: data.slug });
          router.replace(`/${data.slug}/analytics?welcome=1`);
          return;
        }
      } catch {
        // ignore transient errors
      }

      setTimeout(tick, 2000);
    }

    void tick();
    return () => {
      cancelled = true;
    };
  }, [email, router]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "#f5f3ff",
        fontFamily: "Fredoka, Heebo, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "520px",
          background: "white",
          borderRadius: "16px",
          boxShadow: "0 8px 40px rgba(113,51,218,0.12)",
          padding: "28px 24px",
          textAlign: "right",
          border: "1px solid rgba(113,51,218,0.12)",
        }}
      >
        <div style={{ color: "#7133da", fontWeight: 700, fontSize: "22px" }}>התשלום עבר בהצלחה! 🎉</div>

        {!email ? (
          <div style={{ marginTop: "12px", color: "#6b5b9a", fontSize: "14px", lineHeight: 1.7 }}>
            חסר אימייל בקישור. אם זה קרה אחרי תשלום, כתבו לנו בוואטסאפ ונעזור מיד.
          </div>
        ) : timedOut ? (
          <div style={{ marginTop: "12px", color: "#6b5b9a", fontSize: "14px", lineHeight: 1.7 }}>
            משהו תקע, פנו אלינו בוואטסאפ ונבדוק את זה איתכם.
          </div>
        ) : (
          <div style={{ marginTop: "12px", color: "#6b5b9a", fontSize: "14px", lineHeight: 1.7 }}>
            מכינים לך את הדשבורד{dots}
          </div>
        )}

        {ready?.slug ? (
          <div style={{ marginTop: "12px", color: "#6b5b9a", fontSize: "12px" }}>מעביר לדשבורד…</div>
        ) : null}
      </div>
    </main>
  );
}

