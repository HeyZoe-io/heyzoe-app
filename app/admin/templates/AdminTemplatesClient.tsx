"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, RefreshCw } from "lucide-react";
import {
  bodyTextFromTemplateComponents,
  extractBodyVarCount,
  isMetaTemplateContentEditable,
  parseDashboardTemplateComponents,
  uniqueTemplateName,
} from "@/lib/template-presets";
import {
  MARKETING_TEMPLATE_PRESETS,
  marketingPresetExampleForSlot,
  marketingPresetVarHint,
  MARKETING_TEMPLATE_PARAM_SLOTS,
} from "@/lib/marketing-template-presets";
import {
  isMarketingSystemTemplateName,
  marketingAllowsDelayBefore,
  marketingSystemTemplateLabel,
  type MarketingTriggerType,
} from "@/lib/marketing-template-trigger-types";

export type AdminTemplateRow = {
  id?: string;
  waba_template_id?: string | null;
  name: string;
  category: string;
  language: string;
  status: string;
  disabled?: boolean;
  components?: unknown;
  created_at?: string;
  updated_at?: string;
};

export type AdminTriggerRow = {
  id: string;
  trigger_type: MarketingTriggerType;
  flow_node_id: string | null;
  delay_days: number;
  delay_direction: "after" | "before";
  template_name: string;
  enabled: boolean;
  created_at: string;
};

export type AdminFlowNodeOption = {
  id: string;
  rank: number;
  type: string;
  label: string;
};

type ButtonDraft = { kind: "QUICK_REPLY" | "URL"; text: string; url: string };

const FIELD =
  "w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400";

const TRIGGER_OPTIONS: { value: MarketingTriggerType; label: string }[] = [
  { value: "node_answered", label: "ליד ענה על נוד (בחירת שעה / שאלה)" },
  { value: "call_day", label: "ביום השיחה שנקבעה" },
  { value: "flow_completed", label: "סיום הפלואו (הנוד האחרון)" },
];

function statusLabel(status: string): { text: string; className: string } {
  const s = status.toUpperCase();
  if (s === "APPROVED") return { text: "מאושר", className: "bg-emerald-50 text-emerald-800" };
  if (s === "PENDING") return { text: "ממתין לאישור", className: "bg-amber-50 text-amber-900" };
  if (s === "REJECTED") return { text: "נדחה", className: "bg-red-50 text-red-800" };
  return { text: status || "—", className: "bg-zinc-100 text-zinc-600" };
}

function buildMetaComponents(input: {
  body: string;
  header: string;
  footer: string;
  buttons: ButtonDraft[];
  exampleValues?: string[];
}): unknown[] {
  const components: Record<string, unknown>[] = [];
  const header = input.header.trim();
  if (header) components.push({ type: "HEADER", format: "TEXT", text: header });
  const body = input.body.trim();
  const varCount = extractBodyVarCount(body);
  const bodyComp: Record<string, unknown> = { type: "BODY", text: body };
  if (varCount > 0) {
    const examples = Array.from({ length: varCount }, (_, i) => {
      const fromPreset = input.exampleValues?.[i]?.trim();
      return fromPreset || (i === 0 ? "דנה" : `ערך${i + 1}`);
    });
    bodyComp.example = { body_text: [examples] };
  }
  components.push(bodyComp);
  const footer = input.footer.trim();
  if (footer) components.push({ type: "FOOTER", text: footer });
  const buttons = input.buttons
    .map((b) => ({ ...b, text: b.text.trim(), url: b.url.trim() }))
    .filter((b) => b.text);
  if (buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: buttons.map((b) =>
        b.kind === "URL"
          ? { type: "URL", text: b.text, url: b.url || "https://example.com" }
          : { type: "QUICK_REPLY", text: b.text }
      ),
    });
  }
  return components;
}

function delayLabel(t: AdminTriggerRow): string {
  if (t.trigger_type === "call_day") {
    if (t.delay_days === 0) return "ביום השיחה · 08:00";
    const dir = t.delay_direction === "before" ? "לפני" : "אחרי";
    return `${t.delay_days} ימים ${dir} יום השיחה · 08:00`;
  }
  if (t.delay_days === 0) return "מיידי";
  return `${t.delay_days} ימים אחרי`;
}

function nodeCaption(nodes: AdminFlowNodeOption[], id: string | null): string {
  if (!id) return "—";
  const n = nodes.find((x) => x.id === id);
  if (!n) return `#?`;
  return `#${n.rank} · ${n.label}`;
}

