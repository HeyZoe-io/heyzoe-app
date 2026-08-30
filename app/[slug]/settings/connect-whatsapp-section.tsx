"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DashboardLang } from "@/lib/dashboard-lang";
import { dashboardWhatsAppChannelSwrKey } from "@/lib/dashboard-whatsapp-channel-swr";

/**
 * Same endpoint + SWR key as WhatsAppNumberSection in
 * app/dashboard/[slug]/settings/page.tsx — the global SWRConfig (app/Providers.tsx)
 * dedupes requests by key, so mounting this alongside that component does not
 * add a second network fetch; it shares the one already in flight/cached there.
 */
type WhatsAppChannel = {
  phone_display: string;
  provisioning_status: "pending" | "active" | "failed" | null;
  is_active: boolean;
} | null;

type WhatsAppChannelResponse = {
  channel: WhatsAppChannel;
  zoe_activated?: boolean;
};

function channelFetcher(key: string): Promise<WhatsAppChannelResponse> {
  return fetch(key, { method: "GET" }).then(async (res) => {
    const j = (await res.json().catch(() => ({}))) as WhatsAppChannelResponse & { error?: string };
    if (!res.ok) throw new Error(j.error || `request_failed (${res.status})`);
    return { channel: j.channel ?? null, zoe_activated: Boolean(j.zoe_activated) };
  });
}

/** Meta JS SDK (Embedded Signup) — minimal surface, duplicated from
 * app/onboarding/success/client.tsx intentionally (that file must not change). */
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

declare global {
  interface Window {
    FB?: {
      init: (opts: { appId: string; cookie?: boolean; xfbml?: boolean; version: string }) => void;
      login: (cb: (res: FbLoginResponse) => void, opts?: Record<string, unknown>) => void;
    };
    fbAsyncInit?: () => void;
  }
}

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

type FacebookConfig = { appId?: string; configId?: string };

type ConnectState = "idle" | "awaiting_login" | "submitting" | "success" | "error";

const i18n = {
  he: {
    connectToMeta: "חיבור למטא",
    connecting: "מתחברים…",
    successTitle: "התחברתם למטא בהצלחה",
    webhookWarning:
      "החיבור למספר הצליח, אך רישום ה-Webhook מול מטא לא הושלם. הודעות עשויות שלא להתקבל עד שזה ייפתר.",
    missingAppId: "חסר מזהה אפליקציית מטא בשרת — לא ניתן להציג את חלון ההתחברות.",
    error_cancelled: "החיבור בוטל.",
    error_fb_load: "טעינת פייסבוק נכשלה. נסו שוב.",
    error_popup:
      "חלון פייסבוק לא נפתח. אפשרו פופאפ לדפדפן, או פתחו את הדשבורד בכרטיסייה רגילה (לא מתוך וואטסאפ/אינסטגרם) ונסו שוב.",
    sdkNotReady: "טוענים את פייסבוק… נסו שוב בעוד רגע.",
    error_server: (status: number) => `שגיאת שרת (${status})`,
    error_network: "בעיית רשת בשמירה.",
  },
  en: {
    connectToMeta: "Connect to Meta",
    connecting: "Connecting…",
    successTitle: "Connected to Meta",
    webhookWarning:
      "The number connected successfully, but webhook registration with Meta did not complete. Messages may not be received until this is resolved.",
    missingAppId: "Meta app ID missing on the server — the login dialog cannot be shown.",
    error_cancelled: "Connection cancelled.",
    error_fb_load: "Failed to load Facebook. Try again.",
    error_popup:
      "The Facebook window did not open. Allow pop-ups, or open the dashboard in a regular browser tab (not in-app WhatsApp/Instagram) and try again.",
    sdkNotReady: "Loading Facebook… try again in a moment.",
    error_server: (status: number) => `Server error (${status})`,
    error_network: "Network error while saving.",
  },
} as const;

type ConnectWhatsAppSectionProps = {
  slug: string;
  lang?: DashboardLang;
  compact?: boolean;
  /** Meta Embedded Signup `featureType` extra — defaults to the "connect an existing number" flow. */
  featureType?: string;
};

