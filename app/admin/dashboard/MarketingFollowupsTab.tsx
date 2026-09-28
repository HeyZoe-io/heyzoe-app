"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  MARKETING_FOLLOWUP_BUTTON_TEXT_MAX,
  MARKETING_FOLLOWUP_PLAIN_TEXT_MAX,
} from "@/lib/marketing-followup-config";

const PURPLE = "#7133da";
const MUTED = "#6b5b9a";

type StageDraft = {
  delayMinutes: number;
  text: string;
  enabled: boolean;
};

const STAGE_HINTS = [
  "הודעת טקסט, בלי כפתור.",
  "נשלחת עם כפתור «נציג אנושי».",
  "הודעה אחרונה, עם כפתור «נציג אנושי».",
] as const;

function splitDelay(totalMinutes: number): { hours: number; minutes: number } {
  const safe = Number.isFinite(totalMinutes) ? Math.max(0, Math.floor(totalMinutes)) : 0;
  return { hours: Math.floor(safe / 60), minutes: safe % 60 };
}

function joinDelay(hours: number, minutes: number): number {
  const h = Number.isFinite(hours) ? Math.max(0, Math.floor(hours)) : 0;
  const m = Number.isFinite(minutes) ? Math.max(0, Math.min(59, Math.floor(minutes))) : 0;
  return h * 60 + m;
}

