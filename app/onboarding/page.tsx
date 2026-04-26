"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

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
  const requestedPlan = (searchParams.get("plan") || "starter").toLowerCase();
  const [selectedPlan, setSelectedPlan] = useState<Plan>(requestedPlan === "pro" ? "pro" : "starter");
  const [planMenuOpen, setPlanMenuOpen] = useState(false);
  const planPickerRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState<Step>(1);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [loadingPayment, setLoadingPayment] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [existingModal, setExistingModal] = useState<
    null | { next: string; title: string; body: string; msg: string }
  >(null);
  const emailCheckRef = useMemo(() => ({ ac: null as AbortController | null }), []);

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
    const email = String(rawEmail || "").trim().toLowerCase();
    if (!email || !email.includes("@")) return;
    try {
      emailCheckRef.ac?.abort();
      const ac = new AbortController();
      emailCheckRef.ac = ac;
      const res = await fetch(`/api/onboarding/email-status?email=${encodeURIComponent(email)}`, {
        method: "GET",
        cache: "no-store",
        signal: ac.signal,
      });
      const data = (await res.json().catch(() => ({}))) as { state?: string; slug?: string | null };
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
    } catch {
      // ignore
    }
  }

  async function goToPayment() {
    setLoadingPayment(true);
    try {
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
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "40px 20px",
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
      <a href="/" style={{ marginBottom: "32px" }}>
        <img src="/heyzoe-logo.png" alt="HeyZoe" style={{ height: "36px" }} />
      </a>

      <div
        style={{
          width: "100%",
          maxWidth: "480px",
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

        <div style={{ padding: "32px 28px" }}>
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
            <div>
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
                  <label style={labelStyle}>שם פרטי</label>
                  <input
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
                  <label style={labelStyle}>שם משפחה</label>
                  <input
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
                <label style={labelStyle}>טלפון</label>
                <input
                  style={{ ...inputStyle, borderColor: errors.phone ? "#e24b4a" : "#e8e4f8" }}
                  value={form.phone}
                  onChange={(e) => update("phone", e.target.value)}
                  placeholder="050-0000000"
                  type="tel"
                  name="phone"
                  autoComplete="tel"
                />
                {errors.phone ? <span style={{ fontSize: "12px", color: "#e24b4a" }}>{errors.phone}</span> : null}
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={labelStyle}>אימייל</label>
                <input
                  style={{ ...inputStyle, borderColor: errors.email ? "#e24b4a" : "#e8e4f8" }}
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  onBlur={(e) => void checkExistingEmailIfNeeded(e.target.value)}
                  placeholder="israel@studio.co.il"
                  type="email"
                  name="email"
                  autoComplete="email"
                />
                {errors.email ? <span style={{ fontSize: "12px", color: "#e24b4a" }}>{errors.email}</span> : null}
              </div>

              <div style={{ marginBottom: "28px" }}>
                <label style={labelStyle}>סיסמה</label>
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
                style={btnPrimary}
                onClick={() => {
                  if (validateStep1()) setStep(2);
                }}
              >
                המשך
              </button>
            </div>
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
                  style={{
                    width: "100%",
                    maxWidth: "100%",
                    overflowX: "hidden",
                    overflowY: "visible",
                    borderRadius: "12px",
                    background: "#f0eef8",
                    lineHeight: 0,
                  }}
                >
                  <iframe
                    src={iframeUrl}
                    title="דף תשלום מאובטח"
                    style={{
                      width: "100%",
                      maxWidth: "100%",
                      minWidth: 0,
                      height: "min(78vh, 800px)",
                      minHeight: "560px",
                      border: "none",
                      borderRadius: "12px",
                      display: "block",
                    }}
                  />
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "60px 0", color: "#8b7aaa" }}>
                  טוען דף תשלום...
                </div>
              )}

              <div style={{ textAlign: "center", marginTop: "12px", fontSize: "12px", color: "#aaa" }}>
                🔒 תשלום מאובטח דרך iCount
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

