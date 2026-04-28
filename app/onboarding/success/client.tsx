"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const POLL_MS = 2000;
const TIMEOUT_MS = 120_000;
const WHATSAPP_HELP_URL =
  "https://wa.me/972508318162?text=%D7%94%D7%99%D7%99%2C%20%D7%99%D7%A9%20%D7%9C%D7%99%20%D7%A9%D7%90%D7%9C%D7%94%20%D7%91%D7%A0%D7%95%D7%92%D7%A2%20%D7%9C%D7%96%D7%95%D7%90%D7%99%21";

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
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "24px",
        paddingTop: "32px",
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
          marginTop: "10px",
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
            <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
              <a
                href={WHATSAPP_HELP_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="פנייה לוואטסאפ"
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 999,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#25D366",
                  boxShadow: "0 10px 24px rgba(37, 211, 102, 0.28)",
                  border: "1px solid rgba(0,0,0,0.06)",
                }}
              >
                <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true" focusable="false">
                  <path
                    fill="white"
                    d="M19.11 17.53c-.27-.14-1.6-.79-1.85-.88-.25-.09-.43-.14-.61.14-.18.27-.7.88-.86 1.06-.16.18-.32.2-.59.07-.27-.14-1.15-.42-2.19-1.35-.81-.72-1.36-1.6-1.52-1.87-.16-.27-.02-.41.12-.55.12-.12.27-.32.41-.48.14-.16.18-.27.27-.45.09-.18.05-.34-.02-.48-.07-.14-.61-1.47-.84-2.02-.22-.53-.45-.46-.61-.46h-.52c-.18 0-.48.07-.73.34-.25.27-.95.93-.95 2.26 0 1.33.97 2.62 1.11 2.8.14.18 1.91 2.91 4.63 4.08.65.28 1.16.45 1.56.57.66.21 1.26.18 1.73.11.53-.08 1.6-.65 1.83-1.27.23-.62.23-1.15.16-1.27-.07-.11-.25-.18-.52-.32z"
                  />
                  <path
                    fill="white"
                    d="M16.03 3C9.4 3 4 8.27 4 14.77c0 2.58.89 4.97 2.38 6.9L5 29l7.58-1.98c1.85 1 3.98 1.58 6.45 1.58C25.6 28.6 31 23.33 31 16.83 31 10.33 25.6 3 16.03 3zm0 23.32c-2.21 0-4.24-.62-5.95-1.7l-.43-.27-4.5 1.18 1.2-4.25-.29-.44c-1.29-1.87-2.04-4.13-2.04-6.47 0-6 5.02-10.89 11.01-10.89 5.99 0 11.01 4.89 11.01 10.89 0 6-5.02 10.95-11.01 10.95z"
                  />
                </svg>
              </a>
            </div>
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
