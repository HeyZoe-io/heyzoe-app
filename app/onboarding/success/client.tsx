"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

const POLL_MS = 2000;
const TIMEOUT_MS = 120_000;
const WHATSAPP_HELP_URL =
  "https://wa.me/972508318162?text=%D7%94%D7%99%D7%99%2C%20%D7%99%D7%A9%20%D7%9C%D7%99%20%D7%A9%D7%90%D7%9C%D7%94%20%D7%91%D7%A0%D7%95%D7%92%D7%A2%20%D7%9C%D7%96%D7%95%D7%90%D7%99%21";

const DASHBOARD_PREP_STEPS = [
  "קונים עבורך מספר ווטסאפ לבוט",
  "מחברים אותו לווטסאפ",
  "שולחים לאימות מול מטא",
  "מכינים לך את הדשבורד",
  "מחברים כל מה שצריך יחד…",
] as const;

const STEP_REVEAL_MS = 2200;

export default function OnboardingSuccessClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = (searchParams.get("email") || "").trim().toLowerCase();

  const [ready, setReady] = useState<null | { slug: string }>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [revealedStepCount, setRevealedStepCount] = useState(0);
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
            if (cancelled) return;
            // If we still have onboarding creds and email matches, try to sign-in automatically.
            try {
              const storedEmail = String(sessionStorage.getItem("hz_onb_email") || "").trim().toLowerCase();
              const storedPw = String(sessionStorage.getItem("hz_onb_password") || "");
              if (storedEmail && storedPw && storedEmail === email) {
                const supabase = createSupabaseBrowserClient();
                void supabase.auth
                  .signInWithPassword({ email: storedEmail, password: storedPw })
                  .then(({ error }) => {
                    if (error) {
                      router.replace(
                        `/dashboard/login?next=${encodeURIComponent(`/${slug}/analytics?welcome=1`)}&msg=${encodeURIComponent(
                          "התחברי כדי להיכנס לדשבורד."
                        )}`
                      );
                      return;
                    }
                    router.replace(`/${slug}/analytics?welcome=1`);
                  });
                return;
              }
            } catch {
              // ignore
            }
            router.replace(`/${slug}/analytics?welcome=1`);
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

  useEffect(() => {
    if (!email || ready || timedOut) return;
    let n = 0;
    const bump = () => {
      if (n >= DASHBOARD_PREP_STEPS.length) return;
      n += 1;
      setRevealedStepCount(n);
    };
    bump();
    const id = window.setInterval(bump, STEP_REVEAL_MS);
    return () => window.clearInterval(id);
  }, [email, ready, timedOut]);

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
          maxWidth: "560px",
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
                <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">
                  <path
                    fill="white"
                    d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
                  />
                </svg>
              </a>
            </div>
          </div>
        ) : ready ? (
          <div>
            <div
              style={{
                textAlign: "right",
                marginBottom: "18px",
                padding: "14px 16px",
                borderRadius: "16px",
                background: "rgba(245,243,255,0.9)",
                border: "1px solid rgba(113,51,218,0.1)",
              }}
            >
              {DASHBOARD_PREP_STEPS.map((line, i) => (
                <div
                  key={line}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "10px",
                    marginBottom: i === DASHBOARD_PREP_STEPS.length - 1 ? 0 : "10px",
                    fontSize: "14px",
                    lineHeight: 1.55,
                    color: "#2d1a6e",
                  }}
                >
                  <span style={{ flexShrink: 0, color: "#22c55e", fontWeight: 800 }} aria-hidden>
                    ✓
                  </span>
                  <span>{line}</span>
                </div>
              ))}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  marginTop: "12px",
                  paddingTop: "12px",
                  borderTop: "1px solid rgba(113,51,218,0.12)",
                  fontSize: "15px",
                  fontWeight: 700,
                  color: "#7133da",
                }}
              >
                <span style={{ flexShrink: 0, color: "#22c55e" }} aria-hidden>
                  ✓
                </span>
                <span>הצלחנו!</span>
              </div>
            </div>
            <div style={{ fontSize: "20px", fontWeight: 700, color: "#7133da" }}>הכל מוכן! 🎉 מעבירים אותך...</div>
          </div>
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
            <p style={{ margin: "0 0 18px", color: "#6b5b9a", fontSize: "15px", lineHeight: 1.6 }}>
              זה לוקח בערך דקה, לא לסגור את הדף
            </p>
            <div
              style={{
                textAlign: "right",
                marginBottom: "20px",
                padding: "14px 16px",
                borderRadius: "16px",
                background: "rgba(245,243,255,0.75)",
                border: "1px solid rgba(113,51,218,0.1)",
              }}
            >
              {DASHBOARD_PREP_STEPS.map((line, i) => {
                const done = i < revealedStepCount;
                return (
                  <div
                    key={line}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "10px",
                      marginBottom: i === DASHBOARD_PREP_STEPS.length - 1 ? 0 : "10px",
                      fontSize: "14px",
                      lineHeight: 1.55,
                      color: done ? "#2d1a6e" : "#a89bc4",
                      transition: "color 0.35s ease",
                    }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        width: "1.1em",
                        fontWeight: 800,
                        color: done ? "#22c55e" : "rgba(113,51,218,0.25)",
                      }}
                      aria-hidden
                    >
                      {done ? "✓" : "○"}
                    </span>
                    <span>{line}</span>
                  </div>
                );
              })}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  marginTop: "12px",
                  paddingTop: "12px",
                  borderTop: "1px solid rgba(113,51,218,0.1)",
                  fontSize: "14px",
                  fontWeight: 700,
                  color: "#a89bc4",
                }}
              >
                <span style={{ flexShrink: 0, width: "1.1em", color: "rgba(113,51,218,0.25)" }} aria-hidden>
                  ○
                </span>
                <span>הצלחנו!</span>
              </div>
            </div>
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
