"use client";

import { type CSSProperties, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type Plan = "starter" | "pro";
type Step = 1 | 2 | 3;

interface FormData {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  password: string;
  studio_name: string;
  business_type: string;
  business_type_other: string;
  description: string;
  address: string;
}

type FormErrors = Partial<Record<keyof FormData, string>>;

const BUSINESS_TYPES = ["פילאטיס", "יוגה", "ג'ים", "קרוספיט", "אקרובטיקה", "ריקוד", "אחר"];

const PLAN_INFO: Record<Plan, { name: string }> = {
  starter: { name: "Starter" },
  pro: { name: "Pro" },
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  fontSize: "15px",
  border: "1.5px solid #e8e4f8",
  borderRadius: "12px",
  fontFamily: "Heebo, sans-serif",
  direction: "rtl",
  outline: "none",
  background: "white",
  color: "#1a0a3c",
  transition: "border-color 0.2s",
};

const labelStyle: React.CSSProperties = {
  fontSize: "13px",
  fontWeight: "500",
  color: "#6b5b9a",
  marginBottom: "6px",
  display: "block",
};

const btnPrimary: React.CSSProperties = {
  width: "100%",
  padding: "14px",
  fontSize: "16px",
  fontWeight: "600",
  background: "linear-gradient(135deg, #7133da, #a855f7)",
  color: "white",
  border: "none",
  borderRadius: "30px",
  cursor: "pointer",
  fontFamily: "Heebo, sans-serif",
  transition: "transform 0.2s, box-shadow 0.2s",
};

const PAY_READY_POLL_MS = 2500;
const PAY_READY_TIMEOUT_MS = 120_000;
const WHATSAPP_HELP_URL =
  "https://wa.me/972508318162?text=%D7%94%D7%99%D7%99%2C%20%D7%99%D7%A9%20%D7%9C%D7%99%20%D7%A9%D7%90%D7%9C%D7%94%20%D7%91%D7%A0%D7%95%D7%92%D7%A2%20%D7%9C%D7%96%D7%95%D7%90%D7%99%21";

function studioToSlug(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "business";
}

function OnboardingContent() {
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const requestedPlan = (searchParams.get("plan") || "starter").toLowerCase();
  const [selectedPlan, setSelectedPlan] = useState<Plan>(requestedPlan === "pro" ? "pro" : "starter");
  const [planMenuOpen, setPlanMenuOpen] = useState(false);
  const planPickerRef = useRef<HTMLDivElement>(null);
  const emailParam = (searchParams.get("email") || "").trim();
  const phoneCheckRef = useMemo(
    () => ({ ac: null as AbortController | null, t: null as number | null, reqId: 0 }),
    []
  );

  const [step, setStep] = useState<Step>(1);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [loadingPayment, setLoadingPayment] = useState(false);
  const [paymentReady, setPaymentReady] = useState<null | { slug: string }>(null);
  const [paymentReadyTimedOut, setPaymentReadyTimedOut] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [phoneTaken, setPhoneTaken] = useState(false);
  const [phoneChecking, setPhoneChecking] = useState(false);
  const [emailTaken, setEmailTaken] = useState(false);
  const [emailChecking, setEmailChecking] = useState(false);
  const [showPhoneTakenTip, setShowPhoneTakenTip] = useState(false);
  const [showEmailTakenTip, setShowEmailTakenTip] = useState(false);
  const [existingModal, setExistingModal] = useState<
    null | { next: string; title: string; body: string; msg: string }
  >(null);
  const [sessionEmail, setSessionEmail] = useState<string>("");
  const [switchAccountModal, setSwitchAccountModal] = useState<
    null | { sessionEmail: string; typedEmail: string }
  >(null);
  const emailCheckRef = useMemo(
    () => ({ ac: null as AbortController | null, t: null as number | null, reqId: 0 }),
    []
  );

  const [form, setForm] = useState<FormData>({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    password: "",
    studio_name: "",
    business_type: "",
    business_type_other: "",
    description: "",
    address: "",
  });

  const planInfo = PLAN_INFO[selectedPlan];

  // Analytics continuity: /onboarding/success emits "purchase" based on sessionStorage values.
  // If user did not arrive from /lp-leads, seed those values here.
  useEffect(() => {
    try {
      const key = "hz_lp_session_id";
      const existing = sessionStorage.getItem(key) || "";
      if (!existing) {
        const sid = `onb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        sessionStorage.setItem(key, sid);
      }
      if (!sessionStorage.getItem("hz_lp_source")) {
        sessionStorage.setItem("hz_lp_source", "onboarding");
      }
    } catch {
      // ignore
    }
  }, []);

  // Detect existing session email to prevent "sign up with a different email while logged in".
  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const email = String(data.user?.email ?? "").trim().toLowerCase();
      setSessionEmail(email);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function runPhoneDupCheck(rawPhone: string, opts?: { immediate?: boolean }) {
    const raw = String(rawPhone || "").trim();

    if (!raw) {
      setPhoneChecking(false);
      setPhoneTaken(false);
      return false;
    }

    if (opts?.immediate) {
      if (phoneCheckRef.t) {
        window.clearTimeout(phoneCheckRef.t);
        phoneCheckRef.t = null;
      }
    }

    phoneCheckRef.ac?.abort();
    const ac = new AbortController();
    phoneCheckRef.ac = ac;

    const myReqId = (phoneCheckRef.reqId += 1);
    setPhoneChecking(true);
    try {
      const res = await fetch(`/api/onboarding/check-phone?phone=${encodeURIComponent(raw)}`, {
        method: "GET",
        cache: "no-store",
        signal: ac.signal,
      });
      const data = (await res.json().catch(() => ({}))) as { exists?: boolean };
      if (phoneCheckRef.reqId !== myReqId) return false;
      const exists = Boolean(data?.exists);
      setPhoneTaken(exists);
      return exists;
    } catch {
      // Network/server error: do not block onboarding.
      if (phoneCheckRef.reqId !== myReqId) return false;
      setPhoneTaken(false);
      return false;
    } finally {
      if (phoneCheckRef.reqId !== myReqId) return;
      setPhoneChecking(false);
    }
  }

  async function runEmailDupCheck(rawEmail: string, opts?: { showModal?: boolean; immediate?: boolean }) {
    const email = String(rawEmail || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setEmailChecking(false);
      setEmailTaken(false);
      return false;
    }

    if (opts?.immediate) {
      if (emailCheckRef.t) {
        window.clearTimeout(emailCheckRef.t);
        emailCheckRef.t = null;
      }
    }

    emailCheckRef.ac?.abort();
    const ac = new AbortController();
    emailCheckRef.ac = ac;
    const myReqId = (emailCheckRef.reqId += 1);
    setEmailChecking(true);
    try {
      const res = await fetch(`/api/onboarding/email-status?email=${encodeURIComponent(email)}`, {
        method: "GET",
        cache: "no-store",
        signal: ac.signal,
      });
      const data = (await res.json().catch(() => ({}))) as { state?: string; slug?: string | null };
      const taken = data?.state === "existing_paying" || data?.state === "existing_unpaid";
      if (emailCheckRef.reqId !== myReqId) return false;
      setEmailTaken(Boolean(taken));
      if (opts?.showModal) {
        if (data?.state === "existing_paying") {
          const next = data.slug ? `/${data.slug}/analytics` : "/dashboard";
          setExistingModal({
            next,
            title: "מצאנו חשבון קיים",
            body: "נראה שהאימייל הזה כבר מחובר לדשבורד פעיל. כדי להמשיך, צריך להתחבר.",
            msg: "מצאנו חשבון קיים עם האימייל הזה. התחברי כדי להמשיך.",
          });
        } else if (data?.state === "existing_unpaid") {
          const next = "/account/billing?reactivate=1";
          setExistingModal({
            next,
            title: "מצאנו חשבון קיים",
            body: "החשבון קיים אבל המנוי לא פעיל כרגע. התחברי כדי להפעיל מחדש את המנוי ולחזור לדשבורד.",
            msg: "החשבון קיים אבל המנוי לא פעיל. התחברי כדי להפעיל מחדש את המנוי.",
          });
        }
      }
      return Boolean(taken);
    } catch {
      // Network/server error: do not block onboarding.
      if (emailCheckRef.reqId !== myReqId) return false;
      setEmailTaken(false);
      return false;
    } finally {
      if (emailCheckRef.reqId !== myReqId) return;
      setEmailChecking(false);
    }
  }

  // Optional: allow prefilling email via /onboarding?plan=starter&email=user@example.com
  useEffect(() => {
    if (!emailParam) return;
    setForm((prev) => {
      if (String(prev.email || "").trim()) return prev;
      return { ...prev, email: emailParam };
    });
  }, [emailParam]);

  // Debounced "phone already exists" check (does not validate format).
  useEffect(() => {
    const raw = String(form.phone || "").trim();

    if (phoneCheckRef.t) {
      window.clearTimeout(phoneCheckRef.t);
      phoneCheckRef.t = null;
    }
    phoneCheckRef.ac?.abort();
    phoneCheckRef.ac = null;

    if (!raw) {
      setPhoneChecking(false);
      setPhoneTaken(false);
      return;
    }

    phoneCheckRef.t = window.setTimeout(async () => {
      await runPhoneDupCheck(raw);
    }, 600);

    return () => {
      if (phoneCheckRef.t) {
        window.clearTimeout(phoneCheckRef.t);
        phoneCheckRef.t = null;
      }
      phoneCheckRef.ac?.abort();
      phoneCheckRef.ac = null;
    };
  }, [form.phone, phoneCheckRef]);

  // When in step 3 (payment iframe), poll server readiness and redirect automatically.
  useEffect(() => {
    if (step !== 3) return;
    const email = form.email.trim().toLowerCase();
    if (!email) return;

    let cancelled = false;
    setPaymentReady(null);
    setPaymentReadyTimedOut(false);
    const startedAt = Date.now();

    async function tick() {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= PAY_READY_TIMEOUT_MS) {
        setPaymentReadyTimedOut(true);
        return;
      }
      try {
        const res = await fetch(`/api/check-payment-ready?email=${encodeURIComponent(email)}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as { ready?: boolean; slug?: string };
        if (data?.ready && data.slug) {
          setPaymentReady({ slug: data.slug });
          window.location.href = `/${data.slug}/analytics?welcome=1`;
          return;
        }
      } catch {
        /* ignore transient */
      }
      window.setTimeout(tick, PAY_READY_POLL_MS);
    }

    void tick();
    return () => {
      cancelled = true;
    };
  }, [step, form.email]);

  function update(field: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: "" }));
  }

  function validateStep1() {
    const e: FormErrors = {};
    if (!form.first_name.trim()) e.first_name = "שדה חובה";
    if (!form.last_name.trim()) e.last_name = "שדה חובה";
    if (!form.phone.trim() || form.phone.replace(/\D/g, "").length < 9) e.phone = "מספר טלפון לא תקין";
    if (!form.email.trim() || !form.email.includes("@")) e.email = "אימייל לא תקין";
    const pw = String(form.password || "");
    const hasLetter = /[a-zA-Zא-ת]/.test(pw);
    const hasDigit = /\d/.test(pw);
    if (!pw || pw.length < 8 || !hasLetter || !hasDigit) {
      e.password = "סיסמה חייבת להכיל לפחות 8 תווים, כולל אות ומספר";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function validateStep2() {
    const e: FormErrors = {};
    if (!form.studio_name.trim()) e.studio_name = "שדה חובה";
    if (!form.business_type) e.business_type = "נא לבחור סוג עסק";
    if (form.business_type === "אחר" && !form.business_type_other.trim()) e.business_type_other = "שדה חובה";
    if (!form.description.trim()) e.description = "שדה חובה";
    if (!form.address.trim()) e.address = "שדה חובה";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function checkExistingEmailIfNeeded(rawEmail: string) {
    void runEmailDupCheck(rawEmail, { showModal: true, immediate: true });
  }

  // Debounced "email already exists" check while typing (does not block on invalid/empty inputs).
  useEffect(() => {
    const raw = String(form.email || "").trim();

    if (emailCheckRef.t) {
      window.clearTimeout(emailCheckRef.t);
      emailCheckRef.t = null;
    }
    emailCheckRef.ac?.abort();
    emailCheckRef.ac = null;

    if (!raw || !raw.includes("@")) {
      setEmailChecking(false);
      setEmailTaken(false);
      return;
    }

    emailCheckRef.t = window.setTimeout(async () => {
      await runEmailDupCheck(raw, { showModal: false });
    }, 600);

    return () => {
      if (emailCheckRef.t) {
        window.clearTimeout(emailCheckRef.t);
        emailCheckRef.t = null;
      }
      emailCheckRef.ac?.abort();
      emailCheckRef.ac = null;
    };
  }, [form.email, emailCheckRef]);

  async function goToPayment() {
    setLoadingPayment(true);
    try {
      // Persist creds across full-page navigations (best-effort).
      try {
        const e = String(form.email || "").trim();
        const p = String(form.password || "");
        if (e && p) localStorage.setItem("hz_onb_creds", JSON.stringify({ email: e, password: p, ts: Date.now() }));
      } catch {
        /* ignore */
      }
      const resolvedBusinessType =
        form.business_type === "אחר" ? form.business_type_other.trim() : form.business_type.trim();

      const emailRes = await fetch(
        `/api/onboarding/email-status?email=${encodeURIComponent(form.email.trim())}`,
        { method: "GET", cache: "no-store" }
      );
      const emailStatus = (await emailRes.json().catch(() => ({}))) as {
        state?: string;
        slug?: string | null;
      };
      if (emailStatus?.state === "existing_paying") {
        const next = emailStatus.slug ? `/${emailStatus.slug}/analytics` : "/dashboard";
        window.location.href = `/dashboard/login?next=${encodeURIComponent(next)}&msg=${encodeURIComponent(
          "מצאנו חשבון קיים עם האימייל הזה. התחברי כדי להמשיך."
        )}`;
        return;
      }
      if (emailStatus?.state === "existing_unpaid") {
        const next = "/account/billing?reactivate=1";
        window.location.href = `/dashboard/login?next=${encodeURIComponent(next)}&msg=${encodeURIComponent(
          "החשבון קיים אבל המנוי לא פעיל. התחברי כדי להפעיל מחדש את המנוי."
        )}`;
        return;
      }

      const saveRes = await fetch("/api/onboarding/save-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: selectedPlan,
          email: form.email,
          first_name: form.first_name,
          last_name: form.last_name,
          phone: form.phone,
          password: form.password,
          studio_name: form.studio_name,
          business_type: resolvedBusinessType,
          description: form.description,
          address: form.address,
        }),
      });
      if (!saveRes.ok) {
        throw new Error("save_session_failed");
      }

      const res = await fetch("/api/icount-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: selectedPlan,
          email: form.email,
          first_name: form.first_name,
          last_name: form.last_name,
          phone: form.phone,
          custom: selectedPlan,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        throw new Error(typeof data?.error === "string" ? data.error : "checkout_failed");
      }

      // Track checkout_start and set plan value so /onboarding/success can emit "purchase".
      try {
        const value = selectedPlan === "pro" ? 499 : 349;
        sessionStorage.setItem("hz_lp_plan", selectedPlan);
        sessionStorage.setItem("hz_lp_plan_value", String(value));
        if (!sessionStorage.getItem("hz_lp_source")) sessionStorage.setItem("hz_lp_source", "onboarding");
        const sid = sessionStorage.getItem("hz_lp_session_id") || "";
        if (sid) {
          void fetch("/api/track", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event_type: "checkout_start", session_id: sid, source: "onboarding", label: selectedPlan }),
            keepalive: true,
          });
        }
      } catch {
        // ignore
      }

      setIframeUrl(String(data.url));
      setStep(3);
    } catch (e) {
      const msg = String((e as any)?.message ?? "");
      const nice =
        msg === "missing_icount_cid_starter"
          ? "חסרה הגדרת סליקה לחבילת Starter (ICOUNT_CID_STARTER)."
          : msg === "missing_icount_paypage_id_starter"
            ? "חסרה הגדרת סליקה לחבילת Starter (ICOUNT_PAYPAGE_ID_STARTER)."
            : msg === "missing_icount_cid_pro"
              ? "חסרה הגדרת סליקה לחבילת Pro (ICOUNT_CID_PRO)."
              : msg === "missing_icount_paypage_id_pro"
                ? "חסרה הגדרת סליקה לחבילת Pro (ICOUNT_PAYPAGE_ID_PRO)."
                : msg === "missing_email"
                  ? "חסר אימייל."
                  : "שגיאה ביצירת דף תשלום, נסו שוב";
      alert(nice);
    } finally {
      setLoadingPayment(false);
    }
  }

  useEffect(() => {
    if (!planMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (planPickerRef.current && !planPickerRef.current.contains(e.target as Node)) {
        setPlanMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [planMenuOpen]);

  const progress = useMemo(() => (step === 1 ? 33 : step === 2 ? 66 : 100), [step]);

  return (
    <div
      className="px-0 sm:px-4 overflow-x-hidden w-full"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: "40px",
        paddingBottom: "40px",
        background: "#f5f3ff",
      }}
    >
      {existingModal ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(17, 11, 26, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "18px",
            zIndex: 1000,
          }}
          onClick={() => setExistingModal(null)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "420px",
              background: "white",
              borderRadius: "16px",
              boxShadow: "0 24px 80px rgba(0,0,0,0.25)",
              padding: "18px 18px 16px",
              textAlign: "right",
              border: "1px solid rgba(113,51,218,0.12)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 800, color: "#1a0a3c", fontSize: "18px" }}>
              {existingModal.title}
            </div>
            <div style={{ marginTop: "8px", color: "#6b5b9a", fontSize: "14px", lineHeight: 1.6 }}>
              {existingModal.body}
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
              <button
                type="button"
                style={{
                  ...btnPrimary,
                  flex: 1,
                  padding: "12px 14px",
                  borderRadius: "14px",
                }}
                onClick={() => {
                  const next = existingModal.next;
                  window.location.href = `/dashboard/login?next=${encodeURIComponent(next)}&msg=${encodeURIComponent(
                    existingModal.msg
                  )}`;
                }}
              >
                התחברות
              </button>
              <button
                type="button"
                style={{
                  ...btnPrimary,
                  background: "transparent",
                  color: "#7133da",
                  border: "2px solid #7133da",
                  width: "110px",
                  padding: "12px 14px",
                  borderRadius: "14px",
                }}
                onClick={() => setExistingModal(null)}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {switchAccountModal ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(17, 11, 26, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "18px",
            zIndex: 1000,
          }}
          onClick={() => setSwitchAccountModal(null)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "460px",
              background: "white",
              borderRadius: "16px",
              boxShadow: "0 24px 80px rgba(0,0,0,0.25)",
              padding: "18px 18px 16px",
              textAlign: "right",
              border: "1px solid rgba(113,51,218,0.12)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 800, color: "#1a0a3c", fontSize: "18px" }}>את/ה כבר מחובר/ת למערכת</div>
            <div style={{ marginTop: "8px", color: "#6b5b9a", fontSize: "14px", lineHeight: 1.6 }}>
              כרגע את/ה מחובר/ת עם{" "}
              <span dir="ltr" style={{ fontWeight: 700 }}>
                {switchAccountModal.sessionEmail}
              </span>
              , אבל בטופס הוקלד{" "}
              <span dir="ltr" style={{ fontWeight: 700 }}>
                {switchAccountModal.typedEmail}
              </span>
              .
              <div style={{ marginTop: 8 }}>כדי לפתוח חשבון חדש עם אימייל אחר, צריך להתנתק קודם.</div>
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
              <button
                type="button"
                style={{
                  ...btnPrimary,
                  flex: 1,
                  padding: "12px 14px",
                  borderRadius: "14px",
                }}
                onClick={() => {
                  const email = switchAccountModal.sessionEmail;
                  setForm((prev) => ({ ...prev, email }));
                  setSwitchAccountModal(null);
                }}
              >
                המשך עם האימייל המחובר
              </button>
              <button
                type="button"
                style={{
                  ...btnPrimary,
                  background: "transparent",
                  color: "#7133da",
                  border: "2px solid #7133da",
                  width: "150px",
                  padding: "12px 14px",
                  borderRadius: "14px",
                }}
                onClick={() => {
                  void (async () => {
                    try {
                      await supabase.auth.signOut();
                    } catch {
                      // ignore
                    } finally {
                      setSessionEmail("");
                      setSwitchAccountModal(null);
                    }
                  })();
                }}
              >
                התנתקות והמשך
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <a href="/" style={{ marginBottom: "32px" }}>
        <img src="/heyzoe-logo.png" alt="HeyZoe" style={{ height: "36px" }} />
      </a>

      <div
        className={
          step === 3
            ? "w-full min-w-0 overflow-x-hidden max-w-[min(1120px,calc(100vw-16px))] sm:max-w-[min(1120px,calc(100vw-32px))]"
            : "w-full max-w-[480px] min-w-0 overflow-x-hidden"
        }
        style={{
          background: "white",
          borderRadius: "24px",
          boxShadow: "0 8px 40px rgba(113,51,218,0.12)",
          overflow: "hidden",
        }}
      >
        {step < 3 ? (
          <div style={{ height: "4px", background: "#f0edf8" }}>
            <div
              style={{
                height: "100%",
                width: `${progress}%`,
                background: "linear-gradient(90deg, #7133da, #ff92ff)",
                transition: "width 0.4s ease",
              }}
            />
          </div>
        ) : null}

        <div style={{ padding: step === 3 ? "24px 14px" : "32px 28px" }}>
          {step < 3 ? (
            <div ref={planPickerRef} style={{ position: "relative", marginBottom: "20px" }}>
              <button
                type="button"
                onClick={() => setPlanMenuOpen((o) => !o)}
                aria-expanded={planMenuOpen}
                aria-haspopup="listbox"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  background: "rgba(113,51,218,0.08)",
                  border: "1px solid rgba(113,51,218,0.2)",
                  borderRadius: "20px",
                  padding: "8px 14px",
                  fontSize: "14px",
                  color: "#7133da",
                  fontWeight: 700,
                  fontFamily: "Heebo, sans-serif",
                  cursor: "pointer",
                }}
              >
                חבילת {planInfo.name}
                <span style={{ fontSize: "10px", opacity: 0.75 }} aria-hidden>
                  ▼
                </span>
              </button>
              {planMenuOpen ? (
                <div
                  role="listbox"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 6px)",
                    right: 0,
                    zIndex: 40,
                    minWidth: "200px",
                    background: "white",
                    border: "1px solid rgba(113,51,218,0.15)",
                    borderRadius: "14px",
                    boxShadow: "0 10px 40px rgba(0,0,0,0.1)",
                    padding: "6px",
                    textAlign: "right",
                  }}
                >
                  {(["starter", "pro"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="option"
                      aria-selected={selectedPlan === p}
                      onClick={() => {
                        setSelectedPlan(p);
                        setPlanMenuOpen(false);
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        border: "none",
                        background: selectedPlan === p ? "rgba(113,51,218,0.1)" : "transparent",
                        borderRadius: "10px",
                        padding: "10px 12px",
                        fontSize: "14px",
                        fontWeight: selectedPlan === p ? 700 : 500,
                        color: "#1a0a3c",
                        fontFamily: "Heebo, sans-serif",
                        cursor: "pointer",
                        textAlign: "right",
                      }}
                    >
                      חבילת {PLAN_INFO[p].name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 1 ? (
            <form
              autoComplete="on"
              onSubmit={(e) => {
                e.preventDefault();
                void (async () => {
                  setShowPhoneTakenTip(false);
                  setShowEmailTakenTip(false);

                  const typedEmail = String(form.email || "").trim().toLowerCase();
                  if (sessionEmail && typedEmail && sessionEmail !== typedEmail) {
                    setSwitchAccountModal({ sessionEmail, typedEmail });
                    return;
                  }

                  const rawPhone = String(form.phone || "").trim();
                  if (rawPhone) {
                    // Prevent bypass: if there's a pending debounce or an in-flight request,
                    // force an immediate check before proceeding.
                    if (phoneChecking || phoneCheckRef.t) {
                      const exists = await runPhoneDupCheck(rawPhone, { immediate: true });
                      if (exists) {
                        setShowPhoneTakenTip(true);
                        return;
                      }
                    } else if (!phoneTaken) {
                      const exists = await runPhoneDupCheck(rawPhone, { immediate: true });
                      if (exists) {
                        setShowPhoneTakenTip(true);
                        return;
                      }
                    }
                  }

                  const rawEmail = String(form.email || "").trim();
                  if (rawEmail) {
                    const existsEmail = await runEmailDupCheck(rawEmail, { showModal: true, immediate: true });
                    if (existsEmail) {
                      setShowEmailTakenTip(true);
                      return;
                    }
                  }

                  if (validateStep1() && !phoneTaken && !emailTaken) {
                    // Best-effort: help password managers offer to save creds after signup completion.
                    try {
                      const e = String(form.email || "").trim();
                      const p = String(form.password || "");
                      sessionStorage.setItem("hz_onb_email", e);
                      sessionStorage.setItem("hz_onb_password", p);
                      localStorage.setItem("hz_onb_creds", JSON.stringify({ email: e, password: p, ts: Date.now() }));
                    } catch {
                      /* ignore */
                    }
                    setStep(2);
                  }
                })();
              }}
            >
              <h2 style={{ fontSize: "22px", fontWeight: "700", color: "#1a0a3c", marginBottom: "4px" }}>
                נתחיל עם פרטים אישיים
              </h2>
              <p style={{ fontSize: "14px", color: "#8b7aaa", marginBottom: "24px" }}>
                כך נדע עם מי אנחנו עובדים
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "12px",
                  marginBottom: "16px",
                }}
              >
                <div>
                  <label style={labelStyle} htmlFor="onboarding_first_name">
                    שם פרטי
                  </label>
                  <input
                    id="onboarding_first_name"
                    style={{ ...inputStyle, borderColor: errors.first_name ? "#e24b4a" : "#e8e4f8" }}
                    value={form.first_name}
                    onChange={(e) => update("first_name", e.target.value)}
                    placeholder="ישראל"
                    name="first_name"
                    autoComplete="given-name"
                  />
                  {errors.first_name ? (
                    <span style={{ fontSize: "12px", color: "#e24b4a" }}>{errors.first_name}</span>
                  ) : null}
                </div>
                <div>
                  <label style={labelStyle} htmlFor="onboarding_last_name">
                    שם משפחה
                  </label>
                  <input
                    id="onboarding_last_name"
                    style={{ ...inputStyle, borderColor: errors.last_name ? "#e24b4a" : "#e8e4f8" }}
                    value={form.last_name}
                    onChange={(e) => update("last_name", e.target.value)}
                    placeholder="ישראלי"
                    name="last_name"
                    autoComplete="family-name"
                  />
                  {errors.last_name ? (
                    <span style={{ fontSize: "12px", color: "#e24b4a" }}>{errors.last_name}</span>
                  ) : null}
                </div>
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={labelStyle} htmlFor="onboarding_phone">
                  טלפון
                </label>
                <input
                  id="onboarding_phone"
                  style={{ ...inputStyle, borderColor: errors.phone ? "#e24b4a" : "#e8e4f8" }}
                  value={form.phone}
                  onChange={(e) => {
                    setPhoneTaken(false);
                    setShowPhoneTakenTip(false);
                    update("phone", e.target.value);
                  }}
                  onBlur={(e) => {
                    const raw = String(e.target.value || "").trim();
                    if (!raw) return;
                    void runPhoneDupCheck(raw, { immediate: true });
                  }}
                  placeholder="050-0000000"
                  type="tel"
                  name="phone"
                  autoComplete="tel"
                />
                {errors.phone ? <span style={{ fontSize: "12px", color: "#e24b4a" }}>{errors.phone}</span> : null}
                {!errors.phone && phoneTaken ? (
                  <span style={{ fontSize: "12px", color: "#e24b4a" }}>מספר הטלפון כבר רשום במערכת</span>
                ) : null}
                {!errors.phone && phoneTaken && showPhoneTakenTip ? (
                  <div style={{ fontSize: "12px", color: "#6b5b9a", marginTop: "4px" }}>
                    כדי להמשיך — צריך להכניס מספר אחר או להתחבר לחשבון הקיים.
                  </div>
                ) : null}
                {phoneChecking ? (
                  <div style={{ fontSize: "12px", color: "#8b7aaa", marginTop: "6px" }}>בודקים מספר…</div>
                ) : null}
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={labelStyle} htmlFor="onboarding_email">
                  אימייל
                </label>
                <input
                  id="onboarding_email"
                  style={{ ...inputStyle, borderColor: errors.email ? "#e24b4a" : "#e8e4f8" }}
                  value={form.email}
                  onChange={(e) => {
                    setEmailTaken(false);
                    setShowEmailTakenTip(false);
                    update("email", e.target.value);
                  }}
                  onBlur={(e) => void checkExistingEmailIfNeeded(e.target.value)}
                  placeholder="israel@studio.co.il"
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                />
                {/* Password managers often look for an explicit username field paired with new-password. */}
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  value={String(form.email || "").trim()}
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    opacity: 0,
                    pointerEvents: "none",
                    height: 0,
                    width: 0,
                  }}
                />
                {errors.email ? <span style={{ fontSize: "12px", color: "#e24b4a" }}>{errors.email}</span> : null}
                {!errors.email && emailTaken ? (
                  <span style={{ fontSize: "12px", color: "#e24b4a" }}>האימייל כבר רשום במערכת</span>
                ) : null}
                {!errors.email && emailTaken && showEmailTakenTip ? (
                  <div style={{ fontSize: "12px", color: "#6b5b9a", marginTop: "4px" }}>
                    כדי להמשיך — צריך להכניס אימייל אחר או להתחבר לחשבון הקיים.
                  </div>
                ) : null}
                {emailChecking ? (
                  <div style={{ fontSize: "12px", color: "#8b7aaa", marginTop: "6px" }}>בודקים אימייל…</div>
                ) : null}
              </div>

              <div style={{ marginBottom: "28px" }}>
                <label style={labelStyle} htmlFor="onboarding_password">
                  סיסמה
                </label>
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    aria-label={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
                    onClick={() => setShowPassword((v) => !v)}
                    style={{
                      position: "absolute",
                      left: "10px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      padding: "6px",
                      color: "#6b5b9a",
                      lineHeight: 0,
                    }}
                  >
                    {showPassword ? (
                      <span style={{ fontSize: "14px" }}>🙈</span>
                    ) : (
                      <span style={{ fontSize: "14px" }}>👁️</span>
                    )}
                  </button>
                  <input
                    id="onboarding_password"
                    style={{
                      ...inputStyle,
                      paddingLeft: "44px",
                      borderColor: errors.password ? "#e24b4a" : "#e8e4f8",
                    }}
                    value={form.password}
                    onChange={(e) => update("password", e.target.value)}
                    placeholder="לפחות 8 תווים"
                    type={showPassword ? "text" : "password"}
                    name="password"
                    autoComplete="new-password"
                  />
                </div>
                <div style={{ marginTop: "6px", fontSize: "12px", color: "#8b7aaa", lineHeight: 1.5 }}>
                  לפחות 8 תווים, כולל אות ומספר.
                </div>
                {errors.password ? (
                  <span style={{ fontSize: "12px", color: "#e24b4a" }}>{errors.password}</span>
                ) : null}
              </div>

              <button
                type="submit"
                style={btnPrimary}
                disabled={
                  phoneTaken ||
                  emailTaken ||
                  (phoneChecking && Boolean(String(form.phone || "").trim())) ||
                  (emailChecking && Boolean(String(form.email || "").trim()))
                }
              >
                המשך
              </button>
            </form>
          ) : null}

          {step === 2 ? (
            <div>
              <h2 style={{ fontSize: "22px", fontWeight: "700", color: "#1a0a3c", marginBottom: "4px" }}>
                ספרו לנו על הסטודיו
              </h2>
              <p style={{ fontSize: "14px", color: "#8b7aaa", marginBottom: "24px" }}>
                זואי תשתמש בפרטים האלה כדי להציג את עצמה
              </p>

              <div style={{ marginBottom: "16px" }}>
                <label style={labelStyle}>שם הסטודיו</label>
                <input
                  style={{ ...inputStyle, borderColor: errors.studio_name ? "#e24b4a" : "#e8e4f8" }}
                  value={form.studio_name}
                  onChange={(e) => update("studio_name", e.target.value)}
                  placeholder="סטודיו X"
                />
                {errors.studio_name ? (
                  <span style={{ fontSize: "12px", color: "#e24b4a" }}>{errors.studio_name}</span>
                ) : null}
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={labelStyle}>סוג עסק</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {BUSINESS_TYPES.map((type) => (
                    <button
                      key={type}
                      onClick={() => update("business_type", type)}
                      style={{
                        padding: "7px 16px",
                        borderRadius: "20px",
                        fontSize: "13px",
                        cursor: "pointer",
                        fontFamily: "Heebo, sans-serif",
                        border:
                          form.business_type === type ? "2px solid #7133da" : "1.5px solid #e8e4f8",
                        background:
                          form.business_type === type ? "rgba(113,51,218,0.08)" : "white",
                        color: form.business_type === type ? "#7133da" : "#555",
                        fontWeight: form.business_type === type ? "600" : "400",
                      }}
                    >
                      {type}
                    </button>
                  ))}
                </div>
                {errors.business_type ? (
                  <span
                    style={{
                      fontSize: "12px",
                      color: "#e24b4a",
                      marginTop: "4px",
                      display: "block",
                    }}
                  >
                    {errors.business_type}
                  </span>
                ) : null}
                {form.business_type === "אחר" ? (
                  <div style={{ marginTop: "12px" }}>
                    <input
                      style={{ ...inputStyle, borderColor: errors.business_type_other ? "#e24b4a" : "#e8e4f8" }}
                      value={form.business_type_other}
                      onChange={(e) => update("business_type_other", e.target.value)}
                      placeholder="כתבו את סוג העסק"
                      name="business_type_other"
                      autoComplete="off"
                    />
                    {errors.business_type_other ? (
                      <span style={{ fontSize: "12px", color: "#e24b4a" }}>{errors.business_type_other}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={labelStyle}>תיאור קצר</label>
                <textarea
                  style={{ ...inputStyle, height: "80px", resize: "none", borderColor: errors.description ? "#e24b4a" : "#e8e4f8" }}
                  value={form.description}
                  onChange={(e) => update("description", e.target.value)}
                  placeholder="סטודיו פילאטיס בוטיק במרכז תל אביב..."
                  name="description"
                  autoComplete="off"
                />
                {errors.description ? (
                  <span style={{ fontSize: "12px", color: "#e24b4a" }}>{errors.description}</span>
                ) : null}
              </div>

              <div style={{ marginBottom: "28px" }}>
                <label style={labelStyle}>כתובת</label>
                <input
                  style={{ ...inputStyle, borderColor: errors.address ? "#e24b4a" : "#e8e4f8" }}
                  value={form.address}
                  onChange={(e) => update("address", e.target.value)}
                  placeholder="רחוב, עיר"
                  name="address"
                  autoComplete="street-address"
                />
                {errors.address ? (
                  <span style={{ fontSize: "12px", color: "#e24b4a" }}>{errors.address}</span>
                ) : null}
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  onClick={() => setStep(1)}
                  style={{
                    ...btnPrimary,
                    background: "transparent",
                    color: "#7133da",
                    border: "2px solid #7133da",
                    width: "80px",
                    flexShrink: 0,
                  }}
                >
                  חזרה
                </button>
                <button
                  style={btnPrimary}
                  onClick={() => {
                    if (validateStep2()) void goToPayment();
                  }}
                  disabled={loadingPayment}
                >
                  {loadingPayment ? "מכין תשלום..." : "המשך לתשלום"}
                </button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div>
              <div style={{ textAlign: "center", marginBottom: "20px" }}>
                <h2 style={{ fontSize: "20px", fontWeight: "700", color: "#1a0a3c", marginBottom: "4px" }}>
                  שלב אחרון - תשלום
                </h2>
                <p style={{ fontSize: "13px", color: "#8b7aaa", margin: 0 }}>חבילת {planInfo.name}</p>
              </div>

              {iframeUrl ? (
                <div
                  className="onboarding-pay-iframe-shell"
                  style={{
                    width: "100%",
                    maxWidth: "100%",
                    overflowX: "hidden",
                    overflowY: "visible",
                    overscrollBehaviorX: "none",
                    touchAction: "pan-y",
                    borderRadius: "12px",
                    background: "#f0eef8",
                    lineHeight: 0,
                  }}
                >
                  <style>{`
                    .onboarding-pay-iframe-shell iframe {
                      width: 100%;
                      max-width: 100%;
                      min-width: 0;
                      border: none;
                      border-radius: 12px;
                      display: block;
                      overflow-x: hidden;
                      overflow-y: auto;
                      zoom: 0.94;
                      height: 2400px;
                      min-height: 2200px;
                    }
                    @media (min-width: 768px) {
                      .onboarding-pay-iframe-shell iframe {
                        zoom: 1;
                        height: min(2400px, 85vh);
                        min-height: min(2400px, 85vh);
                      }
                    }
                  `}</style>
                  <iframe src={iframeUrl} title="דף תשלום מאובטח" />
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "60px 0", color: "#8b7aaa" }}>
                  טוען דף תשלום...
                </div>
              )}

              <div style={{ textAlign: "center", marginTop: "12px", fontSize: "12px", color: "#aaa" }}>
                🔒 תשלום מאובטח דרך iCount
              </div>

              {/* After payment, iCount sometimes does not redirect out of the iframe.
                  This polling ensures the user still gets redirected once IPN is processed. */}
              <div
                style={{
                  marginTop: 14,
                  borderRadius: 14,
                  border: "1px solid rgba(113,51,218,0.12)",
                  background: "rgba(245,243,255,0.75)",
                  padding: "12px 12px",
                  textAlign: "right",
                  color: "#6b5b9a",
                  lineHeight: 1.6,
                }}
              >
                {!paymentReadyTimedOut ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 13 }}>
                      אחרי שסיימת את התשלום - אנחנו מעבירים אותך לדשבורד אוטומטית (בערך דקה).
                    </div>
                    <div aria-hidden style={{ display: "flex", gap: 6 }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: "#7133da",
                          opacity: 0.85,
                          animation: "bounceDot 0.55s ease-in-out infinite",
                        }}
                      />
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: "#7133da",
                          opacity: 0.65,
                          animation: "bounceDot 0.55s ease-in-out infinite",
                          animationDelay: "0.15s",
                        }}
                      />
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: "#7133da",
                          opacity: 0.45,
                          animation: "bounceDot 0.55s ease-in-out infinite",
                          animationDelay: "0.3s",
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 13 }}>
                      משהו תקע, פנו אלינו בוואטסאפ ונבדוק את זה איתכם.
                    </div>
                    <a
                      href={WHATSAPP_HELP_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="פנייה לוואטסאפ"
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 999,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "#25D366",
                        boxShadow: "0 10px 24px rgba(37, 211, 102, 0.24)",
                        border: "1px solid rgba(0,0,0,0.06)",
                        flexShrink: 0,
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
                        <path
                          fill="white"
                          d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
                        />
                      </svg>
                    </a>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingContent />
    </Suspense>
  );
}

