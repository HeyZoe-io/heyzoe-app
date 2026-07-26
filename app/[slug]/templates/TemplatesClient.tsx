"use client";

import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Loader2, RefreshCw, X } from "lucide-react";
import {
  DASHBOARD_CENTERED_CONTENT,
  DASHBOARD_SETTINGS_SHELL,
} from "@/app/dashboard/[slug]/settings/settings-ui";

export type TemplateRow = {
  id?: string;
  business_id?: number;
  waba_template_id?: string | null;
  name: string;
  category: string;
  language: string;
  status: string;
  components?: unknown;
  created_at?: string;
  updated_at?: string;
};

type Props = {
  slug: string;
  initialTemplates: TemplateRow[];
  initialLeadTemplateName: string | null;
  leadsWebhookSecret: string;
  hasWaba: boolean;
};

type ButtonDraft = {
  kind: "QUICK_REPLY" | "URL";
  text: string;
  url: string;
};

const TEMPLATE_NAME_RE = /^[a-z0-9_]+$/;

function statusBadgeClass(status: string): string {
  const s = status.toUpperCase();
  if (s === "APPROVED") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (s === "REJECTED") return "bg-red-50 text-red-700 border-red-200";
  return "bg-amber-50 text-amber-800 border-amber-200";
}

function statusLabel(status: string): string {
  const s = status.toUpperCase();
  if (s === "APPROVED") return "מאושר";
  if (s === "REJECTED") return "נדחה";
  if (s === "PENDING") return "ממתין לאישור";
  return status || "—";
}

