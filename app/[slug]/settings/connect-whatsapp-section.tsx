"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { DashboardLang } from "@/lib/dashboard-lang";
import { dashboardDir } from "@/lib/dashboard-lang";

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

/** Loads the FB JS SDK + calls FB.init, only once, resolving when window.FB is ready. */
function ensureFbSdkLoaded(appId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.FB) {
      resolve();
      return;
    }
    window.fbAsyncInit = () => {
      try {
        window.FB?.init({ appId, cookie: true, xfbml: true, version: "v21.0" });
        resolve();
      } catch (e) {
        reject(e instanceof Error ? e : new Error("fb_init_failed"));
      }
    };
    if (document.getElementById("facebook-jssdk")) {
      // Script tag already present from an earlier attempt in this session;
      // fbAsyncInit above will fire once it (or a prior load) completes.
      return;
    }
    const s = document.createElement("script");
    s.id = "facebook-jssdk";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.onerror = () => reject(new Error("sdk_load_failed"));
    document.body.appendChild(s);
  });
}

type ConnectState = "idle" | "loading_sdk" | "awaiting_login" | "submitting" | "success" | "error";

const i18n = {
  he: {
    title: "חיבור מספר WhatsApp",
    description:
      "מחברים את חשבון ה־WhatsApp Business שלכם ל־HeyZoe דרך פייסבוק — אפשר לחבר מספר קיים.",
    connect: "חברו מספר WhatsApp",
    connecting: "מתחברים…",
    connectedTitle: "המספר מחובר",
    successTitle: "התחברתם בהצלחה!",
    webhookWarningTitle: "שימו לב — חסר רישום Webhook",
    webhookWarning:
      "החיבור למספר הצליח, אך רישום ה-Webhook מול מטא לא הושלם. הודעות עשויות שלא להתקבל עד שזה ייפתר.",
    missingAppId: "חסר מזהה אפליקציית מטא בשרת — לא ניתן להציג את חלון ההתחברות.",
    error_no_waba: "לא התקבל מזהה WABA מהתחברות פייסבוק. נסו שוב או בדקו את הגדרות אפליקציית מטא.",
    error_cancelled: "החיבור בוטל.",
    error_fb_load: "טעינת פייסבוק נכשלה. נסו שוב.",
    error_server: (status: number) => `שגיאת שרת (${status})`,
    error_network: "בעיית רשת בשמירה.",
    statusLoadFailed: "טעינת סטטוס החיבור נכשלה.",
  },
  en: {
    title: "Connect a WhatsApp number",
    description:
      "Connect your WhatsApp Business account to HeyZoe via Facebook — you can connect an existing number.",
    connect: "Connect WhatsApp number",
    connecting: "Connecting…",
    connectedTitle: "Number connected",
    successTitle: "Connected successfully!",
    webhookWarningTitle: "Attention — webhook registration missing",
    webhookWarning:
      "The number connected successfully, but webhook registration with Meta did not complete. Messages may not be received until this is resolved.",
    missingAppId: "Meta app ID missing on the server — the login dialog cannot be shown.",
    error_no_waba: "WABA ID not received from Facebook login. Try again or check your Meta app settings.",
    error_cancelled: "Connection cancelled.",
    error_fb_load: "Failed to load Facebook. Try again.",
    error_server: (status: number) => `Server error (${status})`,
    error_network: "Network error while saving.",
    statusLoadFailed: "Failed to load connection status.",
  },
} as const;

type ConnectWhatsAppSectionProps = {
  slug: string;
  lang?: DashboardLang;
  /** Meta Embedded Signup `featureType` extra — defaults to the "connect an existing number" flow. */
  featureType?: string;
};

