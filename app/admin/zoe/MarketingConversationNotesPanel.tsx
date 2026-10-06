"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  MARKETING_NOTE_STATUS_OPTIONS,
  type MarketingNoteStatus,
} from "@/lib/marketing-conversation-notes";
import { isMarketingStage, type MarketingRelevance, type MarketingStage } from "@/lib/marketing-admin-status";
import { isMarketingSystemTemplateName } from "@/lib/marketing-template-trigger-types";
import { bodyTextFromTemplateComponents } from "@/lib/template-presets";

const PURPLE = "#7133da";
const MUTED = "#6b5b9a";
const DRAFT_PREFIX = "hz-marketing-notes-draft:";
const AUTOSAVE_MS = 2500;

export type { MarketingNoteStatus };

type NotePayload = {
  phone: string;
  session_id: string;
  business_name: string;
  link: string;
  notes: string;
  status: MarketingNoteStatus;
  relevance?: MarketingRelevance;
  conversation_at: string | null;
  next_call_time?: string | null;
  updated_at: string | null;
};

type DraftPayload = {
  business_name: string;
  link: string;
  notes: string;
  status: MarketingNoteStatus;
  relevance?: MarketingRelevance;
  conversation_at: string;
  next_call_time?: string;
  savedAt: number;
};

const STATUS_OPTIONS = MARKETING_NOTE_STATUS_OPTIONS;

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

function draftKey(phone: string, sessionId: string): string {
  return `${DRAFT_PREFIX}${phone.trim() || sessionId.trim()}`;
}

