"use client";

import { useMemo, useRef, useState } from "react";

type Step =
  | "idle"
  | "searching"
  | "purchasing"
  | "twiml"
  | "meta_register"
  | "meta_request_code"
  | "waiting_recording"
  | "transcribing"
  | "verifying"
  | "saving"
  | "awaiting_manual_code"
  | "done"
  | "error";

type ProgressEvent =
  | { type: "step"; step: Step; message?: string }
  | { type: "result"; status: "ok" | "awaiting_manual_code" | "error"; phone?: string; phone_number_id?: string; twilio_sid?: string; error?: string };

function parseSseChunk(line: string): ProgressEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const json = trimmed.slice("data:".length).trim();
  if (!json) return null;
  try {
    return JSON.parse(json) as ProgressEvent;
  } catch {
    return null;
  }
}

const stepOrder: Step[] = [
  "searching",
  "purchasing",
  "twiml",
  "meta_register",
  "meta_request_code",
  "waiting_recording",
  "transcribing",
  "verifying",
  "saving",
];

const stepLabel: Record<Step, string> = {
  idle: "ממתין…",
  searching: "מחפש מספר זמין…",
  purchasing: "רוכש מספר…",
  twiml: "מגדיר TwiML…",
  meta_register: "רושם מספר ב‑Meta…",
  meta_request_code: "שולח בקשת אימות ל‑Meta…",
  waiting_recording: "ממתין להקלטה…",
  transcribing: "מתמלל קוד…",
  verifying: "מאמת מול Meta…",
  saving: "שומר בסופאבייס…",
  awaiting_manual_code: "ממתין לקוד ידני…",
  done: "הושלם",
  error: "שגיאה",
};

