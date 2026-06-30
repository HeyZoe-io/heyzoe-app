"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

/** Meta JS SDK (Embedded Signup) — minimal surface */
type FbAuthResponse = {
  code?: string;
  accessToken?: string;
  userID?: string;
  waba_id?: string;
  wabaId?: string;
  [key: string]: unknown;
};

type FbLoginResponse = {
  status?: string;
  authResponse?: FbAuthResponse;
};

type WaEmbeddedSignupMessage = {
  type?: string;
  event?: string;
  data?: {
    waba_id?: unknown;
    phone_number_id?: unknown;
    [key: string]: unknown;
  };
};

type Lang = "he" | "en";

const i18n = {
  he: {
    prepSteps: [
      "מאמתים את התשלום",
      "מכינים את החשבון שלך",
      "טוענים את ההגדרות",
      "מסדרים את הדשבורד",
      "כמעט שם…",
    ],
    loginRedirectMsg: "התחברי כדי להיכנס לדשבורד.",
    missingEmail: "חסר אימייל בקישור. אם זה קרה אחרי תשלום, כתבו לנו בוואטסאפ ונעזור מיד.",
    timedOut: "משהו תקע, פנו אלינו בוואטסאפ ונבדוק את זה איתכם.",
    whatsappHelpAria: "פנייה לוואטסאפ",
    doneLabel: "הצלחנו!",
    title: "חיבור ווטסאפ עסקי (מטא)",
    connectDescription:
      "מחברים את חשבון ה־WhatsApp Business שלכם ל־HeyZoe דרך פייסבוק. אם אין לכם עדיין אפליקציית מטא מוכנה, אפשר לדלג — תמיד אפשר לחזור לזה מהדשבורד.",
    missingAppId:
      "חסר NEXT_PUBLIC_META_APP_ID (או NEXT_PUBLIC_FACEBOOK_APP_ID) בשרת — לא ניתן להציג את חלון ההתחברות.",
    connect: "חברו ווטסאפ עסקי",
    connecting: "מתחברים…",
    success: "מחובר! מכין את החשבון...",
    successRedirecting: "מחובר! מעבירים אותך לדשבורד...",
    error_no_waba:
      "לא התקבל מזהה WABA מהתחברות פייסבוק. נסו שוב או בדקו את ההגדרות באפליקציית מטא.",
    error_cancelled: "החיבור בוטל",
    error_fb_load: "טעינת פייסבוק נכשלה. רעננו את הדף.",
    error_server: (status: number) => `שגיאת שרת (${status})`,
    error_network: "בעיית רשת בשמירה.",
    allReadyRedirect: "הכל מוכן! 🎉 מעבירים אותך...",
    preparing: "מכינים את הדשבורד שלך ✨",
    preparingHint: "זה לוקח בערך דקה, לא לסגור את הדף",
    choiceTitle: "איך תרצו לחבר את הווטסאפ?",
    choiceSubtitle: "בחרו את הדרך שמתאימה לכם — תמיד אפשר לשנות בהמשך.",
    optCoexistenceTitle: "חיבור המספר הקיים שלי",
    optCoexistenceDesc:
      "נחבר את זואי למספר הווטסאפ העסקי הקיים שלכם, בלי לאבד את ההודעות והצ׳אטים. אם המספר עדיין על וואטסאפ רגיל — קודם התקינו WhatsApp Business והעבירו אליו את המספר.",
    optNewTitle: "מספר חדש מ-HeyZoe",
    optNewDesc: "נקנה ונחבר עבורכם מספר ווטסאפ חדש וייעודי לבוט. הדרך המהירה להתחיל.",
    optManualTitle: "חיבור עם ליווי הצוות",
    optManualDesc: "מעדיפים שנלווה אתכם? הצוות שלנו יחזור אליכם ויחבר את הכל יחד.",
    comingSoon: "בקרוב",
    manualInstructions:
      "תודה! בחרתם חיבור עם ליווי. הצוות שלנו יחזור אליכם בהקדם כדי לחבר את הווטסאפ יחד. אפשר לסגור את הדף.",
    changeChoice: "שינוי בחירה",
    pathSaveError: "שמירת הבחירה נכשלה. נסו שוב.",
    coexPreflightTitle: "לפני שמתחילים — כמה דברים חשובים",
    coexReqAppOnly: "צריך שהמספר יהיה על אפליקציית WhatsApp Business (לא וואטסאפ הרגיל). אם הוא עדיין על וואטסאפ רגיל — התקינו WhatsApp Business והעבירו אליו את המספר קודם.",
    coexReqVersion: "ודאו שאפליקציית WhatsApp Business מעודכנת לגרסה 2.24.17 ומעלה.",
    coexReqKeepOpen: "השאירו את אפליקציית WhatsApp Business פתוחה במכשיר לאורך כל תהליך החיבור.",
    coexReq14Days: "כדי לשמור על החיבור פעיל — פתחו את האפליקציה לפחות אחת ל-14 יום.",
    coexAckButton: "הבנתי, ממשיכים",
    coexConnect: "חברו את המספר הקיים",
    coexConnectHint:
      "במסך של פייסבוק שייפתח, תחת «WhatsApp Business account» — בחרו «Connect a WhatsApp Business App» (האייקון הירוק), ולא «Create a WhatsApp Business account».",
    coexStuckHelp: "נתקעת? דברו איתנו בוואטסאפ",
  },
  en: {
    prepSteps: [
      "Verifying your payment",
      "Setting up your account",
      "Loading your settings",
      "Preparing your dashboard",
      "Almost there…",
    ],
    loginRedirectMsg: "Sign in to access your dashboard.",
    missingEmail:
      "Email is missing from the link. If this happened after payment, message us on WhatsApp and we'll help right away.",
    timedOut: "Something got stuck. Reach out on WhatsApp and we'll check it with you.",
    whatsappHelpAria: "Contact us on WhatsApp",
    doneLabel: "All set!",
    title: "Connect WhatsApp Business (Meta)",
    connectDescription:
      "Connect your WhatsApp Business account to HeyZoe via Facebook. If your Meta app isn't ready yet, you can skip — you can always return to this from the dashboard.",
    missingAppId:
      "NEXT_PUBLIC_META_APP_ID (or NEXT_PUBLIC_FACEBOOK_APP_ID) is missing on the server — the login dialog cannot be shown.",
    connect: "Connect WhatsApp Business",
    connecting: "Connecting…",
    success: "Connected! Setting up your account...",
    successRedirecting: "Connected! Redirecting to your dashboard...",
    error_no_waba:
      "WABA ID not received from Facebook login. Try again or check your Meta app settings.",
    error_cancelled: "Connection cancelled",
    error_fb_load: "Failed to load Facebook. Refresh the page.",
    error_server: (status: number) => `Server error (${status})`,
    error_network: "Network error while saving.",
    allReadyRedirect: "You're all set! 🎉 Redirecting you...",
    preparing: "Preparing your dashboard ✨",
    preparingHint: "This takes about a minute — please keep this page open",
    choiceTitle: "How would you like to connect WhatsApp?",
    choiceSubtitle: "Choose what works for you — you can always change this later.",
    optCoexistenceTitle: "Connect my existing number",
    optCoexistenceDesc:
      "We'll connect Zoe to your existing WhatsApp Business number without losing your messages and chats. If the number is still on regular WhatsApp — first install WhatsApp Business and move the number to it.",
    optNewTitle: "A new number from HeyZoe",
    optNewDesc: "We'll buy and connect a dedicated new WhatsApp number for your bot. The fastest way to start.",
    optManualTitle: "Guided setup with our team",
    optManualDesc: "Prefer us to guide you? Our team will reach out and connect everything together.",
    comingSoon: "Coming soon",
    manualInstructions:
      "Thanks! You chose guided setup. Our team will reach out shortly to connect WhatsApp together. You can close this page.",
    changeChoice: "Change selection",
    pathSaveError: "Couldn't save your selection. Please try again.",
    coexPreflightTitle: "Before we start — a few important things",
    coexReqAppOnly: "Your number must be on the WhatsApp Business app (not regular WhatsApp). If it's still on regular WhatsApp — install WhatsApp Business and move the number to it first.",
    coexReqVersion: "Make sure the WhatsApp Business app is updated to version 2.24.17 or later.",
    coexReqKeepOpen: "Keep the WhatsApp Business app open on your device throughout the connection process.",
    coexReq14Days: "To keep the connection active — open the app at least once every 14 days.",
    coexAckButton: "Got it, continue",
    coexConnect: "Connect my existing number",
    coexConnectHint:
      "In the Facebook screen that opens, under «WhatsApp Business account», choose «Connect a WhatsApp Business App» (the green icon) — not «Create a WhatsApp Business account».",
    coexStuckHelp: "Stuck? Chat with us on WhatsApp",
  },
} as const;