export default function ConnectWhatsAppSection({
  slug,
  lang = "he",
  compact = false,
  featureType = "whatsapp_business_app_onboarding",
}: ConnectWhatsAppSectionProps) {
  const t = i18n[lang];

  const channelKey = dashboardWhatsAppChannelSwrKey(slug);
  const { mutate: mutateChannel } = useSWR(
    channelKey,
    channelFetcher,
    { revalidateOnFocus: false, keepPreviousData: true }
  );

  const [state, setState] = useState<ConnectState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [webhookSubscribed, setWebhookSubscribed] = useState(false);
  const [webhookError, setWebhookError] = useState<string | null>(null);

  const fbAppIdRef = useRef<string>("");
  const fbConfigIdRef = useRef<string>("");
  const inFlightRef = useRef(false);
  const handledWabaRef = useRef<string | null>(null);
  const featureTypeRef = useRef(featureType);
  featureTypeRef.current = featureType;

  const submitEmbeddedFinish = useCallback(
    async (waba_id: string, phone_number_id?: string, code?: string) => {
      if (inFlightRef.current) return;
      if (handledWabaRef.current === waba_id) return;

      inFlightRef.current = true;
      setErrorMsg(null);
      setState("submitting");

      try {
        const body: Record<string, string> = {
          waba_id,
          businessSlug: slug,
          onboarding_type: "coexistence",
        };
        if (phone_number_id) body.phone_number_id = phone_number_id;
        if (code) body.code = code;

        const r = await fetch("/api/onboarding/embedded-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = (await r.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
          webhook?: { subscribed?: boolean; error?: string };
        };
        if (!r.ok || !j.success) {
          setState("error");
          setErrorMsg(j.error?.trim() || t.error_server(r.status));
          return;
        }

        handledWabaRef.current = waba_id;
        setWebhookSubscribed(Boolean(j.webhook?.subscribed));
        setWebhookError(j.webhook?.subscribed ? null : j.webhook?.error?.trim() || null);
        setState("success");
        void mutateChannel();
      } catch {
        setState("error");
        setErrorMsg(t.error_network);
      } finally {
        inFlightRef.current = false;
      }
    },
    [slug, t, mutateChannel]
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
        const waba_id = String(data.waba_id ?? "").trim().replace(/\s+/g, "");
        const phone_number_id = String(data.phone_number_id ?? "").trim().replace(/\s+/g, "");
        if (!waba_id) return;
        void submitEmbeddedFinish(waba_id, phone_number_id || undefined);
        return;
      }

      if (eventName === "CANCEL") {
        setState("error");
        setErrorMsg(t.error_cancelled);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [submitEmbeddedFinish, t.error_cancelled]);

  // Preload FB SDK on mount so FB.login stays inside the click gesture (popups).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cfgRes = await fetch("/api/onboarding/facebook-config", { cache: "no-store" });
        const cfg = (await cfgRes.json()) as FacebookConfig;
        if (cancelled) return;
        const appId = String(cfg.appId ?? "").trim();
        if (!appId) {
          setErrorMsg(t.missingAppId);
          return;
        }
        fbAppIdRef.current = appId;
        fbConfigIdRef.current = String(cfg.configId ?? "").trim();

        window.fbAsyncInit = () => {
          if (cancelled) return;
          try {
            window.FB?.init({ appId, cookie: true, xfbml: true, version: "v21.0" });
            setSdkReady(true);
          } catch {
            setState("error");
            setErrorMsg(t.error_fb_load);
          }
        };

        if (document.getElementById("facebook-jssdk")) {
          if (window.FB) {
            window.fbAsyncInit();
            return;
          }
          const poll = window.setInterval(() => {
            if (cancelled) {
              window.clearInterval(poll);
              return;
            }
            if (window.FB) {
              window.clearInterval(poll);
              window.fbAsyncInit?.();
            }
          }, 200);
          return;
        }
        const s = document.createElement("script");
        s.id = "facebook-jssdk";
        s.async = true;
        s.crossOrigin = "anonymous";
        s.src = "https://connect.facebook.net/en_US/sdk.js";
        s.onerror = () => {
          if (!cancelled) {
            setState("error");
            setErrorMsg(t.error_fb_load);
          }
        };
        document.body.appendChild(s);
      } catch {
        if (!cancelled) {
          setState("error");
          setErrorMsg(t.error_fb_load);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t.error_fb_load, t.missingAppId]);

  const launchLogin = useCallback(() => {
    if (!window.FB?.login) {
      setState("error");
      setErrorMsg(sdkReady ? t.error_fb_load : t.sdkNotReady);
      return;
    }
    setState("awaiting_login");

    const loginOpts: Record<string, unknown> = {
      scope: "whatsapp_business_management",
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {}, featureType: featureTypeRef.current, sessionInfoVersion: "3" },
    };
    if (fbConfigIdRef.current) loginOpts.config_id = fbConfigIdRef.current;

    window.FB.login((resp: FbLoginResponse & { code?: string; waba_id?: string }) => {
      if (resp.status === "unknown") {
        setState("error");
        setErrorMsg(t.error_popup);
        return;
      }
      const ar = resp.authResponse;
      const code = String(ar?.code ?? resp.code ?? "").trim();
      const waba_id = String(ar?.waba_id ?? ar?.wabaId ?? resp.waba_id ?? "")
        .trim()
        .replace(/\s+/g, "");
      if (!waba_id) return; // postMessage (WA_EMBEDDED_SIGNUP) may still deliver it
      void submitEmbeddedFinish(waba_id, undefined, code || undefined);
    }, loginOpts);
  }, [sdkReady, submitEmbeddedFinish, t.error_fb_load, t.error_popup, t.sdkNotReady]);

  const handleConnectClick = useCallback(() => {
    handledWabaRef.current = null;
    setErrorMsg(null);
    setWebhookSubscribed(false);
    setWebhookError(null);
    launchLogin();
  }, [launchLogin]);

  const busy = state === "awaiting_login" || state === "submitting";
  const feedback =
    state === "success"
      ? webhookSubscribed
        ? t.successTitle
        : `${t.webhookWarning}${webhookError ? ` (${webhookError})` : ""}`
      : state === "error" && errorMsg
        ? errorMsg
        : null;
  const feedbackTone =
    state === "success" ? (webhookSubscribed ? "success" : "warn") : state === "error" ? "error" : null;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        className={compact ? "h-7 px-3 text-xs" : "h-8 px-3.5 text-xs"}
        disabled={busy}
        onClick={handleConnectClick}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
        {busy ? t.connecting : t.connectToMeta}
      </Button>
      {feedback ? (
        <p
          className={`max-w-[16rem] text-end text-[11px] leading-4 ${
            feedbackTone === "success"
              ? "text-emerald-700"
              : feedbackTone === "warn"
                ? "text-amber-800"
                : "text-rose-700"
          }`}
          role={feedbackTone === "error" || feedbackTone === "warn" ? "alert" : "status"}
        >
          {feedback}
        </p>
      ) : null}
    </div>
  );
}
