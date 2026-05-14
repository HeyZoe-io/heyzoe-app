"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildFactQuestions, factFromQuestionAnswer } from "@/lib/fact-questions";

const PURPLE = "#7133da";
const MUTED = "#6b5b9a";
const AUTOSAVE_MS = 900;

function normalizeFactRows(arr: string[]): string[] {
  const t = arr.map((s) => String(s ?? ""));
  if (t.length === 0) return ["", "", ""];
  if (t.length < 3) return [...t, ...Array(3 - t.length).fill("")];
  return t;
}

function factPlaceholder(index: number): string {
  if (index === 0) return "למשל: HeyZoe מחברת עוזרת וואטסאפ לעסקים קטנים";
  if (index === 1) return "למשל: תמיכה בעברית, מחירים החל מ־…";
  return "עובדה נוספת…";
}

export default function MarketingOpenQuestionsTab() {
  const [traits, setTraits] = useState<string[]>(["", "", ""]);
  const [supportPhone, setSupportPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const lastPersistedSnapshotRef = useRef<string | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<(fromAuto?: boolean) => Promise<void>>(async () => {});

  const factQuestions = useMemo(
    () =>
      buildFactQuestions({
        traits,
        directionsText: "",
        promotionsText: "",
        servicesText: "",
        addressText: "",
      }),
    [traits]
  );

  const [factAnswers, setFactAnswers] = useState<Record<string, string>>({});
  const [factQuestionIdx, setFactQuestionIdx] = useState(0);

  useEffect(() => {
    setFactQuestionIdx((i) => {
      if (factQuestions.length === 0) return 0;
      return Math.max(0, Math.min(i, factQuestions.length - 1));
    });
  }, [factQuestions.length]);

  const addFactLine = useCallback((value: string) => {
    const v = String(value ?? "").trim();
    if (!v) return;
    setTraits((prev) => {
      const next = [...prev];
      const emptyIndex = next.findIndex((x) => !String(x ?? "").trim());
      if (emptyIndex >= 0) {
        next[emptyIndex] = v;
        return next;
      }
      next.push(v);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadErr("");
      try {
        const r = await fetch("/api/admin/marketing/open-facts", { method: "GET", cache: "no-store" });
        const j = (await r.json()) as { facts?: string[]; marketing_support_phone?: string; error?: string };
        if (cancelled) return;
        if (!r.ok) {
          setLoadErr(j.error?.trim() || `שגיאת טעינה (${r.status})`);
          return;
        }
        const rows = Array.isArray(j.facts) ? j.facts.map((x) => String(x ?? "")) : [];
        setTraits(normalizeFactRows(rows.length ? rows : ["", "", ""]));
        setSupportPhone(String(j.marketing_support_phone ?? "").trim());
      } catch {
        if (!cancelled) setLoadErr("בעיית רשת בטעינה.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(
    async (fromAuto = false) => {
      if (!fromAuto) {
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
          autoSaveTimerRef.current = null;
        }
        setSaveMsg(null);
      }
      setSaving(true);
      try {
        const facts = traits.map((s) => s.trim()).filter(Boolean);
        const r = await fetch("/api/admin/marketing/open-facts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            facts,
            marketing_support_phone: supportPhone.trim(),
          }),
        });
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!r.ok) {
          setSaveMsg(j.error?.trim() || `שגיאת שמירה (${r.status})`);
          return;
        }
        lastPersistedSnapshotRef.current = JSON.stringify({
          traits,
          supportPhone,
        });
        setSaveMsg(fromAuto ? "נשמר אוטומטית" : "נשמר");
      } catch {
        setSaveMsg("שגיאת רשת בשמירה.");
      } finally {
        setSaving(false);
      }
    },
    [supportPhone, traits]
  );

  saveRef.current = save;

  useEffect(() => {
    if (loading) {
      lastPersistedSnapshotRef.current = null;
      return;
    }
    if (loadErr) return;

    const snap = JSON.stringify({ traits, supportPhone });
    if (lastPersistedSnapshotRef.current === null) {
      lastPersistedSnapshotRef.current = snap;
      return;
    }
    if (snap === lastPersistedSnapshotRef.current) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      void saveRef.current(true);
    }, AUTOSAVE_MS);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [traits, supportPhone, loading, loadErr]);

  if (loading) {
    return (
      <p style={{ margin: 0, fontSize: 14, color: MUTED, textAlign: "right" }}>
        טוען עובדות…
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, textAlign: "right", direction: "rtl" }}>
      {loadErr ? (
        <p style={{ margin: 0, fontSize: 13, color: "#b42318" }} role="alert">
          {loadErr}
        </p>
      ) : null}

      <div>
        <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 600, color: "#1a0a3c" }}>שאלות פתוחות</h2>
        <p style={{ margin: 0, fontSize: 14, color: MUTED, lineHeight: 1.55 }}>
          עובדות שאפשר לכתוב כאן — זואי תשתמש בהן כדי לענות על שאלות פתוחות אחרי סיום הפלואו השיווקי (בדומה
          ל־«כל העובדות שכדאי לציין על העסק» בדשבורד בעל העסק, כולל שאלות מוצעות שמזהות פערים בטקסט). השינויים נשמרים
          אוטומטית; אפשר גם ללחוץ «שמור» לשמירה מיידית.
        </p>
      </div>

      <div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#1a0a3c", marginBottom: 6 }}>
          מספר וואטסאפ לשירות (לבניית קישור wa.me)
        </label>
        <input
          dir="ltr"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={supportPhone}
          onChange={(e) => setSupportPhone(e.target.value)}
          placeholder="+972501234567 או 050-123-4567"
          style={{
            width: "100%",
            maxWidth: 360,
            boxSizing: "border-box",
            borderRadius: 12,
            border: `1px solid rgba(113,51,218,0.22)`,
            padding: "8px 10px",
            fontFamily: "inherit",
            fontSize: 14,
            textAlign: "left",
          }}
        />
        <p style={{ margin: "6px 0 0", fontSize: 12, color: MUTED, lineHeight: 1.5 }}>
          כשאין תשובה בעובדות או כשמבקשים שירות אנושי — זואי תפנה עם{" "}
          <strong>קישור וואטסאפ</strong> (לא מספר גולמי). בקישור יוצמד טקסט קצר (כמה מילים מהודעת הליד) כדי
          שצוות השירות יבין את הנושא לפני השליחה. אם השדה ריק — לא תופיע הפניה אוטומטית.
        </p>
      </div>

      <div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#1a0a3c", marginBottom: 8 }}>
          עובדות
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {traits.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: MUTED, width: 22, textAlign: "center", flexShrink: 0 }}>{i + 1}</span>
              <input
                dir="rtl"
                value={row}
                onChange={(e) => {
                  const v = e.target.value;
                  setTraits((prev) => {
                    const next = [...prev];
                    next[i] = v;
                    return next;
                  });
                }}
                placeholder={factPlaceholder(i)}
                style={{
                  flex: 1,
                  borderRadius: 12,
                  border: `1px solid rgba(113,51,218,0.22)`,
                  padding: "8px 10px",
                  fontFamily: "inherit",
                  fontSize: 14,
                }}
              />
              {traits.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setTraits((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="הסר שורה"
                  style={{
                    flexShrink: 0,
                    border: "1px solid #e4e4e7",
                    background: "#fafafa",
                    borderRadius: 8,
                    padding: "6px 10px",
                    cursor: "pointer",
                    fontSize: 12,
                    color: "#71717a",
                  }}
                >
                  הסר
                </button>
              ) : (
                <span style={{ width: 52, flexShrink: 0 }} />
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setTraits((prev) => [...prev, ""])}
          style={{
            marginTop: 10,
            borderRadius: 10,
            border: `1px solid ${PURPLE}`,
            background: "#fff",
            color: PURPLE,
            padding: "6px 14px",
            fontFamily: "inherit",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          + שורת עובדה
        </button>
      </div>

      <div
        style={{
          borderRadius: 16,
          border: "1px solid rgba(113,51,218,0.22)",
          background: "rgba(113,51,218,0.06)",
          padding: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#2d1a6e" }}>שאלות מוצעות</p>
          {factQuestions.length > 1 ? (
            <button
              type="button"
              onClick={() =>
                setFactQuestionIdx((i) => (factQuestions.length ? (i + 1) % factQuestions.length : 0))
              }
              style={{
                borderRadius: 10,
                border: `1px solid rgba(113,51,218,0.25)`,
                background: "#fff",
                color: PURPLE,
                padding: "4px 12px",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              החלף שאלה
            </button>
          ) : null}
        </div>

        {factQuestions.length ? (
          (() => {
            const q = factQuestions[factQuestionIdx] ?? factQuestions[0]!;
            return (
              <div
                style={{
                  marginTop: 12,
                  borderRadius: 12,
                  border: "1px solid rgba(113,51,218,0.18)",
                  background: "rgba(255,255,255,0.92)",
                  padding: 12,
                }}
              >
                <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 500, color: "#1a0a3c" }}>{q.question}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input
                    dir="rtl"
                    value={factAnswers[q.id] ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFactAnswers((m) => ({ ...m, [q.id]: v }));
                    }}
                    placeholder={q.placeholder}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      borderRadius: 10,
                      border: `1px solid rgba(113,51,218,0.2)`,
                      padding: "8px 10px",
                      fontFamily: "inherit",
                      fontSize: 14,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      addFactLine(factFromQuestionAnswer(q.question, factAnswers[q.id] ?? ""));
                      if (factQuestions.length > 1) {
                        setFactQuestionIdx((i) => (i + 1) % factQuestions.length);
                      }
                    }}
                    style={{
                      alignSelf: "flex-start",
                      borderRadius: 10,
                      border: `1px solid ${PURPLE}`,
                      background: PURPLE,
                      color: "#fff",
                      padding: "6px 14px",
                      fontSize: 13,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    + הוסף לעובדות
                  </button>
                </div>
              </div>
            );
          })()
        ) : (
          <p style={{ margin: "10px 0 0", fontSize: 13, color: MUTED }}>
            אין כרגע שאלות מוצעות — המשיכו למלא עובדות בשורות למעלה.
          </p>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save(false)}
          style={{
            borderRadius: 999,
            border: `1px solid rgba(113,51,218,0.25)`,
            background: saving ? "rgba(113,51,218,0.45)" : `linear-gradient(135deg,${PURPLE},#ff92ff)`,
            color: "#fff",
            padding: "10px 22px",
            fontFamily: "inherit",
            fontSize: 14,
            fontWeight: 600,
            cursor: saving ? "wait" : "pointer",
          }}
        >
          {saving ? "שומר…" : "שמור"}
        </button>
        {saveMsg ? (
          <span style={{ fontSize: 13, color: saveMsg.startsWith("נשמר") ? "#0b5c2e" : "#b42318" }}>{saveMsg}</span>
        ) : null}
        <span style={{ fontSize: 12, color: "#a89bc4" }}>שמירה אוטומטית אחרי הקלדה (~{Math.round(AUTOSAVE_MS / 1000)} שנ׳)</span>
      </div>
    </div>
  );
}