declare global {
  interface Window {
    FB?: {
      init: (opts: { appId: string; cookie?: boolean; xfbml?: boolean; version: string }) => void;
      login: (cb: (res: FbLoginResponse) => void, opts?: Record<string, unknown>) => void;
    };
    fbAsyncInit?: () => void;
  }
}

const POLL_MS = 2000;
const TIMEOUT_MS = 120_000;
const WHATSAPP_HELP_URL =
  "https://wa.me/972508318162?text=%D7%94%D7%99%D7%99%2C%20%D7%99%D7%A9%20%D7%9C%D7%99%20%D7%A9%D7%90%D7%9C%D7%94%20%D7%91%D7%A0%D7%95%D7%92%D7%A2%20%D7%9C%D7%96%D7%95%D7%90%D7%99%21";
const ONBOARDING_STUCK_HELP_URL =
  "https://wa.me/97233824981?text=%D7%A0%D7%AA%D7%A7%D7%A2%D7%AA%D7%99%20%D7%91%D7%94%D7%A8%D7%A9%D7%9E%D7%94%20-%20%D7%A0%D7%93%D7%A8%D7%A9%20%D7%A0%D7%A6%D7%99%D7%92";

const STEP_REVEAL_MS = 2200;
const EMBEDDED_SUCCESS_REDIRECT_MS = 3000;

function isTrustedMetaOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return (
      host === "facebook.com" ||
      host.endsWith(".facebook.com") ||
      host === "meta.com" ||
      host.endsWith(".meta.com")
    );
  } catch {
    return false;
  }
}

function parseWaEmbeddedSignupMessage(raw: unknown): WaEmbeddedSignupMessage | null {
  if (!raw) return null;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const msg = parsed as WaEmbeddedSignupMessage;
  if (msg.type !== "WA_EMBEDDED_SIGNUP") return null;
  return msg;
}

export default function OnboardingSuccessClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = (searchParams.get("email") || "").trim().toLowerCase();
  const lang: Lang = searchParams.get("lang") === "en" ? "en" : "he";
  const t = i18n[lang];
  const textAlign = lang === "en" ? "left" : "right";

  const [ready, setReady] = useState<null | { slug: string }>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [revealedStepCount, setRevealedStepCount] = useState(0);
  const embeddedRedirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [fbSdkReady, setFbSdkReady] = useState(false);
  const [fbAppId, setFbAppId] = useState("");
  const [fbConfigId, setFbConfigId] = useState("");
  const [embeddedState, setEmbeddedState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [embeddedErr, setEmbeddedErr] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<null | "coexistence" | "new_provisioned" | "manual">(null);
  const [pathSaving, setPathSaving] = useState(false);
  const [pathErr, setPathErr] = useState<string | null>(null);
  const [coexAck, setCoexAck] = useState(false);

  const embeddedInFlightRef = useRef(false);
  const embeddedHandledWabaRef = useRef<string | null>(null);
  const readySlugRef = useRef<string | null>(null);
  const emailRef = useRef(email);

  useEffect(() => {
    readySlugRef.current = ready?.slug ?? null;
  }, [ready?.slug]);

  useEffect(() => {
    emailRef.current = email;
  }, [email]);

  const redirectToAnalytics = useCallback(
    (slug: string) => {
      const nextUrl = `/${slug}/analytics?welcome=1`;
      const fallbackToLogin = () =>
        router.replace(
          `/dashboard/login?next=${encodeURIComponent(nextUrl)}&msg=${encodeURIComponent(t.loginRedirectMsg)}`
        );

      try {
        const ssEmail = String(sessionStorage.getItem("hz_onb_email") || "").trim().toLowerCase();
        const ssPw = String(sessionStorage.getItem("hz_onb_password") || "");

        let lsEmail = "";
        let lsPw = "";
        let lsTs = 0;
        try {
          const raw = localStorage.getItem("hz_onb_creds");
          if (raw) {
            const parsed = JSON.parse(raw) as { email?: string; password?: string; ts?: number };
            lsEmail = String(parsed?.email || "").trim().toLowerCase();
            lsPw = String(parsed?.password || "");
            lsTs = Number(parsed?.ts || 0);
          }
        } catch {
          // ignore
        }

        const storedEmail = ssEmail || lsEmail;
        const storedPw = ssPw || lsPw;
        const isFresh = !lsTs || Date.now() - lsTs < 60 * 60 * 1000;

        if (storedEmail && storedPw && storedEmail === email && isFresh) {
          const supabase = createSupabaseBrowserClient();
          void supabase.auth.signInWithPassword({ email: storedEmail, password: storedPw }).then(({ error }) => {
            if (error) {
              fallbackToLogin();
              return;
            }
            try {
              sessionStorage.removeItem("hz_onb_email");
              sessionStorage.removeItem("hz_onb_password");
            } catch {
              /* ignore */
            }
            try {
              localStorage.removeItem("hz_onb_creds");
            } catch {
              /* ignore */
            }
            router.replace(nextUrl);
          });
          return;
        }
      } catch {
        // ignore
      }

      router.replace(nextUrl);
    },
    [router, t.loginRedirectMsg, email]
  );

  const handleEmbeddedFinish = useCallback(
    async (waba_id: string, phone_number_id?: string, code?: string) => {
      const slug = readySlugRef.current;
      const proofEmail = emailRef.current;
      if (!slug || !proofEmail) return;

      const normalizedWaba = String(waba_id ?? "")
        .trim()
        .replace(/\s+/g, "");
      if (!normalizedWaba) return;

      if (embeddedInFlightRef.current) return;
      if (embeddedHandledWabaRef.current === normalizedWaba) return;

      embeddedInFlightRef.current = true;
      setEmbeddedErr(null);
      setEmbeddedState("loading");

      try {
        const body: Record<string, string> = {
          waba_id: normalizedWaba,
          businessSlug: slug,
          email: proofEmail,
        };
        const phoneId = String(phone_number_id ?? "")
          .trim()
          .replace(/\s+/g, "");
        if (phoneId) body.phone_number_id = phoneId;
        const oauthCode = String(code ?? "").trim();
        if (oauthCode) body.code = oauthCode;

        const r = await fetch("/api/onboarding/embedded-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
        if (!r.ok || !j.success) {
          setEmbeddedState("error");
          setEmbeddedErr(j.error?.trim() || t.error_server(r.status));
          return;
        }
        embeddedHandledWabaRef.current = normalizedWaba;
        setEmbeddedState("success");
        setEmbeddedErr(null);
      } catch {
        setEmbeddedState("error");
        setEmbeddedErr(t.error_network);
      } finally {
        embeddedInFlightRef.current = false;
      }
    },
    [t]
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isTrustedMetaOrigin(event.origin)) return;

      const msg = parseWaEmbeddedSignupMessage(event.data);
      if (!msg) return;

      const eventName = String(msg.event ?? "").trim();
      const data = msg.data ?? {};

      if (
        eventName === "FINISH" ||
        eventName === "FINISH_ONLY_WABA" ||
        eventName === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
      ) {
        const waba_id = String(data.waba_id ?? "")
          .trim()
          .replace(/\s+/g, "");
        const phone_number_id = String(data.phone_number_id ?? "")
          .trim()
          .replace(/\s+/g, "");
        if (!waba_id) return;
        void handleEmbeddedFinish(waba_id, phone_number_id || undefined);
        return;
      }

      if (eventName === "CANCEL") {
        embeddedInFlightRef.current = false;
        setEmbeddedState("error");
        setEmbeddedErr(t.error_cancelled);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [handleEmbeddedFinish, t.error_cancelled]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cfgR = await fetch("/api/onboarding/facebook-config", { cache: "no-store" });
        const cfg = (await cfgR.json()) as { appId?: string; configId?: string };
        if (cancelled) return;
        const appId = String(cfg.appId ?? "").trim();
        setFbAppId(appId);
        setFbConfigId(String(cfg.configId ?? "").trim());
        if (!appId) return;

        window.fbAsyncInit = () => {
          if (cancelled) return;
          window.FB?.init({
            appId,
            cookie: true,
            xfbml: true,
            version: "v21.0",
          });
          setFbSdkReady(true);
        };

        if (document.getElementById("facebook-jssdk")) {
          if (window.FB) {
            window.fbAsyncInit?.();
          }
          return;
        }
        const s = document.createElement("script");
        s.id = "facebook-jssdk";
        s.async = true;
        s.crossOrigin = "anonymous";
        s.src = "https://connect.facebook.net/en_US/sdk.js";
        document.body.appendChild(s);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const choosePath = useCallback(
    (path: "coexistence" | "new_provisioned" | "manual") => {
      if (!ready?.slug || !email) return;
      const slug = ready.slug;
      setPathErr(null);
      setPathSaving(true);
      void (async () => {
        try {
          const r = await fetch("/api/onboarding/set-onboarding-type", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ businessSlug: slug, email, onboarding_type: path }),
          });
          const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
          if (!r.ok || !j.success) {
            setPathErr(j.error?.trim() || t.pathSaveError);
            return;
          }
          setSelectedPath(path);
        } catch {
          setPathErr(t.pathSaveError);
        } finally {
          setPathSaving(false);
        }
      })();
    },
    [ready?.slug, email, t.pathSaveError]
  );

  const connectEmbeddedWhatsApp = useCallback((featureType: string = "") => {
    if (!ready?.slug || !email) return;
    if (!window.FB?.login) {
      setEmbeddedState("error");
      setEmbeddedErr(t.error_fb_load);
      return;
    }
    setEmbeddedErr(null);
    setEmbeddedState("loading");
    embeddedHandledWabaRef.current = null;

    const loginOpts: Record<string, unknown> = {
      scope: "whatsapp_business_management",
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {}, featureType, sessionInfoVersion: "3" },
    };
    if (fbConfigId) {
      loginOpts.config_id = fbConfigId;
    }

    window.FB.login(
      (resp: FbLoginResponse & { code?: string; waba_id?: string }) => {
        if (resp.status === "unknown") {
          setEmbeddedState("idle");
          setEmbeddedErr(null);
          return;
        }

        const ar = resp.authResponse;
        const code = String(ar?.code ?? (resp as { code?: string }).code ?? "").trim();
        const waba_id = String(
          ar?.waba_id ?? ar?.wabaId ?? (resp as { waba_id?: string }).waba_id ?? ""
        )
          .trim()
          .replace(/\s+/g, "");

        if (!waba_id) {
          // postMessage (WA_EMBEDDED_SIGNUP) may still deliver waba_id.
          return;
        }

        void handleEmbeddedFinish(waba_id, undefined, code || undefined);
      },
      loginOpts
    );
  }, [ready?.slug, email, fbConfigId, handleEmbeddedFinish, t.error_fb_load]);

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
          // Purchase events are now recorded server-side only (single source of truth in /api/icount-ipn).
          setReady({ slug });
          console.log("[onboarding/success] payment ready, awaiting Embedded Signup");
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
    };
  }, [email]);

  useEffect(() => {
    if (embeddedState !== "success" || !ready?.slug || !embeddedHandledWabaRef.current) return;

    console.log("[onboarding/success] Embedded Signup success, redirecting in 3s");
    embeddedRedirectTimerRef.current = setTimeout(() => {
      console.log(`[onboarding/success] redirecting to ${ready.slug}/analytics`);
      redirectToAnalytics(ready.slug);
    }, EMBEDDED_SUCCESS_REDIRECT_MS);

    return () => {
      if (embeddedRedirectTimerRef.current) clearTimeout(embeddedRedirectTimerRef.current);
    };
  }, [embeddedState, ready?.slug, redirectToAnalytics]);

  const prepSteps = useMemo(() => t.prepSteps, [t.prepSteps]);

  useEffect(() => {
    if (!email || ready || timedOut) return;
    let n = 0;
    const bump = () => {
      if (n >= prepSteps.length) return;
      n += 1;
      setRevealedStepCount(n);
    };
    bump();
    const id = window.setInterval(bump, STEP_REVEAL_MS);
    return () => window.clearInterval(id);
  }, [email, ready, timedOut, prepSteps.length]);

  return (
    <main
      dir={lang === "en" ? "ltr" : "rtl"}
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
          <div style={{ color: "#6b5b9a", fontSize: "14px", lineHeight: 1.7 }}>{t.missingEmail}</div>
        ) : timedOut ? (
          <div style={{ color: "#6b5b9a", fontSize: "14px", lineHeight: 1.7 }}>
            {t.timedOut}
            <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
              <a
                href={WHATSAPP_HELP_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t.whatsappHelpAria}
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
                textAlign,
                marginBottom: "18px",
                padding: "14px 16px",
                borderRadius: "16px",
                background: "rgba(245,243,255,0.9)",
                border: "1px solid rgba(113,51,218,0.1)",
              }}
            >
              {prepSteps.map((line, i) => (
                <div
                  key={line}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "10px",
                    marginBottom: i === prepSteps.length - 1 ? 0 : "10px",
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
                <span>{t.doneLabel}</span>
              </div>
            </div>

            {!selectedPath ? (
              <div
                style={{
                  marginTop: 18,
                  padding: "16px 16px",
                  borderRadius: "16px",
                  background: "rgba(255,255,255,0.95)",
                  border: "1px solid rgba(113,51,218,0.15)",
                  textAlign,
                }}
              >
                <p style={{ margin: "0 0 6px", fontSize: "15px", fontWeight: 700, color: "#2d1a6e" }}>
                  {t.choiceTitle}
                </p>
                <p style={{ margin: "0 0 14px", fontSize: "13px", lineHeight: 1.55, color: "#6b5b9a" }}>
                  {t.choiceSubtitle}
                </p>

                <button
                  type="button"
                  disabled={pathSaving}
                  onClick={() => choosePath("coexistence")}
                  style={{
                    display: "block",
                    width: "100%",
                    marginBottom: 10,
                    padding: "12px 14px",
                    borderRadius: "14px",
                    border: "1px solid rgba(113,51,218,0.25)",
                    background: "rgba(255,255,255,0.95)",
                    cursor: pathSaving ? "wait" : "pointer",
                    textAlign,
                    fontFamily: "inherit",
                  }}
                >
                  <span style={{ display: "block", fontSize: "14px", fontWeight: 700, color: "#2d1a6e" }}>
                    {t.optCoexistenceTitle}
                  </span>
                  <span style={{ display: "block", margin: "6px 0 0", fontSize: "12px", lineHeight: 1.5, color: "#6b5b9a" }}>
                    {t.optCoexistenceDesc}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={pathSaving}
                  onClick={() => choosePath("new_provisioned")}
                  style={{
                    display: "block",
                    width: "100%",
                    marginBottom: 10,
                    padding: "12px 14px",
                    borderRadius: "14px",
                    border: "1px solid rgba(113,51,218,0.25)",
                    background: "rgba(255,255,255,0.95)",
                    cursor: pathSaving ? "wait" : "pointer",
                    textAlign,
                    fontFamily: "inherit",
                  }}
                >
                  <span style={{ display: "block", fontSize: "14px", fontWeight: 700, color: "#2d1a6e" }}>
                    {t.optNewTitle}
                  </span>
                  <span style={{ display: "block", margin: "6px 0 0", fontSize: "12px", lineHeight: 1.5, color: "#6b5b9a" }}>
                    {t.optNewDesc}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={pathSaving}
                  onClick={() => choosePath("manual")}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: "14px",
                    border: "1px solid rgba(113,51,218,0.25)",
                    background: "rgba(255,255,255,0.95)",
                    cursor: pathSaving ? "wait" : "pointer",
                    textAlign,
                    fontFamily: "inherit",
                  }}
                >
                  <span style={{ display: "block", fontSize: "14px", fontWeight: 700, color: "#2d1a6e" }}>
                    {t.optManualTitle}
                  </span>
                  <span style={{ display: "block", margin: "6px 0 0", fontSize: "12px", lineHeight: 1.5, color: "#6b5b9a" }}>
                    {t.optManualDesc}
                  </span>
                </button>

                {pathErr ? (
                  <p style={{ margin: "12px 0 0", fontSize: "13px", color: "#b42318" }} role="alert">
                    {pathErr}
                  </p>
                ) : null}
              </div>
            ) : selectedPath === "new_provisioned" ? (
              <>
                <div
                  style={{
                    marginTop: 18,
                    padding: "16px 16px",
                    borderRadius: "16px",
                    background: "rgba(255,255,255,0.95)",
                    border: "1px solid rgba(113,51,218,0.15)",
                    textAlign,
                  }}
                >
                  <p style={{ margin: "0 0 10px", fontSize: "15px", fontWeight: 700, color: "#2d1a6e" }}>
                    {t.title}
                  </p>
                  <p style={{ margin: "0 0 14px", fontSize: "13px", lineHeight: 1.55, color: "#6b5b9a" }}>
                    {t.connectDescription}
                  </p>
                  {!fbAppId ? (
                    <p style={{ margin: 0, fontSize: "12px", color: "#b42318", lineHeight: 1.5 }}>{t.missingAppId}</p>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={!fbSdkReady || embeddedState === "loading" || embeddedState === "success"}
                        onClick={() => connectEmbeddedWhatsApp()}
                        style={{
                          width: "100%",
                          maxWidth: "100%",
                          borderRadius: 999,
                          border: "1px solid rgba(113,51,218,0.25)",
                          background:
                            !fbSdkReady || embeddedState === "loading"
                              ? "rgba(113,51,218,0.35)"
                              : "linear-gradient(135deg,#7133da,#ff92ff)",
                          color: "#fff",
                          padding: "12px 18px",
                          fontFamily: "inherit",
                          fontSize: "15px",
                          fontWeight: 700,
                          cursor: !fbSdkReady || embeddedState === "loading" ? "wait" : "pointer",
                        }}
                      >
                        {embeddedState === "loading" ? t.connecting : t.connect}
                      </button>
                      {embeddedState === "success" ? (
                        <p style={{ margin: "12px 0 0", fontSize: "13px", color: "#0b5c2e", fontWeight: 600 }}>
                          {t.successRedirecting}
                        </p>
                      ) : null}
                      {embeddedState === "error" && embeddedErr ? (
                        <p style={{ margin: "12px 0 0", fontSize: "13px", color: "#b42318" }} role="alert">
                          {embeddedErr}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPath(null)}
                  style={{
                    marginTop: 12,
                    background: "none",
                    border: "none",
                    color: "#7133da",
                    fontSize: "13px",
                    fontFamily: "inherit",
                    fontWeight: 600,
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  {t.changeChoice}
                </button>
              </>
            ) : selectedPath === "coexistence" ? (
              <>
                {!coexAck ? (
                  <div
                    style={{
                      marginTop: 18,
                      padding: "16px 16px",
                      borderRadius: "16px",
                      background: "rgba(255,255,255,0.95)",
                      border: "1px solid rgba(113,51,218,0.15)",
                      textAlign,
                    }}
                  >
                    <p style={{ margin: "0 0 12px", fontSize: "15px", fontWeight: 700, color: "#2d1a6e" }}>
                      {t.coexPreflightTitle}
                    </p>
                    {[t.coexReqAppOnly, t.coexReqVersion, t.coexReqKeepOpen, t.coexReq14Days].map((line) => (
                      <div
                        key={line}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "10px",
                          marginBottom: "10px",
                          fontSize: "13px",
                          lineHeight: 1.5,
                          color: "#6b5b9a",
                        }}
                      >
                        <span style={{ flexShrink: 0, color: "#7133da", fontWeight: 800 }} aria-hidden>
                          •
                        </span>
                        <span>{line}</span>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setCoexAck(true)}
                      style={{
                        width: "100%",
                        marginTop: 8,
                        borderRadius: 999,
                        border: "1px solid rgba(113,51,218,0.25)",
                        background: "linear-gradient(135deg,#7133da,#ff92ff)",
                        color: "#fff",
                        padding: "12px 18px",
                        fontFamily: "inherit",
                        fontSize: "15px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {t.coexAckButton}
                    </button>
                  </div>
                ) : (
                  <div
                    style={{
                      marginTop: 18,
                      padding: "16px 16px",
                      borderRadius: "16px",
                      background: "rgba(255,255,255,0.95)",
                      border: "1px solid rgba(113,51,218,0.15)",
                      textAlign,
                    }}
                  >
                    <p style={{ margin: "0 0 10px", fontSize: "15px", fontWeight: 700, color: "#2d1a6e" }}>
                      {t.optCoexistenceTitle}
                    </p>
                    <p style={{ margin: "0 0 14px", fontSize: "13px", lineHeight: 1.55, color: "#6b5b9a" }}>
                      {t.connectDescription}
                    </p>
                    {!fbAppId ? (
                      <p style={{ margin: 0, fontSize: "12px", color: "#b42318", lineHeight: 1.5 }}>{t.missingAppId}</p>
                    ) : (
                      <>
                        <p
                          style={{
                            margin: "0 0 12px",
                            fontSize: "12px",
                            lineHeight: 1.55,
                            color: "#6b5b9a",
                            textAlign,
                          }}
                        >
                          {t.coexConnectHint}
                        </p>
                        <button
                          type="button"
                          disabled={!fbSdkReady || embeddedState === "loading" || embeddedState === "success"}
                          onClick={() => connectEmbeddedWhatsApp("whatsapp_business_app_onboarding")}
                          style={{
                            width: "100%",
                            maxWidth: "100%",
                            borderRadius: 999,
                            border: "1px solid rgba(113,51,218,0.25)",
                            background:
                              !fbSdkReady || embeddedState === "loading"
                                ? "rgba(113,51,218,0.35)"
                                : "linear-gradient(135deg,#7133da,#ff92ff)",
                            color: "#fff",
                            padding: "12px 18px",
                            fontFamily: "inherit",
                            fontSize: "15px",
                            fontWeight: 700,
                            cursor: !fbSdkReady || embeddedState === "loading" ? "wait" : "pointer",
                          }}
                        >
                          {embeddedState === "loading" ? t.connecting : t.coexConnect}
                        </button>
                        {embeddedState === "success" ? (
                          <p style={{ margin: "12px 0 0", fontSize: "13px", color: "#0b5c2e", fontWeight: 600 }}>
                            {t.successRedirecting}
                          </p>
                        ) : null}
                        {embeddedState === "error" && embeddedErr ? (
                          <p style={{ margin: "12px 0 0", fontSize: "13px", color: "#b42318" }} role="alert">
                            {embeddedErr}
                          </p>
                        ) : null}
                      </>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPath(null);
                    setCoexAck(false);
                  }}
                  style={{
                    marginTop: 12,
                    background: "none",
                    border: "none",
                    color: "#7133da",
                    fontSize: "13px",
                    fontFamily: "inherit",
                    fontWeight: 600,
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  {t.changeChoice}
                </button>
              </>
            ) : (
              <>
                <div
                  style={{
                    marginTop: 18,
                    padding: "16px 16px",
                    borderRadius: "16px",
                    background: "rgba(255,255,255,0.95)",
                    border: "1px solid rgba(113,51,218,0.15)",
                    textAlign,
                  }}
                >
                  <p style={{ margin: "0 0 10px", fontSize: "15px", fontWeight: 700, color: "#2d1a6e" }}>
                    {t.optManualTitle}
                  </p>
                  <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.55, color: "#6b5b9a" }}>
                    {t.manualInstructions}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPath(null)}
                  style={{
                    marginTop: 12,
                    background: "none",
                    border: "none",
                    color: "#7133da",
                    fontSize: "13px",
                    fontFamily: "inherit",
                    fontWeight: 600,
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  {t.changeChoice}
                </button>
              </>
            )}

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
              {t.preparing}
            </h1>
            <p style={{ margin: "0 0 18px", color: "#6b5b9a", fontSize: "15px", lineHeight: 1.6 }}>
              {t.preparingHint}
            </p>
            <div
              style={{
                textAlign,
                marginBottom: "20px",
                padding: "14px 16px",
                borderRadius: "16px",
                background: "rgba(245,243,255,0.75)",
                border: "1px solid rgba(113,51,218,0.1)",
              }}
            >
              {prepSteps.map((line, i) => {
                const done = i < revealedStepCount;
                return (
                  <div
                    key={line}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "10px",
                      marginBottom: i === prepSteps.length - 1 ? 0 : "10px",
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
                <span>{t.doneLabel}</span>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "8px" }} aria-hidden>
              <span className="success-bounce-dot" />
              <span className="success-bounce-dot" />
              <span className="success-bounce-dot" />
            </div>
          </>
        )}

        <p style={{ margin: "20px 0 0", paddingTop: "16px", borderTop: "1px solid rgba(113,51,218,0.08)" }}>
          <a
            href={ONBOARDING_STUCK_HELP_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: "12px",
              lineHeight: 1.5,
              color: "#8b7cb8",
              textDecoration: "underline",
              textUnderlineOffset: "2px",
            }}
          >
            {t.coexStuckHelp}
          </a>
        </p>
      </div>
    </main>
  );
}
