"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";

const PURPLE = "#7133da";
const MUTED = "#6b5b9a";

export type MarketingNoteStatus =
  | "in_process"
  | "not_relevant"
  | "registered"
  | "no_response";

type NotePayload = {
  phone: string;
  session_id: string;
  business_name: string;
  link: string;
  notes: string;
  status: MarketingNoteStatus;
  conversation_at: string | null;
  updated_at: string | null;
};

const STATUS_OPTIONS: {
  value: MarketingNoteStatus;
  label: string;
  activeBg: string;
  activeFg: string;
}[] = [
  { value: "in_process", label: "בתהליך", activeBg: "#eef2ff", activeFg: "#3730a3" },
  { value: "not_relevant", label: "לא רלוונטי", activeBg: "#f3f4f6", activeFg: "#4b5563" },
  { value: "registered", label: "נרשם", activeBg: "#ecfdf5", activeFg: "#047857" },
  { value: "no_response", label: "ללא מענה", activeBg: "#fff7ed", activeFg: "#c2410c" },
];

function toDateInputValue(isoOrDate: string | null | undefined): string {
  const raw = String(isoOrDate ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function MarketingConversationNotesPanel({
  phone,
  sessionId,
}: {
  phone: string;
  sessionId: string;
}) {
  const [businessName, setBusinessName] = useState("");
  const [link, setLink] = useState("");
  const [conversationAt, setConversationAt] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<MarketingNoteStatus>("in_process");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const p = phone.trim();
      const sid = sessionId.trim();
      if (!p && !sid) return;
      setLoading(true);
      setError("");
      setDirty(false);
      try {
        const qs = new URLSearchParams();
        if (p) qs.set("phone", p);
        if (sid) qs.set("session_id", sid);
        const res = await fetch(`/api/admin/marketing/conversation-notes?${qs.toString()}`, {
          cache: "no-store",
          signal,
        });
        const j = (await res.json().catch(() => ({}))) as {
          note?: NotePayload;
          error?: string;
          exists?: boolean;
        };
        if (!res.ok) {
          setError(j.error?.trim() || `שגיאת טעינה (${res.status})`);
          return;
        }
        const note = j.note;
        setBusinessName(note?.business_name ?? "");
        setLink(note?.link ?? "");
        setNotes(note?.notes ?? "");
        setStatus(note?.status ?? "in_process");
        // רק תאריך שנשמר במפורש — בלי ברירת מחדל מ־lastAt / היום
        setConversationAt(toDateInputValue(note?.conversation_at));
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        setError("בעיית רשת בטעינת הערות.");
      } finally {
        setLoading(false);
      }
    },
    [phone, sessionId]
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  async function save() {
    setSaving(true);
    setError("");
    setSavedFlash(false);
    try {
      const res = await fetch("/api/admin/marketing/conversation-notes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          session_id: sessionId,
          business_name: businessName,
          link,
          notes,
          status,
          conversation_at: conversationAt || null,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
        note?: NotePayload;
      };
      if (!res.ok) {
        const base = j.error?.trim() || `שמירה נכשלה (${res.status})`;
        const detail = j.detail?.trim();
        setError(detail ? `${base}: ${detail}` : base);
        return;
      }
      if (j.note) {
        setBusinessName(j.note.business_name ?? "");
        setLink(j.note.link ?? "");
        setNotes(j.note.notes ?? "");
        setStatus(j.note.status ?? "in_process");
        setConversationAt(toDateInputValue(j.note.conversation_at));
      }
      setDirty(false);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2000);
    } catch {
      setError("בעיית רשת בשמירת הערות.");
    } finally {
      setSaving(false);
    }
  }

  const fieldStyle: CSSProperties = {
    width: "100%",
    borderRadius: 10,
    border: "1px solid rgba(113,51,218,0.22)",
    padding: "9px 11px",
    fontFamily: "inherit",
    fontSize: 14,
    background: "#fff",
    color: "#1a0a3c",
    boxSizing: "border-box",
  };

  const labelStyle: CSSProperties = {
    display: "block",
    fontSize: 12,
    color: MUTED,
    marginBottom: 6,
    textAlign: "right",
  };

  return (
    <aside
      dir="rtl"
      className="hidden w-[280px] shrink-0 flex-col border-s border-[#e9edef] bg-white lg:flex"
      aria-label="הערות שיחה"
    >
      <header className="flex h-[59px] shrink-0 items-center bg-[#f0f2f5] px-4">
        <h2 className="text-[17px] font-medium text-[#111b21]">הערות</h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {loading ? (
          <p style={{ margin: 0, fontSize: 13, color: MUTED, textAlign: "right" }}>טוען…</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label>
              <span style={labelStyle}>שם העסק</span>
              <input
                type="text"
                value={businessName}
                onChange={(e) => {
                  setBusinessName(e.target.value);
                  setDirty(true);
                }}
                placeholder="שם העסק"
                style={fieldStyle}
              />
            </label>

            <label>
              <span style={labelStyle}>לינק</span>
              <input
                type="url"
                value={link}
                onChange={(e) => {
                  setLink(e.target.value);
                  setDirty(true);
                }}
                placeholder="https://…"
                dir="ltr"
                style={{ ...fieldStyle, textAlign: "left" }}
              />
            </label>

            <label>
              <span style={labelStyle}>תאריך שיחה</span>
              <input
                type="date"
                value={conversationAt}
                onChange={(e) => {
                  setConversationAt(e.target.value);
                  setDirty(true);
                }}
                style={{ ...fieldStyle, direction: "ltr", textAlign: "right" }}
              />
            </label>

            <div>
              <span style={labelStyle}>סטטוס</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {STATUS_OPTIONS.map((opt) => {
                  const active = status === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setStatus(opt.value);
                        setDirty(true);
                      }}
                      style={{
                        borderRadius: 999,
                        border: active
                          ? `1px solid ${opt.activeFg}`
                          : "1px solid rgba(113,51,218,0.18)",
                        background: active ? opt.activeBg : "#fff",
                        color: active ? opt.activeFg : "#1a0a3c",
                        fontSize: 12,
                        fontWeight: active ? 600 : 500,
                        padding: "6px 10px",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <label>
              <span style={labelStyle}>הערות</span>
              <textarea
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setDirty(true);
                }}
                placeholder="כתבו הערות חופשיות…"
                rows={8}
                style={{
                  ...fieldStyle,
                  resize: "vertical",
                  minHeight: 140,
                  lineHeight: 1.5,
                }}
              />
            </label>

            {error ? (
              <p style={{ margin: 0, fontSize: 12, color: "#b42318", textAlign: "right" }} role="alert">
                {error}
              </p>
            ) : null}

            {savedFlash ? (
              <p style={{ margin: 0, fontSize: 12, color: "#047857", textAlign: "right" }}>נשמר ✓</p>
            ) : null}
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-[#e9edef] bg-[#f0f2f5] px-3 py-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || loading || !dirty}
          style={{
            width: "100%",
            borderRadius: 10,
            border: "none",
            background: dirty && !saving ? PURPLE : "#c4b5e0",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            padding: "10px 14px",
            cursor: dirty && !saving ? "pointer" : "default",
            fontFamily: "inherit",
          }}
        >
          {saving ? "שומר…" : "שמירת הערות"}
        </button>
      </footer>
    </aside>
  );
}
