"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { LeadQuestionsReport } from "@/lib/marketing-lead-questions";

const PURPLE = "#7133da";
const MUTED = "#6b5b9a";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function FlowStageChart({ stages }: { stages: LeadQuestionsReport["byFlowStage"] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  if (!stages.length) {
    return (
      <p style={{ margin: 0, fontSize: 14, color: MUTED, textAlign: "right" }}>
        אין עדיין נתונים לגרף — שאלות חדשות יופיעו אחרי שליחה לזואי שיווק אדמין.
      </p>
    );
  }

  return (
    <Box style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {stages.map((s) => {
        const pct = Math.round((s.count / max) * 100);
        return (
          <div key={s.stageKey} style={{ textAlign: "right" }}>
            <Box style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: MUTED, flexShrink: 0 }}>{s.count}</span>
              <span style={{ fontSize: 13, color: "#1a0a3c", lineHeight: 1.35 }}>{s.stageLabel}</span>
            </Box>
            <Box
              style={{
                height: 10,
                borderRadius: 999,
                background: "rgba(113,51,218,0.1)",
                overflow: "hidden",
              }}
            >
              <Box
                style={{
                  width: `${pct}%`,
                  minWidth: s.count > 0 ? 4 : 0,
                  height: "100%",
                  borderRadius: 999,
                  background: `linear-gradient(90deg, ${PURPLE}, #ff92ff)`,
                }}
              />
            </Box>
          </div>
        );
      })}
    </Box>
  );
}

function Box({ style, children }: { style?: CSSProperties; children?: ReactNode }) {
  return <div style={style}>{children}</div>;
}

export default function ZoeLeadQuestionsTab() {
  const [report, setReport] = useState<LeadQuestionsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadErr("");
      try {
        const r = await fetch("/api/admin/marketing/lead-questions", { cache: "no-store" });
        const j = (await r.json()) as LeadQuestionsReport & { error?: string };
        if (cancelled) return;
        if (!r.ok) {
          setLoadErr(j.error?.trim() || `שגיאת טעינה (${r.status})`);
          return;
        }
        setReport(j);
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

  const totalQuestions = useMemo(
    () => report?.topics.reduce((n, t) => n + t.totalCount, 0) ?? 0,
    [report]
  );

  if (loading) {
    return <p style={{ margin: 0, fontSize: 14, color: MUTED, textAlign: "right" }}>טוען שאלות…</p>;
  }

  return (
    <Box style={{ display: "flex", flexDirection: "column", gap: 20, textAlign: "right" }}>
      <p style={{ margin: 0, fontSize: 14, color: MUTED, lineHeight: 1.55 }}>
        שאלות חופשיות מלידים בוואטסאפ שיווקי (זואי אדמין), אחרי סיום הפלואו או כשהפלואו מפנה ל-AI. שאלות דומות
        מקובצות לפי ניסוח (גם אם ניסוח קרוב).
        {totalQuestions > 0 ? ` סה״כ ${totalQuestions} פניות.` : null}
      </p>

      {report?.notice === "missing_table" ? (
        <p style={{ margin: 0, fontSize: 13, color: "#854d0e", lineHeight: 1.5 }}>
          חסרה טבלת marketing_lead_questions — הריצו{" "}
          <code style={{ fontSize: 12 }}>supabase/marketing_lead_questions.sql</code> ב-Supabase.
        </p>
      ) : null}

      {loadErr ? (
        <p style={{ margin: 0, fontSize: 13, color: "#b42318" }} role="alert">
          {loadErr}
        </p>
      ) : null}

      {!report?.topics.some((t) => t.questions.length) && !loadErr && report?.notice !== "missing_table" ? (
        <p style={{ margin: 0, fontSize: 14, color: MUTED }}>
          עדיין אין שאלות מתועדות. מלידים שיכתבו שאלה חופשית אחרי הפלואו השיווקי — השאלה תופיע כאן.
        </p>
      ) : null}

      {report?.topics
        .filter((t) => t.questions.length > 0)
        .map((topic) => (
          <section
            key={topic.id}
            style={{
              background: "#fff",
              border: "1px solid rgba(113,51,218,0.16)",
              borderRadius: 16,
              padding: 16,
            }}
          >
            <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600, color: "#1a0a3c" }}>
              {topic.label}
              <span style={{ fontWeight: 400, fontSize: 13, color: MUTED, marginRight: 8 }}>
                ({topic.totalCount})
              </span>
            </h2>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
              {topic.questions.map((q) => (
                <li
                  key={q.fingerprint}
                  style={{
                    borderRadius: 12,
                    border: "1px solid rgba(113,51,218,0.12)",
                    background: "rgba(113,51,218,0.03)",
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between" }}>
                    <p style={{ margin: 0, fontSize: 14, color: "#1a0a3c", lineHeight: 1.45, flex: 1 }}>{q.text}</p>
                    {q.count > 1 ? (
                      <span
                        style={{
                          flexShrink: 0,
                          minWidth: 28,
                          textAlign: "center",
                          borderRadius: 999,
                          background: PURPLE,
                          color: "#fff",
                          fontSize: 12,
                          fontWeight: 600,
                          padding: "4px 10px",
                        }}
                        title={`נשאלה ${q.count} פעמים`}
                      >
                        ×{q.count}
                      </span>
                    ) : null}
                  </div>
                  {q.examples.length > 1 ? (
                    <p style={{ margin: "8px 0 0", fontSize: 12, color: MUTED, lineHeight: 1.4 }}>
                      ניסוחים נוספים: {q.examples.filter((e) => e !== q.text).slice(0, 2).join(" · ")}
                    </p>
                  ) : null}
                  <p style={{ margin: "6px 0 0", fontSize: 11, color: "#a89bc4" }}>
                    אחרונה: {formatDate(q.lastAt)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}

      <section
        style={{
          background: "#fff",
          border: "1px solid rgba(113,51,218,0.16)",
          borderRadius: 16,
          padding: 16,
        }}
      >
        <h2 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 600, color: "#1a0a3c" }}>
          באיזה שלב בפלואו נשאלה
        </h2>
        <FlowStageChart stages={report?.byFlowStage ?? []} />
      </section>
    </Box>
  );
}
