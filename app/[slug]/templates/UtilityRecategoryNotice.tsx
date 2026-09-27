"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { UtilityRecategoryNotice as Notice } from "@/lib/template-category-notice";

const MANAGER_URL = "https://business.facebook.com/latest/whatsapp_manager/message_templates";

export default function UtilityRecategoryNotice({
  slug,
  notices,
  onDismissed,
  onEdit,
}: {
  slug: string;
  notices: Notice[];
  onDismissed: () => void;
  onEdit: (id: string) => void;
}) {
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (notices.length === 0 || typeof document === "undefined") return null;

  async function dismiss() {
    if (dismissing) return;
    setDismissing(true);
    setError(null);
    try {
      const res = await fetch(`/api/${encodeURIComponent(slug)}/templates/category-notice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: notices.map((n) => n.id) }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        console.error("[UtilityRecategoryNotice] dismiss failed:", j.error || res.status);
        setError("שמירת הסגירה נכשלה, נסו שוב");
        setDismissing(false);
        return;
      }
      onDismissed();
    } catch (e) {
      console.error("[UtilityRecategoryNotice] dismiss failed:", e);
      setError("שמירת הסגירה נכשלה, נסו שוב");
      setDismissing(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4" dir="rtl">
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="utility-recategory-title"
      >
        <div className="flex items-start justify-between gap-3 border-b border-amber-100 px-5 py-4">
          <h2 id="utility-recategory-title" className="text-right text-lg font-semibold text-zinc-900">
            מטא העבירה טמפלייטים למרקטינג
          </h2>
          <button
            type="button"
            aria-label="סגור"
            disabled={dismissing}
            onClick={() => void dismiss()}
            className="shrink-0 rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-right text-sm leading-relaxed text-zinc-700">
          <p>
            הטמפלייטים האלה נשלחו כיוטיליטי, ומטא סיווגה אותם מחדש כמרקטינג. הודעת מרקטינג עולה יותר,
            ומי שביקש להפסיק הודעות קידום לא יקבל אותה.
          </p>
          <p>
            <span className="font-semibold text-zinc-900">המלצה:</span> ערכו את הנוסח והורידו רמיזות
            שיווקיות — הנחה, מבצע, דחיפות או «אל תפספסו». אחר כך ערערו על הסיווג ב-WhatsApp Manager.
            אם הערעור מתקבל, הטמפלייט חוזר ליוטיליטי ואפשר לשלוח אותו שוב במחיר יוטיליטי.
          </p>
          <a
            href={MANAGER_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-sm font-medium text-[#7133da] hover:underline"
          >
            פתיחת WhatsApp Manager לערעור
          </a>

          <ul className="space-y-2">
            {notices.map((notice) => (
              <li
                key={notice.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"
              >
                <span className="min-w-0 break-all text-left font-medium text-zinc-900" dir="ltr">
                  {notice.name}
                </span>
                <button
                  type="button"
                  disabled={dismissing}
                  onClick={() => onEdit(notice.id)}
                  className="shrink-0 rounded-xl border border-[#7133da]/30 bg-white px-3 py-1.5 text-xs font-medium text-[#7133da] hover:bg-[#7133da]/5 disabled:opacity-60"
                >
                  עריכת טמפלייט
                </button>
              </li>
            ))}
          </ul>

          {error ? (
            <p className="text-sm font-medium text-red-600" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="border-t border-zinc-100 px-5 py-4">
          <button
            type="button"
            disabled={dismissing}
            onClick={() => void dismiss()}
            className="inline-flex items-center rounded-xl bg-[#7133da] px-4 py-2 text-sm font-medium text-white hover:bg-[#5f28c0] disabled:opacity-60"
          >
            {dismissing ? "שומר..." : "הבנתי"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
