"use client";

import { useCallback, useEffect, useState } from "react";

const PURPLE = "#7133da";
const MUTED = "#6b5b9a";

export default function MarketingLegalityTab() {
  const [lines, setLines] = useState<string[]>([]);
  const [usingDefaults, setUsingDefaults] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [schemaNotice, setSchemaNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadErr("");
      setSchemaNotice("");
      try {
        const r = await fetch("/api/admin/marketing/legal-guidelines", { method: "GET", cache: "no-store" });
        const j = (await r.json()) as {
          lines?: string[];
          using_defaults?: boolean;
          error?: string;
          notice?: string;
        };
        if (cancelled) return;
        if (!r.ok) {
          setLoadErr(j.error?.trim() || `שגיאת טעינה (${r.status})`);
          return;
        }
        const arr = Array.isArray(j.lines) ? j.lines.map((x) => String(x ?? "")) : [];
        setLines(arr.length ? arr : [""]);
        setUsingDefaults(Boolean(j.using_defaults));
        if (j.notice === "missing_column") {
          setSchemaNotice(
            "בבסיס הנתונים חסרה עמודת החוקיות — מוצגות ברירות מחדל. הריצו את הקובץ supabase/marketing_flow_settings_legal_guidelines.sql ואז שמרו כאן."
          );
        }
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

  const save = useCallback(async () => {
    setSaveMsg(null);
    setSaving(true);
    try {
      const payload = lines.map((s) => s.trim()).filter(Boolean);
      const r = await fetch("/api/admin/marketing/legal-guidelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: payload }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        lines?: string[];
        using_defaults?: boolean;
      };
      if (!r.ok) {
        setSaveMsg(j.error?.trim() || `שגיאת שמירה (${r.status})`);
        return;
      }
      const saved = Array.isArray(j.lines) ? j.lines : payload;
      setLines(saved.length ? saved : [""]);
      setUsingDefaults(Boolean((j as { using_defaults?: boolean }).using_defaults));
      setSaveMsg("נשמר");
    } catch {
      setSaveMsg("שגיאת רשת בשמירה.");
    } finally {
      setSaving(false);
    }
  }, [lines]);

  if (loading) {
    return (
      <p style={{ margin: 0, fontSize: 14, color: MUTED, textAlign: "right" }}>
        טוען חוקיות…
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, textAlign: "right", direction: "rtl" }}>
      {schemaNotice ? (
        <p style={{ margin: 0, fontSize: 13, color: "#854d0e", lineHeight: 1.5 }} role="status">
          {schemaNotice}
        </p>
      ) : null}
      {loadErr ? (
        <p style={{ margin: 0, fontSize: 13, color: "#b42318" }} role="alert">
          {loadErr}
        </p>
      ) : null}

      <div>
        <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 600, color: "#1a0a3c" }}>חוקיות</h2>
        <p style={{ margin: 0, fontSize: 14, color: MUTED, lineHeight: 1.55 }}>
          כאן מגדירים במילים פשוטות איך זואי של קו השיווק מתנהגת אחרי סיום הפלואו. ברירת המחדל משקפת את ההנחיות
          שהיו קודם במערכת — אפשר לערוך, למחוק שורות ולהוסיף שורות. לחיצה על «שמור» שומרת בבסיס הנתונים ומעדכנת
          את זואי בשיחות הבאות.
        </p>
        {usingDefaults ? (
          <p style={{ margin: "10px 0 0", fontSize: 13, color: "#854d0e", lineHeight: 1.5 }}>
            מוצגות כרגע ברירות מחדל (עדיין לא נשמרו בנפרד בבסיס הנתונים). לחצו «שמור» כדי לשמר את הגרסה הנוכחית.
          </p>
        ) : null}
      </div>

      <div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#1a0a3c", marginBottom: 8 }}>
          שורות חוקיות
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {lines.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: MUTED, width: 22, textAlign: "center", flexShrink: 0 }}>{i + 1}</span>
              <input
                dir="rtl"
                value={row}
                onChange={(e) => {
                  const v = e.target.value;
                  setLines((prev) => {
                    const next = [...prev];
                    next[i] = v;
                    return next;
                  });
                }}
                placeholder="למשל: לא להבטיח החזר כספי בלי אישור משפטי"
                style={{
                  flex: 1,
                  borderRadius: 12,
                  border: `1px solid rgba(113,51,218,0.22)`,
                  padding: "8px 10px",
                  fontFamily: "inherit",
                  fontSize: 14,
                }}
              />
              {lines.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
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
          onClick={() => setLines((prev) => [...prev, ""])}
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
          + שורה חדשה
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
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
      </div>
    </div>
  );
}