function extractBodyVarCount(body: string): number {
  let max = 0;
  for (const m of body.matchAll(/\{\{(\d+)\}\}/g)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

function buildMetaComponents(input: {
  body: string;
  header: string;
  footer: string;
  buttons: ButtonDraft[];
}): unknown[] {
  const components: Record<string, unknown>[] = [];
  const header = input.header.trim();
  if (header) {
    components.push({ type: "HEADER", format: "TEXT", text: header });
  }

  const body = input.body.trim();
  const varCount = extractBodyVarCount(body);
  const bodyComp: Record<string, unknown> = { type: "BODY", text: body };
  if (varCount > 0) {
    const examples = Array.from({ length: varCount }, (_, i) =>
      i === 0 ? "דנה" : `ערך${i + 1}`
    );
    bodyComp.example = { body_text: [examples] };
  }
  components.push(bodyComp);

  const footer = input.footer.trim();
  if (footer) {
    components.push({ type: "FOOTER", text: footer });
  }

  const buttons = input.buttons
    .map((b) => ({
      kind: b.kind,
      text: b.text.trim(),
      url: b.url.trim(),
    }))
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

function ModalShell({
  title,
  onClose,
  children,
  widthClass = "max-w-lg",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
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
      <div className="relative mx-auto mt-12 w-[92vw] max-h-[85vh] overflow-y-auto">
        <div
          className={`mx-auto ${widthClass} rounded-2xl bg-white shadow-xl border border-zinc-200 overflow-hidden`}
          role="dialog"
          aria-modal="true"
        >
          <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-zinc-900 text-right">{title}</p>
            <button
              type="button"
              className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100"
              onClick={onClose}
              aria-label="סגור"
            >
              <X className="h-4 w-4" />
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

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-zinc-600">{label}</p>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            } catch {
              /* ignore */
            }
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "הועתק" : "העתק"}
        </button>
      </div>
      <pre
        className="overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-[11px] leading-relaxed text-zinc-800 whitespace-pre-wrap break-all text-left"
        dir="ltr"
      >
        {text}
      </pre>
    </div>
  );
}

export default function TemplatesClient({
  slug,
  initialTemplates,
  initialLeadTemplateName,
  leadsWebhookSecret,
  hasWaba,
}: Props) {
  const [templates, setTemplates] = useState<TemplateRow[]>(initialTemplates);
  const [leadTemplateName, setLeadTemplateName] = useState<string | null>(
    initialLeadTemplateName
  );
  const [refreshing, setRefreshing] = useState(false);
  const [settingLead, setSettingLead] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [showAutomation, setShowAutomation] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(false);

  const [name, setName] = useState("");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY">("MARKETING");
  const [language, setLanguage] = useState("he");
  const [body, setBody] = useState("");
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState<ButtonDraft[]>([
    { kind: "QUICK_REPLY", text: "", url: "" },
  ]);

  const nameValid = !name || TEMPLATE_NAME_RE.test(name);
  const canSubmitCreate =
    TEMPLATE_NAME_RE.test(name) && body.trim().length > 0 && hasWaba && !creating;

  const incomingUrl = "https://heyzoe.io/api/leads/incoming";
  const zapierBodyExample = useMemo(
    () =>
      JSON.stringify(
        { full_name: "<map lead name>", phone: "<map lead phone>" },
        null,
        2
      ),
    []
  );
  const curlExample = useMemo(() => {
    const secret = leadsWebhookSecret || "<leads_webhook_secret>";
    return [
      `curl -X POST ${incomingUrl} \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "x-leads-secret: ${secret}" \\`,
      `  -d '{"full_name":"דנה","phone":"0501234567"}'`,
    ].join("\n");
  }, [leadsWebhookSecret]);

  const reloadFromApi = useCallback(
    async (refresh: boolean) => {
      const qs = refresh ? "?refresh=1" : "";
      const res = await fetch(`/api/${encodeURIComponent(slug)}/templates${qs}`, {
        cache: "no-store",
      });
      const j = (await res.json().catch(() => ({}))) as {
        templates?: TemplateRow[];
        lead_template_name?: string | null;
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        throw new Error(j.detail || j.error || `http_${res.status}`);
      }
      setTemplates(Array.isArray(j.templates) ? j.templates : []);
      if (j.lead_template_name !== undefined) {
        setLeadTemplateName(j.lead_template_name ? String(j.lead_template_name) : null);
      }
    },
    [slug]
  );

  async function onRefresh() {
    setError(null);
    setSuccess(null);
    setRefreshing(true);
    try {
      await reloadFromApi(true);
      setSuccess("הרשימה עודכנה ממטא");
    } catch (e) {
      setError(e instanceof Error ? e.message : "רענון נכשל");
    } finally {
      setRefreshing(false);
    }
  }

  async function onSetLead(templateName: string) {
    setError(null);
    setSuccess(null);
    setSettingLead(templateName);
    try {
      const res = await fetch(`/api/${encodeURIComponent(slug)}/templates/set-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_name: templateName }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        lead_template_name?: string;
        error?: string;
      };
      if (!res.ok) {
        if (j.error === "template_not_approved") {
          throw new Error("אפשר להגדיר רק טמפלייט שאושר במטא");
        }
        throw new Error(j.error || `http_${res.status}`);
      }
      setLeadTemplateName(String(j.lead_template_name ?? templateName));
      setSuccess(`«${templateName}» הוגדר כטמפלייט הפתיחה ללידים`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "עדכון נכשל");
    } finally {
      setSettingLead(null);
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreateSuccess(false);
    if (!TEMPLATE_NAME_RE.test(name)) {
      setError("שם טמפלייט לא תקין");
      return;
    }
    if (!body.trim()) {
      setError("גוף ההודעה חובה");
      return;
    }
    setCreating(true);
    try {
      const components = buildMetaComponents({ body, header, footer, buttons });
      const res = await fetch(`/api/${encodeURIComponent(slug)}/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          language,
          components,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        template?: TemplateRow;
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        if (j.error === "invalid_template_name") throw new Error("שם טמפלייט לא תקין");
        if (j.error === "no_waba") throw new Error("אין WABA מחובר לעסק — חברו WhatsApp קודם");
        throw new Error(j.detail || j.error || `http_${res.status}`);
      }
      setCreateSuccess(true);
      setSuccess("נשלח לאישור מטא");
      await reloadFromApi(false);
      window.setTimeout(() => {
        setShowCreate(false);
        setCreateSuccess(false);
        setName("");
        setBody("");
        setHeader("");
        setFooter("");
        setButtons([{ kind: "QUICK_REPLY", text: "", url: "" }]);
        setCategory("MARKETING");
        setLanguage("he");
      }, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "יצירה נכשלה");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      className={`${DASHBOARD_SETTINGS_SHELL} ${DASHBOARD_CENTERED_CONTENT} space-y-6`}
      dir="rtl"
      style={{ fontFamily: '"Fredoka", system-ui, sans-serif' }}
    >
      <header className="space-y-2 text-right">
        <h1 className="text-2xl font-semibold text-zinc-900 sm:text-3xl">טמפלייטים</h1>
        <p className="text-sm leading-relaxed text-zinc-600 sm:text-[15px]">
          טמפלייטים הם הודעות מוכנות מראש שחייבות אישור של Meta כדי לשלוח בוואטסאפ{" "}
          <strong className="font-medium text-zinc-800">מחוץ לחלון 24 השעות</strong> — כלומר
          לחזור לליד שלא כתב ב־24 השעות האחרונות. כל טמפלייט עובר אישור במטא (לרוב דקות עד 24
          שעות). שליחת טמפלייט שיווקי (Marketing) למספר ישראלי עולה כ־₪0.13 להודעה (תעריף לפי
          מדינת הנמען, נתון לשינוי ע״י Meta).
        </p>
      </header>

      <section className="rounded-2xl border border-[#7133da]/25 bg-[#7133da]/5 p-4 sm:p-5 shadow-sm">
        <p className="text-sm leading-relaxed text-zinc-800 sm:text-[15px]">
          מריצים קמפיין לידים ורוצים שזואי תשלח הודעת ווטסאפ לליד שהשאיר פרטים? צרו טמפלייט פתיחה
          שישלח אוטומטית והוסיפו את זואי לאוטומציה שלכם.
        </p>
        <button
          type="button"
          onClick={() => setShowAutomation(true)}
          className="mt-3 inline-flex items-center rounded-xl bg-[#7133da] px-4 py-2 text-sm font-medium text-white hover:bg-[#5f28c0]"
        >
          איך מחברים לאוטומציה?
        </button>
      </section>

      {(error || success) && (
        <div
          className={`rounded-xl border px-3 py-2 text-sm ${
            error
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {error || success}
        </div>
      )}

      <section className="rounded-2xl border border-[#7133da]/20 bg-white/85 p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-zinc-900">הטמפלייטים שלכם</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
            >
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              רענן
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setShowCreate(true);
              }}
              className="inline-flex items-center rounded-xl bg-[#7133da] px-3 py-2 text-sm font-medium text-white hover:bg-[#5f28c0]"
            >
              צור טמפלייט חדש
            </button>
          </div>
        </div>

        {!hasWaba && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            אין WABA מחובר לעסק — אי אפשר ליצור או לרענן טמפלייטים ממטא עד שתתחברו ל־WhatsApp.
          </p>
        )}

        {templates.length === 0 ? (
          <p className="text-sm text-zinc-500">עדיין אין טמפלייטים. צרו אחד חדש או לחצו «רענן».</p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-100 overflow-hidden">
            {templates.map((t) => {
              const isApproved = String(t.status).toUpperCase() === "APPROVED";
              const isCurrent = leadTemplateName != null && leadTemplateName === t.name;
              return (
                <li
                  key={`${t.name}:${t.language}:${t.id ?? t.waba_template_id ?? ""}`}
                  className="flex flex-col gap-3 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4"
                >
                  <div className="space-y-1 text-right min-w-0">
                    <p className="font-medium text-zinc-900 break-all" dir="ltr">
                      {t.name}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 font-medium ${statusBadgeClass(
                          t.status
                        )}`}
                      >
                        {statusLabel(t.status)}
                      </span>
                      <span>{t.category || "—"}</span>
                      <span>{t.language || "—"}</span>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {isApproved ? (
                      isCurrent ? (
                        <span className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                          <Check className="h-4 w-4" />
                          טמפלייט הפתיחה הנוכחי
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={settingLead === t.name}
                          onClick={() => void onSetLead(t.name)}
                          className="rounded-xl border border-[#7133da]/30 bg-white px-3 py-2 text-sm text-[#7133da] hover:bg-[#7133da]/5 disabled:opacity-60"
                        >
                          {settingLead === t.name ? (
                            <span className="inline-flex items-center gap-1">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              מגדיר…
                            </span>
                          ) : (
                            "הגדר כטמפלייט פתיחה ללידים"
                          )}
                        </button>
                      )
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {showCreate && (
        <ModalShell title="צור טמפלייט חדש" onClose={() => !creating && setShowCreate(false)} widthClass="max-w-xl">
          <form className="space-y-4" onSubmit={(e) => void onCreate(e)}>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-800">שם הטמפלייט</label>
              <input
                value={name}
                onChange={(e) => {
                  const next = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
                  setName(next);
                }}
                className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-left"
                dir="ltr"
                placeholder="lead_welcome"
                autoComplete="off"
                required
              />
              <p className="text-xs text-zinc-500">
                שם באנגלית בלבד, אותיות קטנות, מספרים וקו תחתון (_). ללא רווחים ועברית.
              </p>
              {!nameValid && (
                <p className="text-xs text-red-600">השם יכול לכלול רק a-z, 0-9 ו־_</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-zinc-800">קטגוריה</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as "MARKETING" | "UTILITY")}
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                >
                  <option value="MARKETING">MARKETING</option>
                  <option value="UTILITY">UTILITY</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-zinc-800">שפה</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                >
                  <option value="he">he</option>
                  <option value="en">en</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-800">גוף ההודעה (חובה)</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                required
                className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                placeholder={"היי {{1}}, תודה שהשארת פרטים — נשמח לחזור אליך!"}
              />
              <p className="text-xs text-zinc-500">
                אפשר להשתמש ב־{"{{1}}"}, {"{{2}}"} וכו׳. {"{{1}}"} הוא בדרך כלל שם פרטי של הליד.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-800">כותרת (אופציונלי)</label>
              <input
                value={header}
                onChange={(e) => setHeader(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-800">פוטר (אופציונלי)</label>
              <input
                value={footer}
                onChange={(e) => setFooter(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium text-zinc-800">כפתורים (אופציונלי)</label>
                {buttons.length < 2 && (
                  <button
                    type="button"
                    className="text-xs text-[#7133da] hover:underline"
                    onClick={() =>
                      setButtons((prev) => [...prev, { kind: "QUICK_REPLY", text: "", url: "" }])
                    }
                  >
                    + כפתור
                  </button>
                )}
              </div>
              {buttons.map((b, idx) => (
                <div key={idx} className="rounded-xl border border-zinc-100 p-3 space-y-2">
                  <div className="flex gap-2">
                    <select
                      value={b.kind}
                      onChange={(e) => {
                        const kind = e.target.value as ButtonDraft["kind"];
                        setButtons((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, kind } : row))
                        );
                      }}
                      className="rounded-lg border border-zinc-200 px-2 py-1.5 text-xs"
                    >
                      <option value="QUICK_REPLY">Quick reply</option>
                      <option value="URL">URL</option>
                    </select>
                    <input
                      value={b.text}
                      onChange={(e) =>
                        setButtons((prev) =>
                          prev.map((row, i) =>
                            i === idx ? { ...row, text: e.target.value } : row
                          )
                        )
                      }
                      placeholder="טקסט כפתור"
                      className="flex-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-sm"
                    />
                  </div>
                  {b.kind === "URL" && (
                    <input
                      value={b.url}
                      onChange={(e) =>
                        setButtons((prev) =>
                          prev.map((row, i) =>
                            i === idx ? { ...row, url: e.target.value } : row
                          )
                        )
                      }
                      placeholder="https://"
                      dir="ltr"
                      className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm text-left"
                    />
                  )}
                </div>
              ))}
            </div>

            {createSuccess && (
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                נשלח לאישור מטא
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={creating}
                onClick={() => setShowCreate(false)}
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                ביטול
              </button>
              <button
                type="submit"
                disabled={!canSubmitCreate}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#7133da] px-4 py-2 text-sm font-medium text-white hover:bg-[#5f28c0] disabled:opacity-60"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                שלח לאישור מטא
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {showAutomation && (
        <ModalShell
          title="חיבור לאוטומציה"
          onClose={() => setShowAutomation(false)}
          widthClass="max-w-2xl"
        >
          <div className="space-y-5 text-sm text-zinc-700">
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 text-xs leading-relaxed">
              הסוד הזה מזהה את העסק שלכם — אל תשתפו אותו בפומבי.
            </p>

            <p className="leading-relaxed">
              כדי שזואי תשלח טמפלייט פתיחה לליד חדש, הגדירו קודם טמפלייט מאושר כ־«טמפלייט הפתיחה
              ללידים» ברשימה למעלה, ואז חברו את מקור הלידים לאחד מהאופציות הבאות.
            </p>

            <section className="space-y-3 rounded-2xl border border-zinc-100 p-4">
              <h3 className="font-semibold text-zinc-900">שיטה 1 — Zapier (ללא קוד)</h3>
              <ol className="list-decimal list-inside space-y-1.5 text-sm leading-relaxed">
                <li>צרו Zap חדש</li>
                <li>Trigger = מקור הלידים שלכם (טופס / גיליון / CRM)</li>
                <li>Action = Webhooks by Zapier → POST</li>
                <li>מלאו את הפרטים הבאים:</li>
              </ol>
              <CopyBlock label="URL" text={incomingUrl} />
              <CopyBlock
                label="Header: x-leads-secret"
                text={leadsWebhookSecret || "(חסר סוד לעסק — פנו לתמיכה)"}
              />
              <CopyBlock label="Body (JSON)" text={zapierBodyExample} />
              <p className="text-xs text-zinc-500">
                אין צורך ב־business_slug — הטוקן מזהה את העסק אוטומטית.
              </p>
            </section>

            <section className="space-y-3 rounded-2xl border border-zinc-100 p-4">
              <h3 className="font-semibold text-zinc-900">שיטה 2 — קוד / curl</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">
                מספר הטלפון מנורמל אוטומטית לפורמט ישראלי. חייבים טמפלייט פתיחה מאושר בעסק.
              </p>
              <CopyBlock label="curl" text={curlExample} />
            </section>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
