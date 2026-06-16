"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { LeadAnswersReport } from "@/lib/marketing-lead-answers";

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

function Box({ style, children }: { style?: CSSProperties; children?: ReactNode }) {
  return <div style={style}>{children}</div>;
}

function AnswerDistribution({
  answers,
  totalCount,
}: {
  answers: LeadAnswersReport["questions"][number]["answers"];
  totalCount: number;
}) {
  const max = Math.max(1, ...answers.map((a) => a.count));

  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
      {answers.map((a) => {
        const pct = Math.round((a.count / max) * 100);
        const share = totalCount > 0 ? Math.round((a.count / totalCount) * 100) : 0;
        return (
          <li
            key={a.answerText}
            style={{
              borderRadius: 12,
              border: "1px solid rgba(113,51,218,0.12)",
              background: "rgba(113,51,218,0.03)",
              padding: "10px 12px",
            }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between" }}>
              <p style={{ margin: 0, fontSize: 14, color: "#1a0a3c", lineHeight: 1.45, flex: 1 }}>{a.answerText}</p>
              <span
                style={{
                  flexShrink: 0,
                  minWidth: 36,
                  textAlign: "center",
                  borderRadius: 999,
                  background: PURPLE,
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "4px 10px",
                }}
                title={`${a.count} בחירות (${share}%)`}
              >
                ×{a.count}
              </span>
            </div>
            <Box
              style={{
                marginTop: 8,
                height: 8,
                borderRadius: 999,
                background: "rgba(113,51,218,0.1)",
                overflow: "hidden",
              }}
            >
              <Box
                style={{
                  width: `${pct}%`,
                  minWidth: a.count > 0 ? 4 : 0,
                  height: "100%",
                  borderRadius: 999,
                  background: `linear-gradient(90deg, ${PURPLE}, #ff92ff)`,
                }}
              />
            </Box>
            <p style={{ margin: "6px 0 0", fontSize: 11, color: "#a89bc4" }}>
              {share}% מהתשובות
              {a.uniqueLeads > 0 && a.uniqueLeads !== a.count
                ? ` · ${a.uniqueLeads} לידים · ${a.count} בחירות`
                : a.uniqueLeads > 0
                  ? ` · ${a.uniqueLeads} לידים`
                  : ""}
              {" · "}אחרונה: {formatDate(a.lastAt)}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export default function ZoeLeadAnswersTab() {
  const [report, setReport] = useState<LeadAnswersReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadErr("");
      try {
        const r = await fetch("/api/admin/marketing/lead-answers-report", { cache: "no-store" });
        const j = (await r.json()) as LeadAnswersReport & { error?: string };
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

  const totalAnswers = useMemo(
    () => report?.questions.reduce((n, q) => n + q.totalCount, 0) ?? 0,
    [report]
  );

  if (loading) {
    return <p style={{ margin: 0, fontSize: 14, color: MUTED, textAlign: "right" }}>טוען תשובות…</p>;
  }

  return (
    <Box style={{ display: "flex", flexDirection: "column", gap: 20, textAlign: "right" }}>
      <p style={{ margin: 0, fontSize: 14, color: MUTED, lineHeight: 1.55 }}>
        תשובות לידים לשאלות סגורות בפלואו השיווקי (בחירה מכפתורים). לכל שאלה מוצגת התפלגות — כמה לידים
        בחרו בכל אפשרות. אם אותו מספר ענה מספר פעמים, זה נספר כמה בחירות מאותו ליד.
        {totalAnswers > 0 ? ` סה״כ ${totalAnswers} בחירות.` : null}
        {report?.includesMessageHistory ? " כולל שחזור מהיסטוריית השיחות." : null}
      </p>

      {report?.notice === "missing_table" ? (
        <p style={{ margin: 0, fontSize: 13, color: "#854d0e", lineHeight: 1.5 }}>
          חסרה טבלת marketing_lead_answers — הריצו{" "}
          <code style={{ fontSize: 12 }}>supabase/marketing_lead_answers.sql</code> ב-Supabase.
        </p>
      ) : null}

      {loadErr ? (
        <p style={{ margin: 0, fontSize: 13, color: "#b42318" }} role="alert">
          {loadErr}
        </p>
      ) : null}

      {!report?.questions.length && !loadErr && report?.notice !== "missing_table" ? (
        <p style={{ margin: 0, fontSize: 14, color: MUTED }}>
          עדיין אין תשובות מתועדות. כשלידים יבחרו אפשרות בשאלות סגורות בפלואו — הנתונים יופיעו כאן.
        </p>
      ) : null}

      {report?.questions.map((q) => (
        <section
          key={q.flowNodeId ?? q.questionText}
          style={{
            background: "#fff",
            border: "1px solid rgba(113,51,218,0.16)",
            borderRadius: 16,
            padding: 16,
          }}
        >
          <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600, color: "#1a0a3c" }}>
            {q.questionText || "שאלה בפלואו"}
            <span style={{ fontWeight: 400, fontSize: 13, color: MUTED, marginRight: 8 }}>
              ({q.totalCount} בחירות
              {q.uniqueLeads > 0 && q.uniqueLeads !== q.totalCount ? ` · ${q.uniqueLeads} לידים` : ""})
            </span>
          </h2>
          <AnswerDistribution answers={q.answers} totalCount={q.totalCount} />
        </section>
      ))}
    </Box>
  );
}