function readDraft(phone: string, sessionId: string): DraftPayload | null {
  try {
    const raw = localStorage.getItem(draftKey(phone, sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftPayload;
    if (!parsed || typeof parsed.notes !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDraft(phone: string, sessionId: string, draft: Omit<DraftPayload, "savedAt">): void {
  try {
    localStorage.setItem(
      draftKey(phone, sessionId),
      JSON.stringify({ ...draft, savedAt: Date.now() } satisfies DraftPayload)
    );
  } catch {
    /* quota / private mode */
  }
}

type TemplateChoice = { name: string; label: string };

function templateChoiceLabel(name: string, components: unknown): string {
  const body = bodyTextFromTemplateComponents(components).replace(/\s+/g, " ").trim();
  if (!body) return name;
  return body.length > 48 ? `${body.slice(0, 48)}…` : body;
}

function templateSendErrorHe(code: string): string {
  switch (code) {
    case "template_not_approved":
      return "הטמפלייט לא מאושר או כבוי.";
    case "suppressed_opt_out":
      return "הליד ביקש להסיר. אי אפשר לשלוח טמפלייט.";
    case "missing_fields":
      return "חסר טמפלייט או מספר.";
    case "unauthorized":
      return "אין הרשאה לשליחה.";
    default:
      return "השליחה נכשלה. נסו שוב.";
  }
}

function clearDraft(phone: string, sessionId: string): void {
  try {
    localStorage.removeItem(draftKey(phone, sessionId));
  } catch {
    /* noop */
  }
}

export default function MarketingConversationNotesPanel({
  phone,
  sessionId,
  onStatusSaved,
  onCallSaved,
  onTemplateSent,
}: {
  phone: string;
  sessionId: string;
  onStatusSaved?: (status: MarketingStage, relevance: MarketingRelevance) => void;
  onCallSaved?: (date: string | null, time: string | null) => void;
  onTemplateSent?: (content: string) => void;
}) {
  const [businessName, setBusinessName] = useState("");
  const [link, setLink] = useState("");
  const [conversationAt, setConversationAt] = useState("");
  const [callTime, setCallTime] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<MarketingStage>("in_process");
  const [relevance, setRelevance] = useState<MarketingRelevance>("relevant");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draftHint, setDraftHint] = useState("");
  const [templates, setTemplates] = useState<TemplateChoice[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [templateNotice, setTemplateNotice] = useState("");
  const [templateNoticeOk, setTemplateNoticeOk] = useState(false);
  const loadGenRef = useRef(0);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef({
    businessName: "",
    link: "",
    notes: "",
    status: "in_process" as MarketingStage,
    relevance: "relevant" as MarketingRelevance,
    conversationAt: "",
    callTime: "",
  });
  formRef.current = { businessName, link, notes, status, relevance, conversationAt, callTime };

  useEffect(() => {
    const ac = new AbortController();
    const gen = ++loadGenRef.current;
    const p = phone.trim();
    const sid = sessionId.trim();

    setLoading(true);
    setError("");
    setDirty(false);
    setDraftHint("");
    setBusinessName("");
    setLink("");
    setNotes("");
    setStatus("in_process");
    setRelevance("relevant");
    setConversationAt("");
    setCallTime("");
    setTemplateNotice("");
    setTemplateNoticeOk(false);

    if (!p && !sid) {
      setLoading(false);
      return () => ac.abort();
    }

    void (async () => {
      try {
        const qs = new URLSearchParams();
        if (p) qs.set("phone", p);
        if (sid) qs.set("session_id", sid);
        const res = await fetch(`/api/admin/marketing/conversation-notes?${qs.toString()}`, {
          cache: "no-store",
          signal: ac.signal,
        });
        const j = (await res.json().catch(() => ({}))) as {
          note?: NotePayload;
          error?: string;
        };
        if (ac.signal.aborted || gen !== loadGenRef.current) return;
        if (!res.ok) {
          setError(j.error?.trim() || `שגיאת טעינה (${res.status})`);
          return;
        }
        const note = j.note;
        let nextBusiness = note?.business_name ?? "";
        let nextLink = note?.link ?? "";
        let nextNotes = note?.notes ?? "";
        let nextStatus: MarketingStage = isMarketingStage(note?.status) ? note.status : "in_process";
        let nextRelevance: MarketingRelevance = note?.relevance === "not_relevant" ? "not_relevant" : "relevant";
        let nextDate = toDateInputValue(note?.conversation_at);
        let nextTime = String(note?.next_call_time ?? "").trim();

        // אם יש טיוטה מקומית ארוכה יותר מהשרת — משחזרים אותה
        const draft = readDraft(p, sid);
        if (draft && draft.notes.trim().length > nextNotes.trim().length) {
          nextBusiness = draft.business_name || nextBusiness;
          nextLink = draft.link || nextLink;
          nextNotes = draft.notes;
          nextStatus = isMarketingStage(draft.status) ? draft.status : nextStatus;
          nextRelevance = draft.relevance === "not_relevant" ? "not_relevant" : nextRelevance;
          nextDate = draft.conversation_at || nextDate;
          nextTime = draft.next_call_time || nextTime;
          setDraftHint("שוחזרה טיוטה מקומית שלא נשמרה לשרת — לחצו «שמירת הערות».");
          setDirty(true);
        }

        setBusinessName(nextBusiness);
        setLink(nextLink);
        setNotes(nextNotes);
        setStatus(nextStatus);
        setRelevance(nextRelevance);
        setConversationAt(nextDate);
        setCallTime(nextTime);
      } catch (e) {
        if (ac.signal.aborted || (e as { name?: string })?.name === "AbortError") return;
        if (gen !== loadGenRef.current) return;
        setError("בעיית רשת בטעינת הערות.");
      } finally {
        if (gen === loadGenRef.current) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [phone, sessionId]);

  useEffect(() => {
    const ac = new AbortController();
    setTemplatesLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/admin/marketing/templates", {
          cache: "no-store",
          signal: ac.signal,
        });
        const j = (await res.json().catch(() => ({}))) as {
          templates?: Array<{ name?: string; status?: string; disabled?: boolean; components?: unknown }>;
          error?: string;
        };
        if (ac.signal.aborted) return;
        if (!res.ok) {
          setTemplatesError("לא הצלחנו לטעון טמפלייטים.");
          return;
        }
        const choices = (j.templates ?? [])
          .filter((row) => {
            const name = String(row.name ?? "").trim();
            if (!name || row.disabled === true || isMarketingSystemTemplateName(name)) return false;
            return String(row.status ?? "").toUpperCase() === "APPROVED";
          })
          .map((row) => {
            const name = String(row.name ?? "").trim();
            return { name, label: templateChoiceLabel(name, row.components) };
          })
          .sort((a, b) => a.label.localeCompare(b.label, "he"));
        setTemplates(choices);
        setTemplateName((current) => current || choices[0]?.name || "");
      } catch (e) {
        if (ac.signal.aborted || (e as { name?: string })?.name === "AbortError") return;
        setTemplatesError("בעיית רשת בטעינת טמפלייטים.");
      } finally {
        if (!ac.signal.aborted) setTemplatesLoading(false);
      }
    })();
    return () => ac.abort();
  }, []);

  async function sendTemplateNow() {
    const name = templateName.trim();
    if (!name || sendingTemplate || (!phone.trim() && !sessionId.trim())) return;
    setSendingTemplate(true);
    setTemplateNotice("");
    setTemplateNoticeOk(false);
    try {
      const res = await fetch("/api/admin/marketing/send-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          session_id: sessionId,
          template_name: name,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; content?: string };
      if (!res.ok) {
        setTemplateNotice(templateSendErrorHe(String(j.error ?? "")));
        return;
      }
      const content = String(j.content ?? "").trim() || `נשלח טמפלייט (${name})`;
      onTemplateSent?.(content);
      setTemplateNoticeOk(true);
      setTemplateNotice("הטמפלייט נשלח ✓");
    } catch {
      setTemplateNotice("בעיית רשת בשליחת הטמפלייט.");
    } finally {
      setSendingTemplate(false);
      setConfirmSendOpen(false);
    }
  }

  // טיוטה מקומית + שמירה אוטומטית לשרת כשיש שינויים
  useEffect(() => {
    if (loading || !dirty) return;
    writeDraft(phone, sessionId, {
      business_name: businessName,
      link,
      notes,
      status,
      relevance,
      conversation_at: conversationAt,
      next_call_time: callTime,
    });

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void save({ silent: true });
    }, AUTOSAVE_MS);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessName, link, notes, status, relevance, conversationAt, callTime, dirty, loading, phone, sessionId]);

  async function save(opts?: { silent?: boolean }) {
    if (loading || saving) return;
    const snapshot = { ...formRef.current };
    setSaving(true);
    if (!opts?.silent) {
      setError("");
      setSavedFlash(false);
    }
    try {
      const res = await fetch("/api/admin/marketing/conversation-notes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          session_id: sessionId,
          business_name: snapshot.businessName,
          link: snapshot.link,
          notes: snapshot.notes,
          status: snapshot.status,
          relevance: snapshot.relevance,
          conversation_at: snapshot.conversationAt || null,
          next_call_time: snapshot.callTime || null,
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
      const cur = formRef.current;
      const unchanged =
        cur.businessName === snapshot.businessName &&
        cur.link === snapshot.link &&
        cur.notes === snapshot.notes &&
        cur.status === snapshot.status &&
        cur.relevance === snapshot.relevance &&
        cur.conversationAt === snapshot.conversationAt &&
        cur.callTime === snapshot.callTime;
      onCallSaved?.(
        toDateInputValue(j.note?.conversation_at) || snapshot.conversationAt || null,
        String(j.note?.next_call_time ?? snapshot.callTime ?? "").trim() || null
      );
      if (unchanged) {
        const savedStatus: MarketingStage = isMarketingStage(j.note?.status) ? j.note.status : snapshot.status;
        const savedRelevance = j.note?.relevance === "not_relevant" ? "not_relevant" : snapshot.relevance;
        if (!opts?.silent && j.note) {
          setBusinessName(j.note.business_name ?? "");
          setLink(j.note.link ?? "");
          setNotes(j.note.notes ?? "");
          setStatus(savedStatus);
          setRelevance(savedRelevance);
          setConversationAt(toDateInputValue(j.note.conversation_at));
          setCallTime(String(j.note.next_call_time ?? "").trim());
        }
        setDirty(false);
        setDraftHint("");
        clearDraft(phone, sessionId);
        onStatusSaved?.(savedStatus, savedRelevance);
      }
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

  function markDirty() {
    setDirty(true);
    setDraftHint("");
  }

  return (
    <aside
      dir="rtl"
      className="flex max-h-[48%] w-full shrink-0 flex-col border-t border-[#e9edef] bg-white lg:max-h-none lg:w-[280px] lg:border-s lg:border-t-0"
      aria-label="הערות שיחה"
    >
      <header className="flex h-[48px] shrink-0 items-center bg-[#f0f2f5] px-4 lg:h-[59px]">
        <h2 className="text-[16px] font-medium text-[#111b21] lg:text-[17px]">סטטוס והערות</h2>
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
                  markDirty();
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
                  markDirty();
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
                  markDirty();
                }}
                aria-label="תאריך פגישה"
                style={{ ...fieldStyle, direction: "ltr", textAlign: "right" }}
              />
            </label>

            <label>
              <span style={labelStyle}>שעת פגישה</span>
              <input
                type="time"
                value={callTime}
                onChange={(e) => {
                  setCallTime(e.target.value);
                  markDirty();
                }}
                aria-label="שעת פגישה"
                style={{ ...fieldStyle, direction: "ltr", textAlign: "right" }}
              />
            </label>

            <div>
              <span style={labelStyle}>רלוונטיות</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(
                  [
                    { value: "relevant" as const, label: "רלוונטי" },
                    { value: "not_relevant" as const, label: "לא רלוונטי" },
                  ]
                ).map((opt) => {
                  const active = relevance === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setRelevance(opt.value);
                        markDirty();
                      }}
                      style={{
                        borderRadius: 999,
                        border: active ? "1px solid #3730a3" : "1px solid rgba(113,51,218,0.18)",
                        background: active ? (opt.value === "relevant" ? "#eef2ff" : "#f3f4f6") : "#fff",
                        color: active ? (opt.value === "relevant" ? "#3730a3" : "#4b5563") : "#1a0a3c",
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

            {relevance === "relevant" ? (
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
                          markDirty();
                        }}
                        style={{
                          borderRadius: 999,
                          border: active ? `1px solid ${opt.activeFg}` : "1px solid rgba(113,51,218,0.18)",
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
            ) : (
              <p style={{ margin: 0, fontSize: 12, color: MUTED, textAlign: "right" }}>
                לא רלוונטי עומד לבד — בלי סטטוס נוסף.
              </p>
            )}

            <label>
              <span style={labelStyle}>הערות</span>
              <textarea
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  markDirty();
                }}
                placeholder="כתבו הערות חופשיות…"
                rows={5}
                className="min-h-[100px] resize-y lg:min-h-[140px]"
                style={{
                  ...fieldStyle,
                  lineHeight: 1.5,
                }}
              />
            </label>

            {draftHint ? (
              <p style={{ margin: 0, fontSize: 12, color: "#9a3412", textAlign: "right" }}>{draftHint}</p>
            ) : null}

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

      <div className="shrink-0 border-t border-[#e9edef] bg-white px-3 py-3">
        <span style={labelStyle}>שליחת טמפלייט</span>
        {templatesLoading ? (
          <p style={{ margin: 0, fontSize: 12, color: MUTED, textAlign: "right" }}>טוען טמפלייטים…</p>
        ) : templatesError ? (
          <p style={{ margin: 0, fontSize: 12, color: "#b42318", textAlign: "right" }} role="alert">
            {templatesError}
          </p>
        ) : templates.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: MUTED, textAlign: "right" }}>אין טמפלייטים מאושרים.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <select
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              aria-label="בחירת טמפלייט לשליחה"
              style={fieldStyle}
            >
              {templates.map((row) => (
                <option key={row.name} value={row.name} title={row.name}>
                  {row.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                if (sendingTemplate || !templateName || (!phone.trim() && !sessionId.trim())) return;
                setConfirmSendOpen(true);
              }}
              disabled={sendingTemplate || !templateName || (!phone.trim() && !sessionId.trim())}
              style={{
                alignSelf: "flex-start",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                background:
                  sendingTemplate || !templateName || (!phone.trim() && !sessionId.trim())
                    ? "#f3f4f6"
                    : "#fff",
                color:
                  sendingTemplate || !templateName || (!phone.trim() && !sessionId.trim())
                    ? "#9ca3af"
                    : "#374151",
                fontSize: 12,
                fontWeight: 500,
                padding: "5px 10px",
                cursor:
                  sendingTemplate || !templateName || (!phone.trim() && !sessionId.trim())
                    ? "default"
                    : "pointer",
                fontFamily: "inherit",
              }}
            >
              {sendingTemplate ? "שולח…" : "שליחה עכשיו"}
            </button>
          </div>
        )}
        {templateNotice ? (
          <p
            style={{
              margin: "8px 0 0",
              fontSize: 12,
              color: templateNoticeOk ? "#047857" : "#b42318",
              textAlign: "right",
            }}
            role={templateNoticeOk ? "status" : "alert"}
          >
            {templateNotice}
          </p>
        ) : null}
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
            background: dirty && !saving && !loading ? PURPLE : "#c4b5e0",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            padding: "10px 14px",
            cursor: dirty && !saving && !loading ? "pointer" : "default",
            fontFamily: "inherit",
          }}
        >
          {saving ? "שומר…" : dirty ? "שמירת הערות" : "נשמר"}
        </button>
      </footer>
      {confirmSendOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="send-template-confirm-title"
              onClick={() => {
                if (!sendingTemplate) setConfirmSendOpen(false);
              }}
            >
              <div
                className="w-full max-w-xs rounded-2xl bg-white p-4 text-right shadow-xl"
                dir="rtl"
                onClick={(e) => e.stopPropagation()}
              >
                <h2
                  id="send-template-confirm-title"
                  style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1a0a3c" }}
                >
                  האם לשלוח?
                </h2>
                <p style={{ margin: "8px 0 0", fontSize: 13, color: "#374151", lineHeight: 1.5 }}>
                  הטמפלייט «{templates.find((row) => row.name === templateName)?.label || templateName}» יישלח
                  עכשיו.
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button
                    type="button"
                    onClick={() => setConfirmSendOpen(false)}
                    disabled={sendingTemplate}
                    style={{
                      borderRadius: 8,
                      border: "1px solid #d1d5db",
                      background: "#fff",
                      color: "#374151",
                      fontSize: 13,
                      fontWeight: 500,
                      padding: "7px 12px",
                      cursor: sendingTemplate ? "default" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    ביטול
                  </button>
                  <button
                    type="button"
                    onClick={() => void sendTemplateNow()}
                    disabled={sendingTemplate}
                    style={{
                      borderRadius: 8,
                      border: "none",
                      background: sendingTemplate ? "#c4b5e0" : PURPLE,
                      color: "#fff",
                      fontSize: 13,
                      fontWeight: 600,
                      padding: "7px 12px",
                      cursor: sendingTemplate ? "default" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {sendingTemplate ? "שולח…" : "שליחה"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </aside>
  );
}
