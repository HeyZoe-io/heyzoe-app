"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ZoePlatformCategory, ZoePlatformGuidelines } from "@/lib/business-zoe-platform-types";

const PURPLE = "#7133da";
const MUTED = "#6b5b9a";

function newCategoryId(): string {
  return `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export default function ZoeGuidelinesClient() {
  const [categories, setCategories] = useState<ZoePlatformCategory[]>([]);
  const [usingDefaults, setUsingDefaults] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [schemaNotice, setSchemaNotice] = useState("");
  const lastPersistedRef = useRef<string | null>(null);
  const categoriesRef = useRef<ZoePlatformCategory[]>([]);
  categoriesRef.current = categories;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadErr("");
      setSchemaNotice("");
      try {
        const r = await fetch("/api/admin/zoe-guidelines", { method: "GET", cache: "no-store" });
        const j = (await r.json()) as {
          guidelines?: ZoePlatformGuidelines;
          using_defaults?: boolean;
          error?: string;
          notice?: string;
        };
        if (cancelled) return;
        if (!r.ok) {
          setLoadErr(j.error?.trim() || `שגיאת טעינה (${r.status})`);
          return;
        }
        const cats = Array.isArray(j.guidelines?.categories) ? j.guidelines!.categories : [];
        setCategories(cats.length ? cats : []);
        setUsingDefaults(Boolean(j.using_defaults));
        if (j.notice === "missing_table") {
          setSchemaNotice(
            "חסרה טבלת zoe_platform_settings — מוצגות ברירות מחדל. הריצו supabase/zoe_platform_settings.sql ואז שמרו."
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

  const save = useCallback(async (fromAuto = false) => {
    if (!fromAuto) setSaveMsg(null);
    const snapshot = categoriesRef.current;
    setSaving(true);
    try {
      const r = await fetch("/api/admin/zoe-guidelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guidelines: { categories: snapshot } }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        guidelines?: ZoePlatformGuidelines;
        using_defaults?: boolean;
      };
      if (!r.ok) {
        setSaveMsg(j.error?.trim() || `שגיאת שמירה (${r.status})`);
        return;
      }
      const saved = j.guidelines?.categories?.length ? j.guidelines.categories : snapshot;
      if (!fromAuto) {
        setCategories(saved);
      }
      setUsingDefaults(false);
      if (JSON.stringify(categoriesRef.current) === JSON.stringify(snapshot)) {
        lastPersistedRef.current = JSON.stringify(snapshot);
        setSaveMsg(fromAuto ? "נשמר אוטומטית" : "נשמר");
      }
    } catch {
      setSaveMsg("שגיאת רשת בשמירה.");
    } finally {
      setSaving(false);
    }
  }, []);

  const saveIfDirty = useCallback(async () => {
    if (loading || loadErr) return;
    const snap = JSON.stringify(categories);
    if (lastPersistedRef.current === null) return;
    if (snap === lastPersistedRef.current) return;
    await save(true);
  }, [categories, loading, loadErr, save]);

  useEffect(() => {
    if (loading) {
      lastPersistedRef.current = null;
      return;
    }
    if (loadErr) return;
    const snap = JSON.stringify(categories);
    if (lastPersistedRef.current === null) lastPersistedRef.current = snap;
  }, [categories, loading, loadErr]);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState !== "hidden") return;
      void saveIfDirty();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [saveIfDirty]);

  useEffect(() => {
    const onWinBlur = () => void saveIfDirty();
    window.addEventListener("blur", onWinBlur);
    return () => window.removeEventListener("blur", onWinBlur);
  }, [saveIfDirty]);

  const updateCategory = (index: number, patch: Partial<ZoePlatformCategory>) => {
    setCategories((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const updateLine = (catIndex: number, lineIndex: number, value: string) => {
    setCategories((prev) => {
      const next = [...prev];
      const lines = [...next[catIndex].lines];
      lines[lineIndex] = value;
      next[catIndex] = { ...next[catIndex], lines };
      return next;
    });
  };

  if (loading) {
    return <p style={{ margin: 0, fontSize: 14, color: MUTED, textAlign: "right" }}>טוען הנחיות זואי…</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, textAlign: "right", direction: "rtl" }}>
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
        <p style={{ margin: 0, fontSize: 14, color: MUTED, lineHeight: 1.55 }}>
          כאן מגדירים את האופי, החוקיות ומבנה התשובות של <strong style={{ color: "#1a0a3c" }}>זואי בבעלי העסקים</strong>{" "}
          (צ׳אט באתר ווואטסאפ ללקוחות העסק) — לא זואי שיווק אדמין. כל קטגוריה נשלחת לפרומפט המערכת. אפשר לערוך,
          להוסיף שורות וליצור קטגוריות חדשות.
        </p>
        {usingDefaults ? (
          <p style={{ margin: "10px 0 0", fontSize: 13, color: "#854d0e", lineHeight: 1.5 }}>
            מוצגות ברירות מחדל מהקוד. לחצו «שמור» כדי לשמר בבסיס הנתונים.
          </p>
        ) : null}
      </div>

      {categories.map((cat, ci) => (
        <section
          key={cat.id}
          style={{
            background: "#fff",
            border: "1px solid rgba(113,51,218,0.16)",
            borderRadius: 16,
            padding: 16,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 10 }}>
            <input
              value={cat.title}
              onChange={(e) => updateCategory(ci, { title: e.target.value })}
              onBlur={() => void saveIfDirty()}
              placeholder="שם קטגוריה"
              style={{
                flex: "1 1 200px",
                fontWeight: 600,
                fontSize: 16,
                borderRadius: 10,
                border: `1px solid rgba(113,51,218,0.22)`,
                padding: "8px 10px",
                fontFamily: "inherit",
              }}
            />
            <span style={{ fontSize: 11, color: MUTED, fontFamily: "monospace", direction: "ltr" }}>{cat.id}</span>
            {cat.id.startsWith("custom_") ? (
              <button
                type="button"
                onClick={() => setCategories((prev) => prev.filter((_, i) => i !== ci))}
                style={{
                  border: "1px solid #e4e4e7",
                  background: "#fafafa",
                  borderRadius: 8,
                  padding: "6px 10px",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                מחק קטגוריה
              </button>
            ) : null}
          </div>
          <textarea
            value={cat.description}
            onChange={(e) => updateCategory(ci, { description: e.target.value })}
            onBlur={() => void saveIfDirty()}
            rows={2}
            placeholder="תיאור קצר לקטגוריה (לעזרה בדשבורד)"
            style={{
              width: "100%",
              boxSizing: "border-box",
              marginBottom: 12,
              borderRadius: 10,
              border: `1px solid rgba(113,51,218,0.15)`,
              padding: 8,
              fontFamily: "inherit",
              fontSize: 13,
              color: MUTED,
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {cat.lines.map((line, li) => (
              <div key={li} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontSize: 12, color: MUTED, width: 22, textAlign: "center", flexShrink: 0, marginTop: 10 }}>
                  {li + 1}
                </span>
                <textarea
                  dir="rtl"
                  rows={2}
                  value={line}
                  onChange={(e) => updateLine(ci, li, e.target.value)}
                  onBlur={() => void saveIfDirty()}
                  placeholder="שורת הנחיה…"
                  style={{
                    flex: 1,
                    borderRadius: 10,
                    border: `1px solid rgba(113,51,218,0.2)`,
                    padding: "8px 10px",
                    fontFamily: "inherit",
                    fontSize: 14,
                    resize: "vertical",
                  }}
                />
                <button
                  type="button"
                  onClick={() =>
                    setCategories((prev) => {
                      const next = [...prev];
                      const lines = next[ci].lines.filter((_, j) => j !== li);
                      next[ci] = { ...next[ci], lines: lines.length ? lines : [""] };
                      return next;
                    })
                  }
                  disabled={cat.lines.length <= 1}
                  style={{
                    flexShrink: 0,
                    marginTop: 6,
                    border: "1px solid #e4e4e7",
                    background: "#fafafa",
                    borderRadius: 8,
                    padding: "6px 10px",
                    cursor: cat.lines.length <= 1 ? "not-allowed" : "pointer",
                    fontSize: 12,
                    opacity: cat.lines.length <= 1 ? 0.5 : 1,
                  }}
                >
                  הסר
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setCategories((prev) => {
                const next = [...prev];
                next[ci] = { ...next[ci], lines: [...next[ci].lines, ""] };
                return next;
              })
            }
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
            + שורה בקטגוריה
          </button>
        </section>
      ))}

      <button
        type="button"
        onClick={() =>
          setCategories((prev) => [
            ...prev,
            {
              id: newCategoryId(),
              title: "קטגוריה חדשה",
              description: "",
              lines: [""],
            },
          ])
        }
        style={{
          alignSelf: "flex-start",
          borderRadius: 12,
          border: `2px dashed rgba(113,51,218,0.35)`,
          background: "rgba(113,51,218,0.06)",
          color: PURPLE,
          padding: "10px 18px",
          fontFamily: "inherit",
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        + קטגוריה חדשה
      </button>

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
        <span style={{ fontSize: 12, color: "#a89bc4" }}>שמירה אוטומטית ביציאה משדה / טאב / רקע</span>
      </div>
    </div>
  );
}
