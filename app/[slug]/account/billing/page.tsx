"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { promoVatAndMonthLine } from "@/lib/promo-month";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  CANCELLATION_SURVEY_REASONS,
  cancellationSurveyDetailLabel,
  cancellationSurveyRequiresDetail,
} from "@/lib/cancellation-survey";

function PlanCard({
  title,
  price,
  priceCompare,
  priceNote,
  bullets,
  primary,
  isCurrent,
  actionLabel,
  actionDisabled,
  onAction,
}: {
  title: string;
  price: string;
  priceCompare?: string;
  priceNote?: string;
  bullets: string[];
  primary?: boolean;
  isCurrent?: boolean;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
}) {
  return (
    <Card
      className={
        isCurrent
          ? "border-fuchsia-300 ring-2 ring-fuchsia-200"
          : primary
          ? "border-fuchsia-200"
          : ""
      }
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-right">{title}</CardTitle>
          {isCurrent ? (
            <span className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-1 text-[11px] font-medium text-fuchsia-700">
              החבילה שלך
            </span>
          ) : null}
        </div>
        <CardDescription className="text-right space-y-1">
          <div className="flex flex-wrap items-baseline justify-end gap-2">
            <span className="text-lg font-semibold text-zinc-900">{price}</span>
            {priceCompare ? (
              <span className="text-sm text-zinc-400 line-through">{priceCompare}</span>
            ) : null}
          </div>
          {priceNote ? <p className="text-[11px] text-zinc-500">{priceNote}</p> : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-right">
        <ul className="space-y-1 text-sm text-zinc-700">
          {bullets.map((b) => (
            <li key={b}>- {b}</li>
          ))}
        </ul>
        {actionLabel ? (
          <button
            type="button"
            disabled={actionDisabled}
            onClick={onAction}
            className={
              "inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:pointer-events-none disabled:opacity-50 " +
              (primary
                ? "bg-fuchsia-600 hover:bg-fuchsia-700 text-white"
                : "bg-zinc-900 text-white hover:bg-zinc-800")
            }
          >
            {actionLabel}
          </button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatHebrewDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("he-IL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function AccountBillingPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [plan, setPlan] = useState<"basic" | "premium">("basic");
  /** מנוי משולם פעיל — בלי זה לא מציגים «החבילה שלך» גם אם plan ב-DB נשאר basic/premium */
  const [subscriptionActive, setSubscriptionActive] = useState(false);
  const [cancellationEffectiveAt, setCancellationEffectiveAt] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [billingStateLoaded, setBillingStateLoaded] = useState(false);
  const [activeSlug, setActiveSlug] = useState<string>("");
  const [checkoutLoading, setCheckoutLoading] = useState<null | "starter" | "pro">(null);
  const [checkoutError, setCheckoutError] = useState<string>("");
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelSurveyReason, setCancelSurveyReason] = useState<string>("");
  const [cancelSurveyDetail, setCancelSurveyDetail] = useState<string>("");
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState<string>("");
  const sp = useSearchParams();
  const reactivate = sp.get("reactivate") === "1";
  const nextParam = sp.get("next") || "";
  const welcome = sp.get("welcome") === "1";
  const redirectingRef = useRef(false);
  const billingSlugRef = useRef<string>("");
  const initialParamsRef = useRef<null | { reactivate: boolean; nextParam: string; welcome: boolean }>(null);

  function slugFromNextParam(next: string): string {
    const raw = String(next || "").trim();
    if (!raw) return "";
    const path = raw.startsWith("http") ? (() => { try { return new URL(raw).pathname; } catch { return raw; } })() : raw;
    const s = path.startsWith("/") ? path.slice(1) : path;
    const first = s.split("/")[0] ?? "";
    return first.trim().toLowerCase();
  }

  // Keep the first set of query params stable even if we later clean the URL
  // (useSearchParams updates when history.replaceState runs).
  if (!initialParamsRef.current) {
    initialParamsRef.current = {
      reactivate,
      nextParam,
      welcome,
    };
    const fromNext = slugFromNextParam(nextParam);
    if (fromNext) billingSlugRef.current = fromNext;
  }

  const previewEndDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return formatHebrewDate(d.toISOString());
  }, []);

  function loadBillingState() {
    setBillingStateLoaded(false);
    const stableNext = initialParamsRef.current?.nextParam ?? "";
    const fromNext = slugFromNextParam(stableNext);
    const slug = billingSlugRef.current || fromNext;
    const url = slug
      ? `/api/dashboard/settings?slug=${encodeURIComponent(slug)}`
      : "/api/dashboard/settings";
    void fetch(url)
      .then((r) => r.json())
      .then((j) => {
        const p = j?.business?.plan === "premium" ? "premium" : "basic";
        setPlan(p);
        setSubscriptionActive(Boolean(j?.business?.is_active));
        const eff = j?.business?.cancellation_effective_at;
        setCancellationEffectiveAt(typeof eff === "string" && eff ? eff : null);
        const gotSlug = typeof j?.business?.slug === "string" ? String(j.business.slug).trim().toLowerCase() : "";
        if (gotSlug && !billingSlugRef.current) {
          billingSlugRef.current = gotSlug;
        }
        setActiveSlug(gotSlug || billingSlugRef.current || "");
        setBillingStateLoaded(true);
      })
      .catch(() => {
        // If auth cookies are not ready yet, we'll retry after authReady flips.
        setBillingStateLoaded(true);
      });
  }

  useEffect(() => {
    let cancelled = false;
    // Gate everything on session readiness to avoid client-side flicker.
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const has = Boolean(data.session);
      setAuthed(has);
      setAuthReady(true);
      if (has) loadBillingState();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, session) => {
      if (cancelled) return;
      const has = Boolean(session);
      setAuthed(has);
      setAuthReady(true);
      if (has) loadBillingState();
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  // If we know there is no session, redirect to login (with next back to billing).
  useEffect(() => {
    if (!authReady) return;
    if (authed) return;
    try {
      const url = new URL(window.location.href);
      const next = url.pathname + url.search;
      window.location.href = `/dashboard/login?next=${encodeURIComponent(next)}`;
    } catch {
      window.location.href = "/dashboard/login";
    }
  }, [authReady, authed]);

  // If arriving with reactivate=1 and the subscription is already active, redirect
  // immediately to `next` (billing is a transition page in this flow).
  useEffect(() => {
    const stable = initialParamsRef.current;
    if (!stable?.reactivate) return;
    if (!stable.nextParam) return;
    if (!authReady || !authed) return;
    if (!subscriptionActive) return;
    if (redirectingRef.current) return;
    redirectingRef.current = true;
    const stableNextParam = stable.nextParam;
    const stableWelcome = stable.welcome;
    const target = stableNextParam.startsWith("/") ? stableNextParam : `/${stableNextParam}`;
    window.location.href =
      target + (stableWelcome ? (target.includes("?") ? "&welcome=1" : "?welcome=1") : "");
  }, [reactivate, subscriptionActive]);

  // Reactivation flow: after successful payment, iCount IPN may not navigate the user
  // back to the dashboard. Poll readiness by email and redirect to `next` when ready.
  useEffect(() => {
    const stable = initialParamsRef.current;
    if (!stable?.reactivate) return;
    if (!stable.nextParam) return;
    if (!authReady || !authed) return;
    if (redirectingRef.current) return;

    const stableNextParam = stable.nextParam;
    const stableWelcome = stable.welcome;

    let cancelled = false;
    let timeoutId: number | null = null;
    const startedAt = Date.now();
    const POLL_MS = 2500;
    const TIMEOUT_MS = 120_000;

    async function tick(email: string) {
      if (cancelled || redirectingRef.current) return;
      if (Date.now() - startedAt > TIMEOUT_MS) return;
      try {
        // First try the explicit "ready" flag (set by the IPN).
        const res = await fetch(`/api/check-payment-ready?email=${encodeURIComponent(email)}`, {
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as { ready?: boolean; slug?: string };
        if (data?.ready) {
          redirectingRef.current = true;
          const target = stableNextParam.startsWith("/") ? stableNextParam : `/${stableNextParam}`;
          window.location.href =
            target +
            (stableWelcome ? (target.includes("?") ? "&welcome=1" : "?welcome=1") : "");
          return;
        }
      } catch {
        // network error: stay quiet, keep polling
      }

      // Also refresh local billing state, so UI updates quickly when business flips is_active.
      loadBillingState();

      timeoutId = window.setTimeout(() => tick(email), POLL_MS);
    }

    void supabase.auth.getUser().then(({ data }) => {
      const email = String(data.user?.email ?? "").trim().toLowerCase();
      if (cancelled || !email) return;
      void tick(email);
    });

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [reactivate, supabase]);

  const invoices: Array<{ month: string; amount: string; status: string; href: string }> = [];
  const promoPriceNote = useMemo(() => promoVatAndMonthLine(), []);

  async function confirmCancelSubscription() {
    setCancelError("");
    if (!cancelSurveyReason.trim()) {
      setCancelError("נא לבחור סיבה לביטול.");
      return;
    }
    if (cancellationSurveyRequiresDetail(cancelSurveyReason) && !cancelSurveyDetail.trim()) {
      setCancelError("נא למלא את שדה הפירוט.");
      return;
    }

    setCancelLoading(true);
    try {
      const res = await fetch("/api/account/cancel-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: cancelSurveyReason,
          reason_detail: cancellationSurveyRequiresDetail(cancelSurveyReason) ? cancelSurveyDetail.trim() : "",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; effective_at?: string; error?: string };
      if (!res.ok) {
        if (data?.error === "already_cancelled") {
          setCancelError("בקשת הביטול כבר נרשמה.");
        } else if (data?.error === "invalid_or_missing_reason" || data?.error === "missing_reason_detail") {
          setCancelError("נא למלא את השאלון כנדרש.");
        } else if (data?.error === "survey_save_failed") {
          setCancelError("שגיאה בשמירת השאלון, נסו שוב.");
        } else {
          setCancelError("לא ניתן לבטל כרגע, נסו שוב.");
        }
        return;
      }
      if (data?.effective_at) {
        setCancellationEffectiveAt(data.effective_at);
        loadBillingState();
      }
      setCancelSurveyReason("");
      setCancelSurveyDetail("");
      setCancelModalOpen(false);
    } catch {
      setCancelError("שגיאה, נסו שוב.");
    } finally {
      setCancelLoading(false);
    }
  }

  async function startCheckout(target: "starter" | "pro") {
    try {
      setCheckoutError("");
      setCheckoutLoading(target);
      const res = await fetch("/api/account/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: target === "pro" ? "pro" : "starter" }),
      });
      const data = (await res.json().catch(() => null)) as any;
      const url = typeof data?.url === "string" ? data.url : "";
      if (!res.ok || !url) {
        throw new Error(typeof data?.error === "string" ? data.error : "checkout_failed");
      }
      window.location.href = url;
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : "checkout_failed");
      setCheckoutLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-right">
        <h1 className="text-2xl font-semibold text-zinc-900">חיוב וחבילות</h1>
        <p className="text-sm text-zinc-600">בחר/י חבילה שמתאימה לעסק שלך (Starter / Pro)</p>
      </div>

      {authReady && authed && billingStateLoaded && subscriptionActive && activeSlug && !reactivate ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-right">
          <p className="text-sm font-semibold text-emerald-900">המנוי פעיל</p>
          <p className="mt-1 text-sm text-emerald-800">
            אפשר לחזור לדשבורד של העסק ולהמשיך משם.
          </p>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => {
                window.location.href = `/${encodeURIComponent(activeSlug)}/analytics`;
              }}
              className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              מעבר לדשבורד
            </button>
          </div>
        </div>
      ) : null}

      {!authReady || !authed || !billingStateLoaded ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-right text-sm text-zinc-600">
          טוען…
        </div>
      ) : null}

      {reactivate && authReady && authed && billingStateLoaded && !subscriptionActive ? (
        <div className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50 p-4 text-right">
          <p className="text-sm font-semibold text-zinc-900">המנוי לא פעיל כרגע</p>
          <p className="mt-1 text-sm text-zinc-700">
            כדי להמשיך לערוך את הדשבורד, יש לבחור חבילה ולהפעיל מחדש את המנוי.
          </p>
          {checkoutError ? (
            <p className="mt-2 text-sm text-red-600">שגיאה בתשלום: {checkoutError}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2 justify-end">
            <button
              type="button"
              onClick={() => void startCheckout("starter")}
              disabled={checkoutLoading != null}
              className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
            >
              הפעלת Starter
            </button>
            <button
              type="button"
              onClick={() => void startCheckout("pro")}
              disabled={checkoutLoading != null}
              className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-fuchsia-700 disabled:opacity-60"
            >
              הפעלת Pro
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-600">
            לאחר התשלום תחזרו למערכת אוטומטית. אם לא קורה, רעננו את הדף.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <PlanCard
          title="Starter"
          price="₪349 / חודש"
          priceCompare="₪500"
          priceNote={promoPriceNote}
          bullets={[
            "מספר ווטסאפ ייעודי",
            "פלואו מכירה מלא",
            "פולואפים אוטומטיים",
            "ללא עלות הקמה",
            "עד 100 שיחות בחודש",
            "דשבורד ניהול",
            "תמיכה בצ'אט",
          ]}
          isCurrent={subscriptionActive && plan === "basic"}
          actionLabel={subscriptionActive && plan === "basic" ? undefined : "הפעלה"}
          actionDisabled={checkoutLoading != null}
          onAction={subscriptionActive && plan === "basic" ? undefined : () => void startCheckout("starter")}
        />
        <PlanCard
          title="Pro"
          price="₪499 / חודש"
          priceCompare="₪650"
          priceNote={promoPriceNote}
          bullets={[
            "כל מה שב-Starter",
            "העלאת מדיה לצ'אט",
            "עד 500 שיחות בחודש",
            "ליווי צמוד בהקמה",
            "אנליטיקס מתקדם",
          ]}
          primary
          isCurrent={subscriptionActive && plan === "premium"}
          actionLabel={subscriptionActive && plan === "premium" ? undefined : "שדרוג ל־Pro"}
          actionDisabled={checkoutLoading != null}
          onAction={subscriptionActive && plan === "premium" ? undefined : () => void startCheckout("pro")}
        />
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white">
        <div className="px-4 py-3 border-b border-zinc-100">
          <p className="text-sm font-semibold text-zinc-900 text-right">היסטוריית חשבוניות</p>
        </div>
        {invoices.length === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-500 text-right">אין היסטוריית חיובים להצגה</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="text-right font-medium px-4 py-2">חודש</th>
                  <th className="text-right font-medium px-4 py-2">סכום</th>
                  <th className="text-right font-medium px-4 py-2">סטטוס</th>
                  <th className="text-right font-medium px-4 py-2">הורדה</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.month} className="border-t border-zinc-100">
                    <td className="px-4 py-2 text-right">{inv.month}</td>
                    <td className="px-4 py-2 text-right">{inv.amount}</td>
                    <td className="px-4 py-2 text-right">{inv.status}</td>
                    <td className="px-4 py-2 text-right">
                      <a className="underline underline-offset-4 text-fuchsia-700" href={inv.href}>
                        הורדה
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-sm text-zinc-600 text-right">חשבוניות נשלחות למייל לאחר התשלום.</p>

      {subscriptionActive ? (
        <div
          className="rounded-2xl border border-zinc-200 bg-white p-5 text-right"
          style={{ fontFamily: "Fredoka, Heebo, system-ui, sans-serif", borderRadius: "16px" }}
        >
          <h2 className="text-lg font-semibold text-zinc-900">ביטול מנוי</h2>
          {cancellationEffectiveAt ? (
            <div className="mt-3 space-y-2 text-sm text-zinc-700">
              <p>
                המנוי יסתיים בתאריך{" "}
                <span className="font-semibold text-zinc-900">
                  {formatHebrewDate(cancellationEffectiveAt)}
                </span>
                . לפרטים פנה ל־
                <a
                  className="text-[#7133da] underline underline-offset-2"
                  href="mailto:office@heyzoe.io"
                >
                  office@heyzoe.io
                </a>
              </p>
            </div>
          ) : (
            <>
              <p className="mt-1 text-sm text-zinc-600">
                ביטול אינו מיידי: השירות ימשיך בפעולה 30 יום מתאריך הבקשה, ואז מסתיימת הגישה.
              </p>
              {cancelError ? <p className="mt-2 text-sm text-red-600">{cancelError}</p> : null}
              <button
                type="button"
                onClick={() => {
                  setCancelError("");
                  setCancelSurveyReason("");
                  setCancelSurveyDetail("");
                  setCancelModalOpen(true);
                }}
                className="mt-4 inline-flex w-full sm:w-auto cursor-pointer items-center justify-center rounded-2xl border-2 border-red-500 bg-transparent px-5 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500"
              >
                ביטול מנוי
              </button>
            </>
          )}
        </div>
      ) : null}

      {cancelModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(17, 11, 26, 0.5)" }}
          onClick={() => {
            if (!cancelLoading) {
              setCancelModalOpen(false);
              setCancelSurveyReason("");
              setCancelSurveyDetail("");
              setCancelError("");
            }
          }}
        >
          <div
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 text-right shadow-xl"
            style={{ fontFamily: "Fredoka, Heebo, system-ui, sans-serif", borderRadius: "16px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-zinc-900">ביטול מנוי</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">
              לפני הביטול נשמח לשמוע למה. אי אפשר לדלג על השאלון. השירות ימשיך לפעול עד{" "}
              <span className="font-semibold text-zinc-800">{previewEndDate}</span>, ואז תיסגר הגישה לדשבורד.
            </p>

            <div className="mt-4">
              <p className="text-sm font-semibold text-zinc-900">מה הסיבה לביטול? <span className="text-red-600">*</span></p>
              <div className="mt-2 space-y-2" role="radiogroup" aria-label="סיבת ביטול">
                {CANCELLATION_SURVEY_REASONS.map((r) => (
                  <label
                    key={r}
                    className={
                      "flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-sm text-zinc-800 hover:bg-zinc-100 " +
                      (cancelSurveyReason === r
                        ? "border-fuchsia-300 bg-fuchsia-50/60"
                        : "border-zinc-200 bg-zinc-50/80")
                    }
                  >
                    <input
                      type="radio"
                      name="cancel-reason"
                      className="mt-0.5"
                      checked={cancelSurveyReason === r}
                      onChange={() => {
                        setCancelSurveyReason(r);
                        setCancelError("");
                      }}
                    />
                    <span>{r}</span>
                  </label>
                ))}
              </div>
            </div>

            {cancellationSurveyRequiresDetail(cancelSurveyReason) ? (
              <div className="mt-4">
                <label htmlFor="cancel-survey-detail" className="text-sm font-semibold text-zinc-900">
                  {cancellationSurveyDetailLabel(cancelSurveyReason)}{" "}
                  <span className="text-red-600">*</span>
                </label>
                <textarea
                  id="cancel-survey-detail"
                  dir="rtl"
                  rows={3}
                  value={cancelSurveyDetail}
                  onChange={(e) => {
                    setCancelSurveyDetail(e.target.value);
                    setCancelError("");
                  }}
                  className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                  placeholder=""
                />
              </div>
            ) : null}

            {cancelError ? <p className="mt-3 text-sm text-red-600">{cancelError}</p> : null}

            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-zinc-100 pt-4">
              <button
                type="button"
                disabled={cancelLoading}
                onClick={() => {
                  if (cancelLoading) return;
                  setCancelModalOpen(false);
                  setCancelSurveyReason("");
                  setCancelSurveyDetail("");
                  setCancelError("");
                }}
                className="inline-flex cursor-pointer items-center justify-center rounded-2xl border border-zinc-300 bg-zinc-100 px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-200 disabled:opacity-50"
                style={{ borderRadius: "16px" }}
              >
                חזור
              </button>
              <button
                type="button"
                disabled={cancelLoading}
                onClick={() => void confirmCancelSubscription()}
                className="inline-flex cursor-pointer items-center justify-center rounded-2xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                style={{ borderRadius: "16px" }}
              >
                {cancelLoading ? "שולח..." : "אשר ביטול"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