type Props = {
  initialTemplates: AdminTemplateRow[];
  initialTriggers: AdminTriggerRow[];
  flowNodes: AdminFlowNodeOption[];
  migrationRequired: boolean;
};

export default function AdminTemplatesClient({
  initialTemplates,
  initialTriggers,
  flowNodes,
  migrationRequired,
}: Props) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [triggers, setTriggers] = useState(initialTriggers);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AdminTemplateRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [purpose, setPurpose] = useState<MarketingTriggerType | "">("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY">("UTILITY");
  const [language, setLanguage] = useState("he");
  const [body, setBody] = useState("");
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState<ButtonDraft[]>([{ kind: "QUICK_REPLY", text: "", url: "" }]);

  const [trigType, setTrigType] = useState<MarketingTriggerType>("call_day");
  const [trigNode, setTrigNode] = useState(flowNodes.find((n) => n.type === "question")?.id ?? "");
  const [trigDays, setTrigDays] = useState(0);
  const [trigDir, setTrigDir] = useState<"after" | "before">("before");
  const [trigTemplate, setTrigTemplate] = useState("");
  const [savingTrig, setSavingTrig] = useState(false);

  const [audience, setAudience] = useState<"all" | "completed" | "upcoming_call">("all");
  const [broadcastTpl, setBroadcastTpl] = useState("");
  const [broadcastMode, setBroadcastMode] = useState<"now" | "schedule">("now");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("08:00");
  const [broadcasting, setBroadcasting] = useState(false);

  const leadTemplates = useMemo(
    () => templates.filter((t) => !isMarketingSystemTemplateName(t.name)),
    [templates]
  );
  const systemTemplates = useMemo(
    () => templates.filter((t) => isMarketingSystemTemplateName(t.name)),
    [templates]
  );
  const approvedForTriggers = templates.filter(
    (t) => t.disabled !== true && ["APPROVED", "PENDING"].includes(String(t.status).toUpperCase())
  );

  function resetForm() {
    setEditing(null);
    setPurpose("");
    setName("");
    setCategory("UTILITY");
    setLanguage("he");
    setBody("");
    setHeader("");
    setFooter("");
    setButtons([{ kind: "QUICK_REPLY", text: "", url: "" }]);
  }

  function applyPurpose(next: MarketingTriggerType | "") {
    setPurpose(next);
    if (!next) return;
    const preset = MARKETING_TEMPLATE_PRESETS[next];
    setName(uniqueTemplateName(preset.name, templates.map((t) => t.name)));
    setCategory(preset.category);
    setBody(preset.body);
  }

  function openEdit(t: AdminTemplateRow) {
    const draft = parseDashboardTemplateComponents(t.components);
    if (!draft) {
      setError("הטמפלייט הזה כולל רכיבים שאי אפשר לערוך מכאן (תמונה / כפתורים מיוחדים)");
      return;
    }
    setEditing(t);
    setPurpose("");
    setName(t.name);
    setCategory((String(t.category).toUpperCase() === "MARKETING" ? "MARKETING" : "UTILITY") as
      | "MARKETING"
      | "UTILITY");
    setLanguage(t.language || "he");
    setBody(draft.body);
    setHeader(draft.header);
    setFooter(draft.footer);
    setButtons(draft.buttons.length ? draft.buttons : [{ kind: "QUICK_REPLY", text: "", url: "" }]);
    setShowCreate(true);
  }

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/marketing/templates?refresh=1");
      const j = (await res.json().catch(() => ({}))) as {
        templates?: AdminTemplateRow[];
        error?: string;
        detail?: string;
      };
      if (!res.ok) throw new Error(j.detail || j.error || `http_${res.status}`);
      setTemplates(j.templates ?? []);
      setSuccess(`סונכרנו ${j.templates?.length ?? 0} טמפלייטים ממטא`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "סנכרון נכשל");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (migrationRequired || initialTemplates.length > 0) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first empty cache only
  }, []);

  async function onSaveTemplate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const slots = purpose ? MARKETING_TEMPLATE_PARAM_SLOTS[purpose] : [];
      const components = buildMetaComponents({
        body,
        header,
        footer,
        buttons,
        exampleValues: slots.map(marketingPresetExampleForSlot),
      });
      const res = await fetch("/api/admin/marketing/templates", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editing
            ? { id: editing.id, name: editing.name, language: editing.language, category, components }
            : { name, category, language, components }
        ),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; detail?: string; template?: AdminTemplateRow };
      if (!res.ok) throw new Error(j.detail || j.error || `http_${res.status}`);
      const saved = j.template;
      if (saved) {
        setTemplates((prev) => {
          const idx = prev.findIndex(
            (r) => (saved.id && r.id === saved.id) || (r.name === saved.name && r.language === saved.language)
          );
          if (idx < 0) return [saved, ...prev];
          const next = [...prev];
          next[idx] = { ...next[idx], ...saved };
          return next;
        });
      }
      setSuccess(editing ? "נשלח לאישור מטא" : "נוצר ונשלח לאישור מטא");
      setShowCreate(false);
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שמירה נכשלה");
    } finally {
      setCreating(false);
    }
  }

  async function toggleDisabled(t: AdminTemplateRow) {
    const nextDisabled = t.disabled !== true;
    try {
      const res = await fetch("/api/admin/marketing/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, name: t.name, language: t.language, disabled: nextDisabled }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; template?: AdminTemplateRow };
      if (!res.ok) throw new Error(j.error || `http_${res.status}`);
      setTemplates((prev) =>
        prev.map((row) => (row.id === t.id || (row.name === t.name && row.language === t.language) ? { ...row, ...j.template, disabled: nextDisabled } : row))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "עדכון נכשל");
    }
  }

  async function saveTrigger(e: React.FormEvent) {
    e.preventDefault();
    setSavingTrig(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/marketing/triggers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trigger_type: trigType,
          flow_node_id: trigType === "flow_completed" ? null : trigNode || null,
          delay_days: trigDays,
          delay_direction: marketingAllowsDelayBefore(trigType) ? trigDir : "after",
          template_name: trigTemplate,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; trigger?: AdminTriggerRow };
      if (!res.ok) throw new Error(j.error || `http_${res.status}`);
      if (j.trigger) setTriggers((prev) => [...prev, j.trigger!]);
      setSuccess("הטריגר נוסף");
    } catch (e) {
      setError(e instanceof Error ? e.message : "שמירת טריגר נכשלה");
    } finally {
      setSavingTrig(false);
    }
  }

  async function patchTrigger(id: string, patch: Record<string, unknown>) {
    const res = await fetch("/api/admin/marketing/triggers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string; trigger?: AdminTriggerRow };
    if (!res.ok) throw new Error(j.error || `http_${res.status}`);
    if (j.trigger) {
      setTriggers((prev) => prev.map((t) => (t.id === id ? { ...t, ...j.trigger } : t)));
    }
  }

  async function deleteTrigger(id: string) {
    if (!window.confirm("למחוק את הטריגר?")) return;
    const res = await fetch("/api/admin/marketing/triggers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error || "מחיקה נכשלה");
      return;
    }
    setTriggers((prev) => prev.filter((t) => t.id !== id));
  }

  async function sendBroadcast(e: React.FormEvent) {
    e.preventDefault();
    setBroadcasting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/marketing/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience,
          template_name: broadcastTpl,
          send: broadcastMode,
          schedule_date: scheduleDate,
          schedule_time: scheduleTime,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        recipients?: number;
        queued?: number;
        flushed?: number;
        remaining?: number;
      };
      if (!res.ok) throw new Error(j.error || `http_${res.status}`);
      setSuccess(
        `שידור: ${j.recipients ?? 0} נמענים, נשלחו עכשיו ${j.flushed ?? 0}, בתור ${j.remaining ?? 0}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "שידור נכשל");
    } finally {
      setBroadcasting(false);
    }
  }

  function TemplateCard({ t, system }: { t: AdminTemplateRow; system?: boolean }) {
    const badge = statusLabel(t.status);
    const preview = bodyTextFromTemplateComponents(t.components);
    const editable = isMetaTemplateContentEditable(t.status);
    return (
      <div
        className={`rounded-2xl border bg-white p-4 ${t.disabled ? "opacity-60 border-zinc-200" : "border-violet-100"}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-zinc-900" dir="ltr">
                {t.name}
              </span>
              {system ? (
                <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-800">
                  {marketingSystemTemplateLabel(t.name)}
                </span>
              ) : null}
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${badge.className}`}>{badge.text}</span>
              {t.disabled ? (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">מושבת</span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {t.category} · {t.language}
            </p>
          </div>
          <div className="flex gap-1">
            {editable && !system ? (
              <button
                type="button"
                onClick={() => openEdit(t)}
                className="rounded-lg border border-zinc-200 p-1.5 text-zinc-600 hover:bg-zinc-50"
                aria-label="עריכה"
              >
                <Pencil className="h-4 w-4" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void toggleDisabled(t)}
              className="rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
            >
              {t.disabled ? "הפעל" : "השבת"}
            </button>
          </div>
        </div>
        {preview ? <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-700">{preview}</p> : null}
      </div>
    );
  }

  if (migrationRequired) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        חסרות טבלאות בדאטהבייס. הריצו ב-Supabase:{" "}
        <code dir="ltr">supabase/marketing_admin_templates.sql</code>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-zinc-900">טמפלייטים ממטא</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-violet-800"
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              סנכרן ממטא
            </button>
            <button
              type="button"
              onClick={() => {
                resetForm();
                setShowCreate(true);
              }}
              className="rounded-xl bg-[#7133da] px-3 py-2 text-sm text-white"
            >
              טמפלייט חדש
            </button>
          </div>
        </div>
        <p className="text-sm text-zinc-500">
          כולל טמפלייטים קיימים ב‑WABA של קו זואי (גם התראות לבעלי עסקים). סנכרון לא מוחק שורות ולא דורס השבתה מקומית.
        </p>
        {leadTemplates.length === 0 && systemTemplates.length === 0 ? (
          <p className="text-sm text-zinc-500">אין טמפלייטים בקבלה — לחצו «סנכרן ממטא».</p>
        ) : null}
        {leadTemplates.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-zinc-700">שיווק ללידים</h3>
            <div className="grid gap-3">
              {leadTemplates.map((t) => (
                <TemplateCard key={`${t.id ?? t.name}:${t.language}`} t={t} />
              ))}
            </div>
          </div>
        ) : null}
        {systemTemplates.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-zinc-700">התראות מערכת (לבעלי עסקים)</h3>
            <div className="grid gap-3">
              {systemTemplates.map((t) => (
                <TemplateCard key={`${t.id ?? t.name}:${t.language}`} t={t} system />
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-900">טריגרים</h2>
        {triggers.length === 0 ? <p className="text-sm text-zinc-500">עדיין אין טריגרים.</p> : null}
        <div className="grid gap-2">
          {triggers.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-violet-100 bg-white px-4 py-3">
              <div className="text-sm">
                <div className="font-medium text-zinc-900">
                  {TRIGGER_OPTIONS.find((o) => o.value === t.trigger_type)?.label ?? t.trigger_type}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {t.trigger_type !== "flow_completed" ? `${nodeCaption(flowNodes, t.flow_node_id)} · ` : null}
                  {delayLabel(t)} · <span dir="ltr">{t.template_name}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-zinc-200 px-2 py-1 text-xs"
                  onClick={() => void patchTrigger(t.id, { enabled: !t.enabled }).catch((e) => setError(String(e)))}
                >
                  {t.enabled ? "פעיל" : "כבוי"}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-700"
                  onClick={() => void deleteTrigger(t.id)}
                >
                  מחק
                </button>
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={(e) => void saveTrigger(e)} className="space-y-3 rounded-2xl border border-violet-100 bg-white p-4">
          <h3 className="text-sm font-medium text-zinc-800">הוסף טריגר</h3>
          <select className={FIELD} value={trigType} onChange={(e) => setTrigType(e.target.value as MarketingTriggerType)}>
            {TRIGGER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {trigType !== "flow_completed" ? (
            <div className="space-y-1">
              <label className="text-xs text-zinc-600">נוד בפלואו (לפי מספר בתצוגת הבילדר)</label>
              <select className={FIELD} value={trigNode} onChange={(e) => setTrigNode(e.target.value)} required={trigType === "node_answered"}>
                <option value="">{trigType === "call_day" ? "כל שיחה שנקבעה (גם ידנית בפייפליין)" : "בחרו נוד"}</option>
                {flowNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    #{n.rank} {n.type} — {n.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-zinc-600">ימים</label>
              <input
                type="number"
                min={0}
                className={FIELD}
                value={trigDays}
                onChange={(e) => setTrigDays(Number(e.target.value) || 0)}
              />
            </div>
            {marketingAllowsDelayBefore(trigType) ? (
              <div>
                <label className="text-xs text-zinc-600">לפני / אחרי יום השיחה</label>
                <select className={FIELD} value={trigDir} onChange={(e) => setTrigDir(e.target.value as "after" | "before")}>
                  <option value="before">לפני</option>
                  <option value="after">אחרי</option>
                </select>
              </div>
            ) : (
              <p className="self-end text-xs text-zinc-500">תמיד אחרי האירוע</p>
            )}
          </div>
          <select className={FIELD} value={trigTemplate} onChange={(e) => setTrigTemplate(e.target.value)} required>
            <option value="">טמפלייט לשליחה</option>
            {approvedForTriggers.map((t) => (
              <option key={`${t.name}:${t.language}`} value={t.name}>
                {t.name} ({t.status})
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={savingTrig}
            className="rounded-xl bg-[#7133da] px-4 py-2 text-sm text-white disabled:opacity-60"
          >
            {savingTrig ? "שומר…" : "הוסף טריגר"}
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-900">שידור ללידים קיימים</h2>
        <p className="text-sm text-zinc-500">
          שליחה מיידית שולחת עד 20 עכשיו; השאר ממתינים לקרון הקיים (מומלץ כל שעה). כל נמען = קריאת Meta אחת.
        </p>
        <form onSubmit={(e) => void sendBroadcast(e)} className="space-y-3 rounded-2xl border border-violet-100 bg-white p-4">
          <select className={FIELD} value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)}>
            <option value="all">כל מי שדיבר עם זואי</option>
            <option value="completed">סיימו את הפלואו</option>
            <option value="upcoming_call">יש שיחה קבועה מעכשיו והלאה</option>
          </select>
          <select className={FIELD} value={broadcastTpl} onChange={(e) => setBroadcastTpl(e.target.value)} required>
            <option value="">טמפלייט מאושר</option>
            {templates
              .filter((t) => t.disabled !== true && String(t.status).toUpperCase() === "APPROVED")
              .map((t) => (
                <option key={`${t.name}:${t.language}`} value={t.name}>
                  {t.name}
                </option>
              ))}
          </select>
          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input type="radio" checked={broadcastMode === "now"} onChange={() => setBroadcastMode("now")} />
              מיידי
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={broadcastMode === "schedule"} onChange={() => setBroadcastMode("schedule")} />
              מתוזמן
            </label>
          </div>
          {broadcastMode === "schedule" ? (
            <div className="grid grid-cols-2 gap-2">
              <input type="date" className={FIELD} value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} required />
              <input type="time" className={FIELD} value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
            </div>
          ) : null}
          <button
            type="submit"
            disabled={broadcasting}
            className="rounded-xl bg-[#7133da] px-4 py-2 text-sm text-white disabled:opacity-60"
          >
            {broadcasting ? "שולח…" : "שלח"}
          </button>
        </form>
      </section>

      {showCreate ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4">
          <form
            onSubmit={(e) => void onSaveTemplate(e)}
            className="my-8 w-full max-w-xl space-y-3 rounded-2xl bg-white p-5 shadow-xl"
          >
            <h2 className="text-base font-semibold">{editing ? "עריכת טמפלייט" : "טמפלייט חדש"}</h2>
            {!editing ? (
              <select
                className={FIELD}
                value={purpose}
                onChange={(e) => applyPurpose((e.target.value || "") as MarketingTriggerType | "")}
              >
                <option value="">בחירה ידנית</option>
                {TRIGGER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : null}
            <input
              className={`${FIELD} text-left`}
              dir="ltr"
              placeholder="call_today"
              value={name}
              disabled={Boolean(editing)}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
              required
            />
            <textarea
              className={FIELD}
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              placeholder={"היי {{1}}, יש לנו שיחה היום בשעה {{2}}"}
            />
            <p className="text-xs text-zinc-500">
              {purpose ? marketingPresetVarHint(purpose) : "{{1}} שם פרטי · {{2}} שעת שיחה (לתזכורת)"}
            </p>
            <input className={FIELD} placeholder="כותרת (אופציונלי)" value={header} onChange={(e) => setHeader(e.target.value)} />
            <input className={FIELD} placeholder="פוטר (אופציונלי)" value={footer} onChange={(e) => setFooter(e.target.value)} />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm"
                onClick={() => {
                  setShowCreate(false);
                  resetForm();
                }}
              >
                ביטול
              </button>
              <button type="submit" disabled={creating} className="rounded-xl bg-[#7133da] px-4 py-2 text-sm text-white">
                {creating ? "שולח…" : "שלח לאישור מטא"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
