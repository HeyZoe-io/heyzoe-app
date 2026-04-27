"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const POLL_MS = 2000;
const TIMEOUT_MS = 120_000;

export default function OnboardingSuccessClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = (searchParams.get("email") || "").trim().toLowerCase();

  const [ready, setReady] = useState<null | { slug: string }>(null);
  const [timedOut, setTimedOut] = useState(false);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!email) return;

    let cancelled = false;
    const startedAt = Date.now();

    async function tick() {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= TIMEOUT_MS) {
        setTimedOut(true);
        return;
      }

      try {
        const res = await fetch(`/api/check-payment-ready?email=${encodeURIComponent(email)}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as { ready?: boolean; slug?: string };
        if (data?.ready && data.slug) {
          const slug = data.slug;
          // LP purchase tracking (best-effort): relies on sessionStorage values set on /lp-leads.
          try {
            const sid = sessionStorage.getItem("hz_lp_session_id") || "";
            const src = sessionStorage.getItem("hz_lp_source");
            const valRaw = sessionStorage.getItem("hz_lp_plan_value");
            const value = valRaw ? Number(valRaw) : null;
            if (sid && typeof value === "number" && Number.isFinite(value) && value > 0) {
              void fetch("/api/track", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ event_type: "purchase", value, source: src, session_id: sid }),
                keepalive: true,
              });
            }
          } catch {
            /* ignore */
          }
          setReady({ slug });
          redirectTimerRef.current = setTimeout(() => {
            if (!cancelled) router.replace(`/${slug}/analytics?welcome=1`);
          }, 1500);
          return;
        }
      } catch {
        // ignore transient errors
      }

      setTimeout(tick, POLL_MS);
    }

    void tick();
    return () => {
      cancelled = true;
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
  }, [email, router]);

  return (
    <main
      dir="rtl"
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
      <style>{`
        @keyframes bounceDot {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        .success-bounce-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #7133da;
          animation: bounceDot 0.55s ease-in-out infinite;
        }
        .success-bounce-dot:nth-child(1) { animation-delay: 0s; }
        .success-bounce-dot:nth-child(2) { animation-delay: 0.15s; }
        .success-bounce-dot:nth-child(3) { animation-delay: 0.3s; }
      `}</style>

      <div
        style={{
          width: "100%",
          maxWidth: "520px",
          background: "white",
          borderRadius: "24px",
          boxShadow: "0 8px 40px rgba(113,51,218,0.12)",
          padding: "28px 24px",
          textAlign: "center",
          border: "1px solid rgba(113,51,218,0.12)",
        }}
      >
        <div style={{ marginBottom: "20px" }}>
          <img src="/heyzoe-logo.png" alt="HeyZoe" style={{ height: "40px", width: "auto" }} />
        </div>

        {!email ? (
          <div style={{ color: "#6b5b9a", fontSize: "14px", lineHeight: 1.7 }}>
            חסר אימייל בקישור. אם זה קרה אחרי תשלום, כתבו לנו בוואטסאפ ונעזור מיד.
          </div>
        ) : timedOut ? (
          <div style={{ color: "#6b5b9a", fontSize: "14px", lineHeight: 1.7 }}>
            משהו תקע, פנו אלינו בוואטסאפ ונבדוק את זה איתכם.
          </div>
        ) : ready ? (
          <div style={{ fontSize: "20px", fontWeight: 700, color: "#7133da" }}>הכל מוכן! 🎉 מעבירים אותך...</div>
        ) : (
          <>
            <h1
              style={{
                fontSize: "22px",
                fontWeight: 700,
                margin: "0 0 12px",
                background: "linear-gradient(135deg, #7133da, #ff92ff)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
                color: "#7133da",
              }}
            >
              מכינים את הדשבורד שלך ✨
            </h1>
            <p style={{ margin: "0 0 20px", color: "#6b5b9a", fontSize: "15px", lineHeight: 1.6 }}>
              זה לוקח כמה שניות, אל תסגרי את הדף
            </p>
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "8px" }} aria-hidden>
              <span className="success-bounce-dot" />
              <span className="success-bounce-dot" />
              <span className="success-bounce-dot" />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