export default function ProvisionNumberModal() {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [verifiedName, setVerifiedName] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [status, setStatus] = useState<Step>("idle");
  const [phone, setPhone] = useState<string>("");
  const [phoneNumberId, setPhoneNumberId] = useState<string>("");
  const [twilioSid, setTwilioSid] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [log, setLog] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const pct = useMemo(() => {
    const idx = stepOrder.indexOf(status);
    if (idx < 0) return status === "done" ? 100 : status === "awaiting_manual_code" ? 90 : status === "error" ? 0 : 0;
    return Math.round(((idx + 1) / stepOrder.length) * 100);
  }, [status]);

  function pushLog(s: string) {
    setLog((prev) => [s, ...prev].slice(0, 30));
  }

  async function runProvision() {
    setError("");
    setPhone("");
    setPhoneNumberId("");
    setTwilioSid("");
    setManualCode("");
    setLog([]);
    setStatus("searching");

    const controller = new AbortController();
    abortRef.current = controller;

    const body = {
      business_slug: slug.trim().toLowerCase(),
      verified_name: verifiedName.trim(),
    };

    try {
      const res = await fetch("/api/admin/provision-number", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `request_failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const ev = parseSseChunk(line);
          if (!ev) continue;
          if (ev.type === "step") {
            setStatus(ev.step);
            pushLog(ev.message || stepLabel[ev.step] || ev.step);
          } else if (ev.type === "result") {
            if (ev.phone) setPhone(ev.phone);
            if (ev.phone_number_id) setPhoneNumberId(ev.phone_number_id);
            if (ev.twilio_sid) setTwilioSid(ev.twilio_sid);
            if (ev.status === "ok") {
              setStatus("done");
              pushLog(`הצלחה: ${ev.phone || ""}`.trim());
            } else if (ev.status === "awaiting_manual_code") {
              setStatus("awaiting_manual_code");
              pushLog("נדרש קוד אימות ידני");
            } else {
              setStatus("error");
              setError(ev.error || "שגיאה");
              pushLog(ev.error || "שגיאה");
            }
          }
        }
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
    }
  }

  async function submitManualCode() {
    setError("");
    const code = manualCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setError("נא להזין קוד בן 6 ספרות.");
      return;
    }
    if (!phoneNumberId) {
      setError("חסר phone_number_id.");
      return;
    }

    setStatus("verifying");
    pushLog("מאמת מול Meta (ידני)…");
    try {
      const res = await fetch("/api/admin/provision-number/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone_number_id: phoneNumberId,
          code,
          business_slug: slug.trim().toLowerCase(),
          phone_display: phone || null,
          twilio_sid: twilioSid || null,
        }),
      });
      const j = (await res.json().catch(() => null)) as any;
      if (!res.ok || !j?.ok) {
        throw new Error(String(j?.error || `verify_failed (${res.status})`));
      }
      setStatus("done");
      pushLog("אומת בהצלחה");
    } catch (e) {
      setStatus("awaiting_manual_code");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const canRun = slug.trim().length >= 2 && verifiedName.trim().length >= 2 && (status === "idle" || status === "done" || status === "error");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          cursor: "pointer",
          color: "#7133da",
          fontWeight: 400,
          fontSize: 12,
          border: "1px solid rgba(113,51,218,0.18)",
          background: "white",
          borderRadius: 999,
          padding: "6px 10px",
        }}
      >
        הוסף מספר חדש
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            style={{
              width: "min(760px, 100%)",
              background: "white",
              borderRadius: 18,
              border: "1px solid rgba(113,51,218,0.14)",
              boxShadow: "0 12px 50px rgba(0,0,0,0.18)",
              padding: 16,
              direction: "rtl",
              fontFamily: "Fredoka, Heebo, system-ui, sans-serif",
              color: "#1a0a3c",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 400 }}>הוסף מספר WhatsApp חדש</div>
                <div style={{ marginTop: 4, fontSize: 13, color: "#6b5b9a" }}>פרוויז׳ן אוטומטי דרך Twilio + Meta</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{ border: "none", background: "transparent", cursor: "pointer", color: "#6b5b9a", fontWeight: 400 }}
              >
                סגור
              </button>
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <label style={{ fontSize: 12, color: "#6b5b9a" }}>slug של העסק</label>
                <input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="example-studio"
                  style={{
                    height: 38,
                    borderRadius: 12,
                    border: "1px solid rgba(113,51,218,0.18)",
                    padding: "0 12px",
                    fontWeight: 400,
                    outline: "none",
                  }}
                />
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <label style={{ fontSize: 12, color: "#6b5b9a" }}>שם העסק (verified_name ב‑Meta)</label>
                <input
                  value={verifiedName}
                  onChange={(e) => setVerifiedName(e.target.value)}
                  placeholder="שם העסק"
                  style={{
                    height: 38,
                    borderRadius: 12,
                    border: "1px solid rgba(113,51,218,0.18)",
                    padding: "0 12px",
                    fontWeight: 400,
                    outline: "none",
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
                <button
                  type="button"
                  disabled={!canRun}
                  onClick={() => void runProvision()}
                  style={{
                    height: 38,
                    padding: "0 14px",
                    borderRadius: 999,
                    border: "1px solid rgba(113,51,218,0.18)",
                    background: canRun ? "linear-gradient(135deg,#7133da,#ff92ff)" : "rgba(0,0,0,0.05)",
                    color: canRun ? "white" : "#6b5b9a",
                    fontWeight: 400,
                    cursor: canRun ? "pointer" : "not-allowed",
                  }}
                >
                  רכוש והגדר מספר אוטומטית
                </button>
                <div style={{ fontSize: 12, color: "#6b5b9a" }}>{stepLabel[status]}</div>
              </div>

              <div style={{ height: 10, background: "#f5f3ff", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(135deg,#7133da,#ff92ff)" }} />
              </div>

              {phone ? (
                <div style={{ fontSize: 13, color: "#1a0a3c" }}>
                  מספר: <span dir="ltr">{phone}</span>
                </div>
              ) : null}

              {status === "awaiting_manual_code" ? (
                <div style={{ display: "grid", gap: 8, padding: 12, borderRadius: 14, border: "1px solid rgba(113,51,218,0.12)", background: "rgba(245,243,255,0.65)" }}>
                  <div style={{ fontSize: 12, color: "#6b5b9a" }}>הזנת קוד אימות (ידני)</div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      value={manualCode}
                      onChange={(e) => setManualCode(e.target.value)}
                      placeholder="123456"
                      inputMode="numeric"
                      style={{
                        height: 38,
                        borderRadius: 12,
                        border: "1px solid rgba(113,51,218,0.18)",
                        padding: "0 12px",
                        fontWeight: 400,
                        outline: "none",
                        width: 140,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void submitManualCode()}
                      style={{
                        height: 38,
                        padding: "0 14px",
                        borderRadius: 999,
                        border: "1px solid rgba(113,51,218,0.18)",
                        background: "white",
                        color: "#7133da",
                        fontWeight: 400,
                        cursor: "pointer",
                      }}
                    >
                      אמת קוד
                    </button>
                  </div>
                </div>
              ) : null}

              {error ? <div style={{ fontSize: 13, color: "#c81e5b" }}>{error}</div> : null}

              {log.length ? (
                <div style={{ marginTop: 4, fontSize: 12, color: "#6b5b9a", lineHeight: 1.6 }}>
                  {log.map((x, i) => (
                    <div key={i}>{x}</div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