export default function MarketingFollowupsTab({
  onDirtyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [stages, setStages] = useState<StageDraft[]>([]);
  const [sendWindow, setSendWindow] = useState("");
  const [usingDefaults, setUsingDefaults] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [schemaNotice, setSchemaNotice] = useState("");
  const [baseline, setBaseline] = useState("");

  const snapshot = JSON.stringify(stages);
  const dirty = baseline !== "" && snapshot !== baseline;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadErr("");
      setSchemaNotice("");
      try {
        const r = await fetch("/api/admin/marketing/followups", { method: "GET", cache: "no-store" });
        const j = (await r.json()) as {
          stages?: Array<{ delay_minutes?: number; text?: string; enabled?: boolean }>;
          using_defaults?: boolean;
          send_window?: string;
          error?: string;
          notice?: string;
        };
        if (cancelled) return;
        if (!r.ok) {
          setLoadErr(j.error?.trim() || `שגיאת טעינה (${r.status})`);
          return;
        }
        const next: StageDraft[] = (j.stages ?? []).slice(0, 3).map((s) => ({
          delayMinutes: Number(s.delay_minutes) || 0,
          text: String(s.text ?? ""),
          enabled: s.enabled !== false,
        }));
        setStages(next);
        setBaseline(JSON.stringify(next));
        setUsingDefaults(Boolean(j.using_defaults));
        setSendWindow(String(j.send_window ?? ""));
        if (j.notice === "missing_column") {
          setSchemaNotice(
            "בבסיס הנתונים חסרה עמודת הפולואפים — מוצגות ברירות מחדל. הריצו את הקובץ supabase/marketing_flow_settings_followups.sql ואז שמרו כאן."
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

  const patchStage = useCallback((index: number, patch: Partial<StageDraft>) => {
    setStages((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setSaveMsg(null);
  }, []);

  const save = useCallback(async () => {
    setSaveMsg(null);
    setSaving(true);
    try {
      const payload = {
        stages: stages.map((s) => ({
          delay_minutes: s.delayMinutes,
          text: s.text,
          enabled: s.enabled,
        })),
      };
      const r = await fetch("/api/admin/marketing/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        stages?: Array<{ delay_minutes?: number; text?: string; enabled?: boolean }>;
        using_defaults?: boolean;
      };
      if (!r.ok) {
        setSaveMsg(j.error?.trim() || `שגיאת שמירה (${r.status})`);
        return;
      }
      const saved: StageDraft[] = (j.stages ?? []).slice(0, 3).map((s) => ({
        delayMinutes: Number(s.delay_minutes) || 0,
        text: String(s.text ?? ""),
        enabled: s.enabled !== false,
      }));
      setStages(saved);
      setBaseline(JSON.stringify(saved));
      setUsingDefaults(Boolean(j.using_defaults));
      setSaveMsg("נשמר. הקרון הבא ישלח לפי הזמנים האלה, ורק בתוך חלון השליחה.");
    } catch {
      setSaveMsg("שגיאת רשת בשמירה.");
    } finally {
      setSaving(false);
    }
  }, [stages]);

  if (loading) {
    return (
      <p style={{ margin: 0, fontSize: 14, color: MUTED, textAlign: "right" }}>טוען פולואפים…</p>
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
        <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 600, color: "#1a0a3c" }}>פולואפים</h2>
        <p style={{ margin: 0, fontSize: 14, color: MUTED, lineHeight: 1.55 }}>
          שלוש הודעות שזואי אדמין שולחת לליד שלא ענה, מהודעת המשתמש האחרונה. פולואפ 2 ו־3 כוללים כפתור «נציג
          אנושי». הקרון רץ בערך כל 5 דקות, כך שהשליחה בפועל יכולה לאחר עד כ־5 דקות אחרי הזמן שהגדרתם.
        </p>
        {sendWindow ? (
          <p
            style={{
              margin: "12px 0 0",
              fontSize: 13,
              lineHeight: 1.55,
              color: "#1a0a3c",
              background: "rgba(113,51,218,0.08)",
              borderRadius: 12,
              padding: "10px 12px",
            }}
          >
            {sendWindow}
          </p>
        ) : null}
        {usingDefaults ? (
          <p style={{ margin: "10px 0 0", fontSize: 13, color: "#854d0e", lineHeight: 1.5 }}>
            מוצגות ברירות מחדל (10 דקות, שעתיים, 23 שעות) שעדיין לא נשמרו בנפרד. לחצו «שמור» כדי לשמר אותן.
          </p>
        ) : null}
      </div>

      {stages.map((stage, i) => {
        const delay = splitDelay(stage.delayMinutes);
        const maxChars = i === 0 ? MARKETING_FOLLOWUP_PLAIN_TEXT_MAX : MARKETING_FOLLOWUP_BUTTON_TEXT_MAX;
        return (
          <section
            key={i}
            style={{
              border: "1px solid rgba(113,51,218,0.18)",
              borderRadius: 16,
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              opacity: stage.enabled ? 1 : 0.72,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 650, color: "#1a0a3c" }}>פולואפ {i + 1}</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{STAGE_HINTS[i]}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={stage.enabled}
                onClick={() => patchStage(i, { enabled: !stage.enabled })}
                style={{
                  borderRadius: 999,
                  border: stage.enabled ? "1px solid #a7f3d0" : "1px solid #e4e4e7",
                  background: stage.enabled ? "#ecfdf5" : "#fff",
                  color: stage.enabled ? "#047857" : "#52525b",
                  padding: "6px 12px",
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {stage.enabled ? "פעיל" : "כבוי"}
              </button>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                <span>שעות אחרי השתיקה</span>
                <input
                  type="number"
                  min={0}
                  max={168}
                  value={delay.hours}
                  onChange={(e) =>
                    patchStage(i, { delayMinutes: joinDelay(Number(e.target.value), delay.minutes) })
                  }
                  style={inputStyle}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                <span>דקות</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={delay.minutes}
                  onChange={(e) =>
                    patchStage(i, { delayMinutes: joinDelay(delay.hours, Number(e.target.value)) })
                  }
                  style={inputStyle}
                />
              </label>
              <span style={{ fontSize: 12, color: MUTED, paddingBottom: 8 }}>
                סה״כ {stage.delayMinutes} דקות מהודעת הליד האחרונה
              </span>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
              <span>
                טקסט{" "}
                <span style={{ color: MUTED }}>
                  ({stage.text.trim().length}/{maxChars})
                </span>
              </span>
              <textarea
                dir="rtl"
                rows={i === 0 ? 4 : 6}
                maxLength={maxChars}
                value={stage.text}
                onChange={(e) => patchStage(i, { text: e.target.value })}
                style={{
                  borderRadius: 12,
                  border: "1px solid rgba(113,51,218,0.22)",
                  padding: "8px 10px",
                  fontFamily: "inherit",
                  fontSize: 14,
                  lineHeight: 1.45,
                }}
              />
            </label>
          </section>
        );
      })}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          disabled={saving || Boolean(loadErr)}
          onClick={() => void save()}
          style={{
            borderRadius: 999,
            border: "1px solid rgba(113,51,218,0.25)",
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

const inputStyle: CSSProperties = {
  width: 88,
  borderRadius: 12,
  border: "1px solid rgba(113,51,218,0.22)",
  padding: "8px 10px",
  fontFamily: "inherit",
  fontSize: 14,
};