export default function ConnectWhatsAppSection({
  slug,
  lang = "he",
  featureType = "whatsapp_business_app_onboarding",
}: ConnectWhatsAppSectionProps) {
  const t = i18n[lang];
  const dir = dashboardDir(lang);
  const textAlign = lang === "en" ? "left" : "right";

  const channelKey = `/api/dashboard/whatsapp-channel?slug=${encodeURIComponent(slug)}`;
  const { data: channelData, isLoading: channelLoading, mutate: mutateChannel } = useSWR(
    channelKey,
    channelFetcher,
    { revalidateOnFocus: false, keepPreviousData: true }
  );

  const [state, setState] = useState<ConnectState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
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
        const body: Record<string, string> = { waba_id, businessSlug: slug };
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

  const launchLogin = useCallback(() => {
    if (!window.FB?.login) {
      setState("error");
      setErrorMsg(t.error_fb_load);
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
        setState("idle");
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
  }, [submitEmbeddedFinish, t.error_fb_load]);

  const handleConnectClick = useCallback(async () => {
    setErrorMsg(null);
    setState("loading_sdk");
    try {
      if (!fbAppIdRef.current) {
        const cfgRes = await fetch("/api/onboarding/facebook-config", { cache: "no-store" });
        const cfg = (await cfgRes.json()) as FacebookConfig;
        const appId = String(cfg.appId ?? "").trim();
        if (!appId) {
          setState("error");
          setErrorMsg(t.missingAppId);
          return;
        }
        fbAppIdRef.current = appId;
        fbConfigIdRef.current = String(cfg.configId ?? "").trim();
      }
      await ensureFbSdkLoaded(fbAppIdRef.current);
      launchLogin();
    } catch {
      setState("error");
      setErrorMsg(t.error_fb_load);
    }
  }, [launchLogin, t.error_fb_load, t.missingAppId]);

  const hasActiveChannel = channelData?.channel?.is_active === true;

  // Post-connect result (including any webhook warning) takes priority over the
  // generic "connected" badge so a successful-but-unsubscribed WABA is never hidden.
  if (state === "success") {
    return (
      <section
        dir={dir}
        style={{ textAlign }}
        className="mx-auto w-full max-w-4xl px-4 sm:px-6 mb-4"
      >
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
          <p className="text-sm font-semibold text-emerald-800">{t.successTitle}</p>
          {!webhookSubscribed ? (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">{t.webhookWarningTitle}</p>
              <p className="mt-1 text-xs text-amber-800">
                {t.webhookWarning}
                {webhookError ? ` (${webhookError})` : ""}
              </p>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  // Avoid a flash of the connect button before we know the real channel state.
  if (channelLoading && channelData === undefined) {
    return null;
  }

  if (hasActiveChannel) {
    return (
      <section
        dir={dir}
        style={{ textAlign }}
        className="mx-auto w-full max-w-4xl px-4 sm:px-6 mb-4"
      >
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3">
          <span className="text-sm font-semibold text-zinc-900">{t.connectedTitle}</span>
          {channelData?.channel?.phone_display ? (
            <span className="text-sm text-zinc-600" dir="ltr">
              {channelData.channel.phone_display}
            </span>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section dir={dir} style={{ textAlign }} className="mx-auto w-full max-w-4xl px-4 sm:px-6 mb-4">
      <div className="rounded-2xl border border-[rgba(113,51,218,0.15)] bg-white/95 p-4">
        <p className="text-sm font-semibold text-zinc-900">{t.title}</p>
        <p className="mt-1 text-xs leading-5 text-zinc-500">{t.description}</p>
        <button
          type="button"
          disabled={state === "loading_sdk" || state === "awaiting_login" || state === "submitting"}
          onClick={() => void handleConnectClick()}
          className="mt-3 w-full rounded-full border border-[rgba(113,51,218,0.25)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity disabled:cursor-wait disabled:opacity-70"
          style={{ background: "linear-gradient(135deg,#7133da,#ff92ff)" }}
        >
          {state === "loading_sdk" || state === "awaiting_login" || state === "submitting"
            ? t.connecting
            : t.connect}
        </button>
        {state === "error" && errorMsg ? (
          <p className="mt-2 text-xs text-rose-700" role="alert">
            {errorMsg}
          </p>
        ) : null}
      </div>
    </section>
  );
}
