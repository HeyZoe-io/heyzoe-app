"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import type { MarketingLeadAnswerRow } from "@/lib/marketing-lead-answers";

function ModalShell({
  title,
  children,
  onClose,
  widthClass = "max-w-lg",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  widthClass?: string;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[2147483000]">
      <button
        type="button"
        aria-label="סגירה"
        className="absolute inset-0 bg-black/35"
        onClick={onClose}
      />
      <div className="relative mx-auto mt-20 w-[92vw]">
        <div className={`mx-auto ${widthClass} rounded-2xl bg-white shadow-xl border border-zinc-200 overflow-hidden`}>
          <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
            <p className="text-sm font-semibold text-zinc-900 text-right">{title}</p>
            <button
              type="button"
              className="rounded-full px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100"
              onClick={onClose}
            >
              סגור
            </button>
          </div>
          <div className="p-5" dir="rtl">
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("he-IL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Props = {
  phone: string;
  fullName: string | null;
  onClose: () => void;
};

export default function MarketingLeadAnswersModal({ phone, fullName, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<MarketingLeadAnswerRow[]>([]);
  const [missingTable, setMissingTable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMissingTable(false);

    void (async () => {
      try {
        const res = await fetch(`/api/admin/marketing/lead-answers?phone=${encodeURIComponent(phone)}`);
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          answers?: MarketingLeadAnswerRow[];
          notice?: string | null;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(j.error === "unauthorized" ? "אין הרשאה" : "טעינה נכשלה");
          setAnswers([]);
          return;
        }
        if (j.notice === "missing_table") setMissingTable(true);
        setAnswers(Array.isArray(j.answers) ? j.answers : []);
      } catch {
        if (!cancelled) {
          setError("טעינה נכשלה");
          setAnswers([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [phone]);

  return (
    <ModalShell title="תשובות מהשיחה" onClose={onClose} widthClass="max-w-lg">
      <div className="space-y-4" dir="rtl">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 text-right">
          <p className="text-sm font-medium text-zinc-900">{fullName?.trim() || "ליד"}</p>
          <p className="text-sm text-zinc-600">{phone}</p>
        </div>

        {missingTable ? (
          <p className="text-sm text-amber-800 text-right leading-relaxed">
            חסרה טבלת <code className="text-xs">marketing_lead_answers</code> — הריצו{" "}
            <code className="text-xs">supabase/marketing_lead_answers.sql</code> ב-Supabase.
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-zinc-500 text-right">טוען תשובות…</p>
        ) : error ? (
          <p className="text-sm text-red-600 text-right">{error}</p>
        ) : answers.length === 0 ? (
          <p className="text-sm text-zinc-500 text-right">
            עדיין אין תשובות מתועדות מפלואו השיווקי עבור ליד זה.
          </p>
        ) : (
          <ul className="space-y-3 max-h-[min(60vh,420px)] overflow-y-auto pr-1">
            {answers.map((a) => (
              <li
                key={a.id}
                className="rounded-xl border border-zinc-200 bg-white p-3 text-right space-y-2"
              >
                <p className="text-xs text-zinc-500">{formatDateTime(a.created_at)}</p>
                <div>
                  <p className="text-xs font-medium text-zinc-500">שאלה</p>
                  <p className="text-sm text-zinc-900 whitespace-pre-wrap">{a.question_text || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500">תשובה</p>
                  <p className="text-sm font-medium text-[#7133da] whitespace-pre-wrap">
                    {a.answer_text || "—"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            סגור
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
