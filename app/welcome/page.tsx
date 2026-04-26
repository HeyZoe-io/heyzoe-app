"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const POLL_MS = 3000;
const TIMEOUT_MS = 120_000;

type Phase = "loading" | "ready" | "timeout" | "missing_email";

function WelcomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = (searchParams.get("email") || "").trim().toLowerCase();

  const [phase, setPhase] = useState<Phase>(() => (email ? "loading" : "missing_email"));

  useEffect(() => {
    if (!email) {
      setPhase("missing_email");
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const check = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt >= TIMEOUT_MS) {
        setPhase("timeout");
        if (intervalId) clearInterval(intervalId);
        return;
      }
      try {
        const res = await fetch(
          `/api/check-payment-ready?email=${encodeURIComponent(email)}`,
          { cache: "no-store" }
        );
        const data = (await res.json()) as { ready?: boolean; slug?: string };
        if (data?.ready && data.slug) {
          if (intervalId) clearInterval(intervalId);
          const slug = data.slug;
          setPhase("ready");
          window.setTimeout(() => {
            if (!cancelled) router.replace(`/${slug}/settings`);
          }, 1500);
          return;
        }
      } catch {
        // keep polling
      }
    };

    void check();
    intervalId = setInterval(() => {
      void check();
    }, POLL_MS);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [email, router]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "40px 20px 48px",
        background: "#f5f3ff",
        color: "#1a0a3c",
      }}
    >
      <style>{`
        @keyframes welcomeBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        .welcome-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #7133da;
          animation: welcomeBounce 0.55s ease-in-out infinite;
        }
        .welcome-dot:nth-child(1) { animation-delay: 0s; }
        .welcome-dot:nth-child(2) { animation-delay: 0.12s; }
        .welcome-dot:nth-child(3) { animation-delay: 0.24s; }
      `}</style>

      <div style={{ marginBottom: "28px" }}>
        <img src="/heyzoe-logo.png" alt="HeyZoe" style={{ height: "40px", width: "auto" }} />
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: "480px",
          background: "white",
          borderRadius: "24px",
          boxShadow: "0 8px 40px rgba(113,51,218,0.12)",
          padding: "32px 28px 36px",
          textAlign: "center",
        }}
      >
        {phase === "missing_email" ? (
          <p style={{ fontSize: "16px", color: "#6b5b9a", margin: 0, lineHeight: 1.6 }}>
            חסר אימייל בכתובת. חזרו לקישור מהאימייל.
          </p>
        ) : null}

        {phase === "loading" ? (
          <>
            <h1
              style={{
                fontSize: "24px",
                fontWeight: 700,
                margin: "0 0 12px",
                background: "linear-gradient(135deg, #7133da, #ff92ff)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
                color: "#7133da",
              }}
            >
              מכינים את הזואי שלך ✨
            </h1>
            <p style={{ fontSize: "15px", color: "#6b5b9a", margin: "0 0 24px", lineHeight: 1.6 }}>
              זה לוקח כמה שניות, בבקשה לא לסגור את הדף
            </p>
            <div
              style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "8px" }}
              aria-hidden
            >
              <span className="welcome-dot" />
              <span className="welcome-dot" />
              <span className="welcome-dot" />
            </div>
          </>
        ) : null}

        {phase === "ready" ? (
          <p style={{ fontSize: "20px", fontWeight: 700, margin: 0, color: "#7133da" }}>
            הכל מוכן! 🎉 מעבירים אותך…
          </p>
        ) : null}

        {phase === "timeout" ? (
          <p style={{ fontSize: "16px", color: "#6b5b9a", margin: 0, lineHeight: 1.7 }}>
            משהו תקע 😕 צרו קשר ב־
            <a href="mailto:office@heyzoe.io" style={{ color: "#7133da", fontWeight: 600 }}>
              office@heyzoe.io
            </a>
          </p>
        ) : null}
      </div>
    </main>
  );
}

export default function WelcomePage() {
  return (
    <Suspense
      fallback={
        <div
          dir="rtl"
          style={{
            minHeight: "100vh",
            background: "#f5f3ff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#7133da",
            fontSize: "15px",
            fontFamily: "'Fredoka', 'Heebo', system-ui, sans-serif",
          }}
        >
          טוען…
        </div>
      }
    >
      <WelcomeContent />
    </Suspense>
  );
}
