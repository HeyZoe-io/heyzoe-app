"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import dynamic from "next/dynamic";
import NextLink from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  ArrowLeft, ArrowRight, Check,
  Copy,
  GripVertical, Link, Loader2, Plus, RotateCcw, Sparkles, Trash2, Upload, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buildWelcomeMessageForStorage, splitWelcomeForChat } from "@/lib/welcome-message";
import {
  WA_SALES_FOLLOWUP_1_DEFAULT,
  WA_SALES_FOLLOWUP_2_DEFAULT,
  WA_SALES_FOLLOWUP_3_DEFAULT,
} from "@/lib/wa-sales-followup-defaults";
import {
  type SalesFlowConfig,
  type SalesFlowCtaButton,
  type SalesFlowExtraStep,
  composeGreeting,
  defaultSalesFlowConfig,
  fillAfterExperienceTemplate,
  fillAfterServicePickTemplate,
  fillCtaBodyTemplate,
  formatServiceLevelsText,
  parseSalesFlowFromSocial,
  serializeSalesFlowConfig,
  syncWelcomeFromSalesFlow,
  trialServicePhraseForAfterPick,
} from "@/lib/sales-flow";
import { TRIAL_SERVICE_NAME_MAX_CHARS, truncateTrialServiceName } from "@/lib/trial-service";
import { dashboardSettingsFetcher, dashboardSettingsKey } from "@/lib/fetchers";
import { Field, StepHeader, Textarea } from "./settings-ui";

// ─── Types ────────────────────────────────────────────────────────────────────

type QuickReply  = { id: string; label: string; reply: string };
type Objection   = { id: string; question: string; answer: string };
type SegQuestion = { id: string; question: string; answers: { id: string; text: string; service_slug: string }[] };
type ServiceItem = {
  ui_id: string; name: string; price_text: string;
  duration: string; payment_link: string;
  service_slug: string; location_text: string; description: string;
  levels_enabled: boolean; levels: string[];
  /** תיאור קצר אחרי בחירת האימון בפלואו (משפט אחד) */
  benefit_line: string;
  /** מדיה שנשלחת לפני תשובת «בחירת סוג האימון» בווטסאפ */
  trial_pick_media_url: string;
  trial_pick_media_type: "image" | "video" | "";
};

type WhatsAppChannel = {
  phone_display: string;
  provisioning_status: "pending" | "active" | "failed" | null;
} | null;

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = [
  "לינקים",
  "על העסק",
  "אימון ניסיון",
  "מכירה",
  "פולואפ",
];

async function readSaveErrorFromResponse(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    if (j.error === "unauthorized") return "נדרשת התחברות מחדש.";
    if (j.error === "slug_required") return "חסר מזהה עסק.";
    if (j.error === "slug_taken") return "כתובת העסק תפוסה.";
    if (typeof j.error === "string" && j.error.trim()) return j.error.trim();
  } catch {
    /* not json */
  }
  return `שגיאת שרת (${res.status})`;
}

const AUTOSAVE_DEBOUNCE_MS = 1600;
const AUTOSAVE_ENABLE_DELAY_MS = 500;
/** מדיה לפתיחה: העלאה ישירה ל-Supabase (Signed URL) — לא עוברת בגוף הבקשה ל-Vercel */
const MAX_MEDIA_UPLOAD_BYTES = 16 * 1024 * 1024;

function videoUrlForPreview(url: string) {
  if (!url) return url;
  const base = url.split("#")[0];
  return `${base}#t=0.001`;
}

function uid() { return Math.random().toString(36).slice(2, 9); }
function toSlug(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-");
}

function formatIlWhatsAppPhoneFriendly(input: string): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/[^\d+]/g, "");
  const onlyDigits = digits.replace(/[^\d]/g, "");
  // Prefer formatting +972XXXXXXXXX -> +972-XX-XXX-XXXX (best-effort for IL locals)
  if (digits.startsWith("+972") || onlyDigits.startsWith("972")) {
    const rest = onlyDigits.startsWith("972") ? onlyDigits.slice(3) : onlyDigits;
    const local = rest.startsWith("972") ? rest.slice(3) : rest.slice(0); // safety
    if (local.length === 9) {
      const p1 = local.slice(0, 2);
      const p2 = local.slice(2, 5);
      const p3 = local.slice(5, 9);
      return `+972-${p1}-${p2}-${p3}`;
    }
  }
  // If already contains +972, at least normalize spacing.
  return raw.replace(/\s+/g, " ").trim();
}

function WhatsAppNumberSection({ slug }: { slug: string }) {
  const fetcher = useCallback(async (key: string) => {
    const res = await fetch(key, { method: "GET" });
    const j = (await res.json()) as { channel?: WhatsAppChannel; error?: string };
    if (!res.ok) throw new Error(j.error || `request_failed (${res.status})`);
    return (j.channel ?? null) as WhatsAppChannel;
  }, []);

  const key = useMemo(() => `/api/dashboard/whatsapp-channel?slug=${encodeURIComponent(slug)}`, [slug]);
  const { data, error, isLoading } = useSWR(key, fetcher, {
    revalidateOnFocus: true,
    keepPreviousData: true,
    refreshInterval: (latest) => {
      const st = (latest as WhatsAppChannel)?.provisioning_status ?? null;
      return st === "pending" ? 10_000 : 0;
    },
  });

  const status = data?.provisioning_status ?? null;
  const friendly = formatIlWhatsAppPhoneFriendly(data?.phone_display ?? "");

  const [metaStatus, setMetaStatus] = useState<null | "CONNECTED" | "PENDING" | "UNVERIFIED">(null);
  const [metaChecked, setMetaChecked] = useState(false);
  const pollRef = useRef<number | null>(null);
  const metaReqIdRef = useRef(0);

  const fetchMetaStatus = useCallback(async () => {
    const my = (metaReqIdRef.current += 1);
    try {
      const res = await fetch(`/api/dashboard/whatsapp-status?slug=${encodeURIComponent(slug)}`, {
        method: "GET",
        cache: "no-store",
      });
      const j = (await res.json().catch(() => ({}))) as { status?: string };
      if (metaReqIdRef.current !== my) return null;
      const st = String(j?.status ?? "").trim().toUpperCase();
      if (st === "NOT_PROVISIONED" || st === "not_provisioned") return null;
      if (st === "CONNECTED" || st === "PENDING" || st === "UNVERIFIED") return st as any;
      return null;
    } catch {
      return null;
    }
  }, [slug]);

  useEffect(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setMetaStatus(null);

    let cancelled = false;
    void (async () => {
      const st = await fetchMetaStatus();
      if (cancelled) return;
      setMetaChecked(true);
      if (!st) return;
      setMetaStatus(st);
      if (st === "PENDING" || st === "UNVERIFIED") {
        pollRef.current = window.setInterval(() => {
          void (async () => {
            const next = await fetchMetaStatus();
            if (!next) return;
            setMetaStatus(next);
            if (next === "CONNECTED" && pollRef.current) {
              window.clearInterval(pollRef.current);
              pollRef.current = null;
            }
          })();
        }, 300_000);
      }
    })();

    return () => {
      cancelled = true;
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [fetchMetaStatus]);

  const badge = useMemo(() => {
    if (metaStatus === "CONNECTED") {
      return (
        <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 text-[11px] font-medium">
          פעיל
        </span>
      );
    }
    if (metaStatus === "PENDING") {
      return (
        <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-1 text-[11px] font-medium">
          בתהליך אישור
        </span>
      );
    }
    if (metaStatus === "UNVERIFIED") {
      return (
        <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 px-2.5 py-1 text-[11px] font-medium">
          לא מאומת
        </span>
      );
    }
    return null;
  }, [metaStatus]);

  const metaText = useMemo(() => {
    if (metaStatus === "CONNECTED") {
      return "זואי מחוברת ועונה על המספר הזה. אפשר לשתף אותו עם הלקוחות שלך!";
    }
    if (metaStatus === "PENDING") {
      return "המספר בתהליך אישור מול WhatsApp. זה עשוי לקחת עד 24 שעות - אין צורך בפעולה מצידך.";
    }
    if (metaStatus === "UNVERIFIED") {
      return "המספר טרם אומת. אנא צור קשר עם התמיכה של HeyZoe לסיוע.";
    }
    return "";
  }, [metaStatus]);

  const copy = useCallback(async () => {
    const value = String(data?.phone_display ?? "").trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  }, [data?.phone_display]);

  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-[0_16px_44px_rgba(95,64,178,0.08)]">
      <div className="flex items-start justify-between gap-3">
        <div className="text-right">
          <div className="text-sm font-semibold text-zinc-900">מספר ה‑WhatsApp שלך</div>
          <div className="mt-0.5 text-xs text-zinc-500">המספר שעליו זואי עונה ללקוחות שלך</div>
        </div>
        {badge ? (
          badge
        ) : status === "active" ? (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 text-[11px] font-medium">
            פעיל
          </span>
        ) : status === "pending" ? (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200 px-2.5 py-1 text-[11px] font-medium">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            בהקמה
          </span>
        ) : status === "failed" ? (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 px-2.5 py-1 text-[11px] font-medium">
            תקלה
          </span>
        ) : (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-zinc-50 text-zinc-600 border border-zinc-200 px-2.5 py-1 text-[11px] font-medium">
            לא הוגדר
          </span>
        )}
      </div>

      {error ? (
        <div className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-right">
          לא ניתן לטעון את סטטוס המספר כרגע.
        </div>
      ) : null}

      {isLoading && !data ? (
        <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 text-right text-sm text-zinc-600 flex items-center justify-between gap-3">
          <span>טוען…</span>
          <Loader2 className="h-4 w-4 animate-spin text-[#7133da]" aria-hidden />
        </div>
      ) : null}

      {metaStatus === "CONNECTED" || status === "active" ? (
        <div className="mt-3 space-y-2 text-right">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2">
            <span className="text-sm font-semibold text-zinc-900" dir="ltr">
              {friendly || data?.phone_display || "—"}
            </span>
            <Button
              type="button"
              variant="outline"
              className="h-8 w-9 px-0"
              aria-label="העתקת מספר"
              onClick={() => {
                void (async () => {
                  await copy();
                  setCopied(true);
                  if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
                  copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1400);
                })();
              }}
            >
              <Copy className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          {copied ? <div className="text-xs text-emerald-700">המספר הועתק</div> : null}
          <p className="text-sm text-zinc-700">
            {metaText || "זואי עונה על המספר הזה. אפשר לשתף אותו עם הלקוחות שלך!"}
          </p>
        </div>
      ) : metaStatus === "PENDING" ? (
        <div className="mt-3 rounded-xl border border-amber-200/70 bg-amber-50/70 p-4 text-right">
          <p className="text-sm font-medium text-zinc-900">{metaText}</p>
        </div>
      ) : metaStatus === "UNVERIFIED" ? (
        <div className="mt-3 rounded-xl border border-rose-200/70 bg-rose-50/70 p-4 text-right">
          <p className="text-sm font-medium text-rose-800">{metaText}</p>
        </div>
      ) : status === "pending" ? (
        <div className="mt-3 rounded-xl border border-violet-200/70 bg-violet-50/60 p-4 text-right">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-900">המספר שלך נוצר… זה לוקח כמה דקות</p>
            <Loader2 className="h-4 w-4 animate-spin text-[#7133da]" aria-hidden />
          </div>
          <p className="mt-1 text-xs text-zinc-600">הדף יעדכן אוטומטית כל 10 שניות עד שהמספר יהפוך לפעיל.</p>
        </div>
      ) : status === "failed" ? (
        <div className="mt-3 rounded-xl border border-rose-200/70 bg-rose-50/70 p-4 text-right">
          <p className="text-sm font-medium text-rose-800">אירעה בעיה בהגדרת המספר</p>
          <p className="mt-1 text-xs text-rose-700">צוות זואי יצור איתך קשר בקרוב</p>
        </div>
      ) : !metaChecked && (isLoading || !data) ? (
        <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 text-right text-sm text-zinc-600 flex items-center justify-between gap-3">
          <span>טוען…</span>
          <Loader2 className="h-4 w-4 animate-spin text-[#7133da]" aria-hidden />
        </div>
      ) : null}
    </div>
  );
}

/** סלאג לשמירה — שמות בעברית בלבד נותנים toSlug ריק והשרת היה מדלג על השירות */
function serviceSlugForPersistence(serviceSlugField: string, name: string, uiId: string): string {
  const fromField = toSlug(serviceSlugField);
  if (fromField) return fromField;
  const fromName = toSlug(name);
  if (fromName) return fromName;
  return `trial-${uiId}`;
}

function normalizeInterestingText(value: string): string {
  return value
    .replace(/\s*[•·]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.\-–—\s]+/, "")
    .replace(/[,.\-–—\s]+$/, "");
}

function hasMeaningfulTextOverlap(a: string, b: string): boolean {
  const tokenize = (value: string) =>
    value
      .toLowerCase()
      .split(/[^a-zA-Z\u0590-\u05FF]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4);
  const left = new Set(tokenize(a));
  return tokenize(b).some((token) => left.has(token));
}

function parseServiceDescriptionMeta(rawDescription: string): Record<string, unknown> {
  const trimmed = rawDescription.trim();
  if (!trimmed) return {};
  const candidate = trimmed.startsWith("__META__:") ? trimmed.slice("__META__:".length).trim() : trimmed;
  if (!candidate.startsWith("{")) return {};
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function serviceReplyPhrase(serviceName: string): string {
  const trimmed = serviceName.trim();
  if (!trimmed) return "האימון";
  if (/^שיעור(?:י)?\s+/u.test(trimmed)) return trimmed;
  if (/עמיד(?:ת|ו) יד(?:יים|ים)/u.test(trimmed)) return `שיעורי ${trimmed}`;
  return trialServicePhraseForAfterPick(trimmed);
}

function pickServiceReplyOpener(serviceName: string): string {
  const options = ["איזה כיף", "אוקיי מדהים", "כיף גדול", "מהמם", "כיף לשמוע"];
  let hash = 0;
  for (let i = 0; i < serviceName.length; i++) hash = (hash * 31 + serviceName.charCodeAt(i)) | 0;
  return options[Math.abs(hash) % options.length] ?? options[0]!;
}

function deriveBenefitLineFromDescription(serviceName: string, description: string): string {
  const opener = pickServiceReplyOpener(serviceName);
  const addDefiniteArticle = (text: string): string => {
    const t = text.trim();
    if (!t) return t;
    const parts = t.split(/\s+/);
    const first = parts[0] ?? "";
    if (!first || first.startsWith("ה")) return t;
    return [`ה${first}`, ...parts.slice(1)].join(" ");
  };

  const nameRaw = String(serviceName ?? "").trim();
  const nameDef = addDefiniteArticle(nameRaw);
  const raw = String(description ?? "").replace(/\s+/g, " ").trim();
  if (!raw) {
    return `${opener}! אימוני ${nameDef || "הסטודיו"} שלנו הם דרך מעולה להתחזק ולהתקדם בקצב נכון ונעים.`;
  }

  const candidates = raw
    .split(/\n+/g)
    .flatMap((line) => line.split(/[.!?]\s+/g))
    .map((s) => s.trim())
    .filter(Boolean);
  const preferredIndex = candidates.findIndex((s) =>
    /(משלב|משלבים|כולל|כוללים|עבודת|סבולת|מוביליטי|כוח|גמיש|מתיחות|טווח|דיוק|שליטה|קהילה|מאמנ)/u.test(s)
  );
  const startIndex = preferredIndex >= 0 ? preferredIndex : 0;
  const pickedParts = candidates.slice(startIndex, startIndex + 2);
  const best = pickedParts.length ? pickedParts.join(". ") : candidates[0] ?? raw;

  let core = best.replace(/^[\"'“”״]+|[\"'“”״]+$/g, "").trim();
  const coreStartsWithShiur = /^(שיעור|שיעורי)\b/u.test(core);
  core = core.replace(/^האימון(?:\s+המרכזי)?\s+שלנו[, ]*/u, "");
  core = core.replace(/^האימון[, ]*/u, "");
  core = core.replace(/^משלב\b/u, "משלבים");
  core = core.replace(/^כולל\b/u, "כוללים");

  const looksLikeTechnicalSession = /אימון\s+טכני|סנאץ|סנץ|snatch|קלין|clean|ג(?:׳|')רק|jerk/u.test(core);
  const coreStartsWithAimon = /^אימון\b/u.test(core);

  if (looksLikeTechnicalSession || coreStartsWithAimon) {
    // Singular: "אימון X הוא אימון טכני..."
    const body = coreStartsWithAimon ? core.replace(/^אימון\s+/u, "") : core;
    const subject = nameRaw ? `אימון ${nameRaw} הוא` : "האימון הוא";
    const out = `${opener}! ${subject} אימון ${body}`.trim().replace(/\s+/g, " ");
    return /[.!?]$/.test(out) ? out : `${out}.`;
  }

  // If site copy already uses "שיעור/שיעורי" - keep it as a class ("שיעורי ...") not "אימונים".
  if (coreStartsWithShiur) {
    const subject = nameRaw.startsWith("שיעור") || nameRaw.startsWith("שיעורי") ? nameRaw : `שיעורי ${nameRaw || nameDef}`;
    let rest = core.replace(/^שיעורי?\s+[^.]*\.*\s*/u, "");
    rest = rest.replace(/^(השיעור|השעה)\s+(הזו|הזה)\s+ביום\s+בה\s+/u, "");
    rest = rest.replace(/^\.*\s*/u, "").trim();
    // If rest already contains "מתמקדים" - keep it. Otherwise, add "מתמקדים ב" naturally.
    const body = rest
      ? rest.startsWith("מתמקדים") || rest.startsWith("מתמקדים ב")
        ? rest
        : `מתמקדים ב${rest.startsWith("ב") ? "" : " "}${rest}`
      : "מתמקדים באימון שמרגיש טוב לגוף";
    const out = `${opener}! ${subject} ${body}`.trim().replace(/\s+/g, " ");
    return /[.!?]$/.test(out) ? out : `${out}.`;
  }

  // Default: "אימוני X שלנו מתמקדים ב..."
  let body = core;
  body = body.replace(/^מתמקדים\s+ב/u, "");
  body = body.replace(/^ב/u, "");
  const subject = nameDef ? `אימוני ${nameDef} שלנו` : "האימונים שלנו";
  const out = `${opener}! ${subject} מתמקדים ב${body ? " " + body : ""}`.trim().replace(/\s+/g, " ");
  return /[.!?]$/.test(out) ? out : `${out}.`;
}

function formatLevelsForSentence(levels: string[]): string {
  const clean = (levels ?? []).map((x) => String(x ?? "").trim()).filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return `לרמת ${clean[0]}`;
  if (clean.length === 2) return `לרמת ${clean[0]} ולרמת ${clean[1]}`;
  const last = clean[clean.length - 1]!;
  const head = clean.slice(0, -1).map((x) => `לרמת ${x}`).join(", ");
  return `${head} ולרמת ${last}`;
}

function resolveServiceReplyFocus(serviceName: string): string {
  const name = serviceName.trim().toLowerCase();
  if (/אקרו/.test(name)) {
    return "להתחזק, להתגמש, לכבוש אתגרים חדשים ולהכיר קהילה מדהימה";
  }
  if (/עמיד(?:ת|ו) יד(?:יים|ים)|handstand/.test(name)) {
    return "לבנות טכניקה נכונה, לחזק את הגוף ולהתקדם בהדרגה עד לעמידות ידיים יציבות ועצמאיות";
  }
  if (/יוגה/.test(name)) {
    return "לאזן בין הגוף לנפש, לשפר גמישות, לחזק את הגוף ולפנות זמן איכות לעצמכם";
  }
  if (/פילאטיס/.test(name)) {
    return "לחזק את מרכז הגוף, לשפר יציבה ולעבוד בדיוק, שליטה והארכה של הגוף";
  }
  if (/trx/.test(name)) {
    return "לחזק את כל הגוף, לשפר סיבולת ולעבוד ביציבות, שליטה וקצב נכון";
  }
  if (/כושר|פונקציונלי|strength|fit/.test(name)) {
    return "להתחזק, לשפר סיבולת לב ריאה ולהרגיש שהגוף עובד בצורה מדויקת וחכמה";
  }
  if (/ריקוד|dance/.test(name)) {
    return "להשתחרר, ליהנות, לשפר קואורדינציה ולהרגיש יותר בטוחים בתנועה";
  }
  return "להתחזק, לשפר יכולות פיזיות ולהתקדם בקצב נכון ונעים";
}

function extractServiceReplyHighlights(
  serviceName: string,
  rawDescription: string,
  flowFeatures: string,
  benefits: string[],
  suggestions: string[]
): string[] {
  const serviceTokens = serviceName
    .toLowerCase()
    .split(/[^a-zA-Z\u0590-\u05FF]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
  const interesting = /(טכנ|חיזוק|גמיש|איזו|באלאנס|בלנס|שליט|יציב|קואורד|תקשורת|סיבולת|נשימ|שחרור|פאן|ביטחו|מודעות|כוח|ליבה|כתפ|עמיד|ידיים|תנועה|זרימ|דיוק|ניידות|גוף|נפש)/u;
  const noise = /(לכל הרמות|בסטודיו|סטודיו מקצועי|מקצועי|מקצועית|ביטוח|שיעורים שבועיים|שיעור שבועי|קבוצות? קטנות?|קבוצה|בוקר|ערב|כתובת|הרשמה|תשלום|לינק)/u;
  const candidates = [rawDescription, flowFeatures, ...benefits, ...suggestions]
    .map(normalizeInterestingText)
    .filter(Boolean);
  const parts = candidates.flatMap((value) =>
    value
      .split(/[,.]| ו(?=חיזוק|שיפור|למידה|עבודה|פיתוח|גמישות|איזון|שליטה|תקשורת|יציבה|נשימה|סיבולת|כוח|טכניקה)/u)
      .map((part) => normalizeInterestingText(part))
      .filter(Boolean)
  );
  return parts.filter((part, index) => {
    const lower = part.toLowerCase();
    if (!interesting.test(part) || noise.test(part)) return false;
    if (serviceTokens.some((token) => lower === token || lower === `שיעורי ${token}`)) return false;
    return parts.findIndex((candidate) => candidate.toLowerCase() === lower) === index;
  });
}

function isLegacyGeneratedServiceReply(value: string, serviceName: string): boolean {
  const trimmed = value.trim();
  const phrase = serviceReplyPhrase(serviceName);
  return (
    /^(איזה כיף|אוקיי מדהים|כיף גדול|מהמם|כיף לשמוע)!/.test(trimmed) &&
    (trimmed.includes(`${phrase} מתמקדים ב`) ||
      trimmed.includes(`${phrase} שלנו מתמקדים ב`) ||
      trimmed.includes(`${phrase} אצלנו עובדים על בניית טכניקה נכונה`) ||
      trimmed.includes(`${phrase} שלנו הם דרך מעולה ל`))
  );
}

function buildServiceReplyDraft(
  serviceName: string,
  rawDescription: string,
  flowFeatures: string,
  benefits: string[],
  suggestions: string[],
  levelsEnabled: boolean,
  levels: string[],
  includeOpener = true
): string {
  // If we have a real description (from scan or manual), prefer a tight, relevant reply based on it.
  const rawDesc = String(rawDescription ?? "").trim();
  if (rawDesc && includeOpener) return deriveBenefitLineFromDescription(serviceName, rawDesc);

  const phrase = serviceReplyPhrase(serviceName);
  const opener = pickServiceReplyOpener(serviceName);
  const focus = resolveServiceReplyFocus(serviceName);
  const highlights = extractServiceReplyHighlights(serviceName, rawDescription, flowFeatures, benefits, suggestions);
  const highlight = highlights.find((item) => !hasMeaningfulTextOverlap(item, focus)) ?? "";
  const extra = highlight ? ` יש גם דגש על ${highlight}.` : "";
  // חלוקה לרמות שייכת ל"מענה אחרי בחירה בשאלת הניסיון" ולא לתשובה של בחירת סוג האימון.
  const body = `${phrase} שלנו הם דרך מעולה ${focus}.${extra}`.trim();
  return includeOpener ? `${opener}! ${body}` : body;
}

function trialServicesFromSiteProducts(products: unknown[], addrFallback: string): ServiceItem[] {
  if (!Array.isArray(products) || products.length === 0) return [];
  const includeOpener = true;
  return products.slice(0, 8).map((raw) => {
    const p = raw as Record<string, unknown>;
    const rowId = uid();
    const pname = truncateTrialServiceName(String(p.name ?? ""));
    const benefits = Array.isArray(p.benefits)
      ? p.benefits.map((x: unknown) => String(x ?? "").trim()).filter(Boolean)
      : [];
    const sugg = Array.isArray(p.benefit_suggestions)
      ? p.benefit_suggestions.map((x: unknown) => String(x ?? "").trim()).filter(Boolean)
      : [];
    const description = String(p.description ?? "").trim();
    const flowFeatures = typeof p.flow_features === "string" ? p.flow_features.trim() : "";
    const benefit_line = buildServiceReplyDraft(
      pname,
      description,
      flowFeatures,
      benefits,
      sugg,
      false,
      [],
      includeOpener
    );
    return {
      ui_id: rowId,
      name: pname,
      price_text: String(p.price_text ?? "").trim(),
      duration: "",
      payment_link: "",
      service_slug: serviceSlugForPersistence("", pname, rowId),
      location_text: String(p.location_text ?? "").trim() || addrFallback,
      description,
      levels_enabled: false,
      levels: [],
      benefit_line,
      trial_pick_media_url: "",
      trial_pick_media_type: "",
    };
  });
}

/** תצוגה בשדה — ללא {serviceName} */
function experienceQuestionForDisplay(stored: string, serviceName: string): string {
  // בדשבורד לא מציגים שם אימון ספציפי כדי שלא "יתקבע" על האימון הראשון.
  // בצ׳אט נשמרת התבנית עם {serviceName} כדי שזואי תמלא את השם הנכון לפי הבחירה.
  const token = "(שם האימון)";
  return stored.replace(/\{serviceName\}/g, token || (serviceName.trim() ? serviceName : "האימון"));
}

/** שמירה מהשדה — מחזירה תבנית עם {serviceName} כשמתאים */
function experienceQuestionToStore(typed: string, serviceName: string): string {
  if (typed.includes("(שם האימון)")) return typed.split("(שם האימון)").join("{serviceName}");
  if (!serviceName.trim()) return typed;
  if (!typed.includes(serviceName)) return typed;
  return typed.split(serviceName).join("{serviceName}");
}

function afterExperienceForDisplay(stored: string, service: ServiceItem | null): string {
  return fillAfterExperienceTemplate(stored, service?.levels_enabled ?? false, service?.levels ?? []);
}

function afterExperienceToStore(typed: string, service: ServiceItem | null): string {
  if (!service) return typed;
  const resolved = formatServiceLevelsText(service.levels_enabled, service.levels);
  return resolved && typed.includes(resolved) ? typed.split(resolved).join("{levelsText}") : typed;
}

function ctaBodyForDisplay(stored: string, priceText: string, durationText: string): string {
  // ב־UI מציגים משתנה קבוע (x) כי המחיר/משך תלויים בבחירת סוג האימון
  return fillCtaBodyTemplate(stored, "x", "x");
}

function ctaBodyToStore(typed: string, priceText: string, durationText: string): string {
  let s = typed;
  // אם המשתמש השאיר x כפי שמוצג ב־UI, נשמור חזרה את התבנית.
  s = s.replace(/\bx\s+שקלים\b/gu, "{priceText} שקלים");
  s = s.replace(/\bx\s+דקות\b/gu, "{durationText} דקות");
  const p = priceText.trim();
  const d = durationText.trim();
  if (p && s.includes(p)) s = s.split(p).join("{priceText}");
  if (d && s.includes(d)) s = s.split(d).join("{durationText}");
  return s;
}

function SalesFlowExtraStepsEditor({
  steps,
  onChange,
  addButtonLabel,
  startAt = 1,
  questionHeaderClassName = "",
}: {
  steps: SalesFlowExtraStep[];
  onChange: (next: SalesFlowExtraStep[]) => void;
  addButtonLabel: string;
  /** for warmup extras: start at 2 (since question 1 already exists above) */
  startAt?: number;
  /** match typography of surrounding question headers */
  questionHeaderClassName?: string;
}) {
  return (
    <div className="space-y-3 pt-3 border-t border-dashed border-zinc-200/90">
      {steps.map((st, si) => (
        <div
          key={st.id}
          className="border border-dashed border-zinc-200 rounded-xl p-3 space-y-2 bg-zinc-50/60"
        >
          <div className="flex justify-between items-center gap-2">
            <span
              className={`text-[0.95rem] font-semibold tracking-[-0.01em] text-zinc-800 ${questionHeaderClassName}`.trim()}
            >
              שאלה {si + startAt}
            </span>
            <button
              type="button"
              className="p-1 text-zinc-400 hover:text-red-500"
              onClick={() => onChange(steps.filter((x) => x.id !== st.id))}
              aria-label="הסר שאלה"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <Input
            dir="rtl"
            value={st.question}
            onChange={(e) => {
              const v = e.target.value;
              onChange(steps.map((x) => (x.id === st.id ? { ...x, question: v } : x)));
            }}
            placeholder="כתבו את השאלה כאן…"
          />
          <p className="text-[11px] text-zinc-500 text-right">כפתורי תשובה</p>
          {st.options.map((o, oi) => (
            <div key={oi} className="flex gap-2">
              <Input
                dir="rtl"
                className="flex-1"
                value={o}
                onChange={(e) => {
                  const v = e.target.value;
                  onChange(
                    steps.map((x) =>
                      x.id === st.id
                        ? { ...x, options: x.options.map((t, j) => (j === oi ? v : t)) }
                        : x
                    )
                  );
                }}
              />
              <button
                type="button"
                className="p-1 text-zinc-400 hover:text-red-500 shrink-0"
                onClick={() =>
                  onChange(
                    steps.map((x) =>
                      x.id === st.id ? { ...x, options: x.options.filter((_, j) => j !== oi) } : x
                    )
                  )
                }
                aria-label="הסר כפתור"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            className="w-full text-xs h-8"
            onClick={() =>
              onChange(
                steps.map((x) => (x.id === st.id ? { ...x, options: [...x.options, ""] } : x))
              )
            }
          >
            <Plus className="h-3 w-3" /> הוסף כפתור תשובה
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        className="w-full gap-1 text-sm"
        onClick={() => onChange([...steps, { id: uid(), question: "", options: ["", ""] }])}
      >
        <Plus className="h-4 w-4" />
        {addButtonLabel}
      </Button>
    </div>
  );
}

/** שם תצוגה מ־slug כשאין שם שמור בדאטהבייס */
function displayNameFromSlug(s: string) {
  const parts = s.trim().split("-").filter(Boolean);
  if (parts.length === 0) return "";
  return parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function traitPlaceholder(index: number): string {
  if (index === 0) return "מתאים לשיקום פציעות";
  if (index === 1) return "מתאים לכל הרמות";
  if (index === 2) return "הסטודיו הגדול בעיר";
  return "מאפיין נוסף";
}

function normalizeTraitsState(arr: string[]): string[] {
  const t = arr.map((s) => String(s ?? ""));
  if (t.length === 0) return ["", "", ""];
  if (t.length < 3) return [...t, ...Array(3 - t.length).fill("")];
  return t;
}

function buildFactQuestions(input: {
  traits: string[];
  directionsText: string;
  promotionsText: string;
  servicesText: string;
  addressText: string;
}): { id: string; question: string; placeholder: string; kind: string }[] {
  const text = `${input.traits.join("\n")}\n${input.directionsText}\n${input.promotionsText}\n${input.servicesText}\n${input.addressText}`.toLowerCase();
  const out: { id: string; question: string; placeholder: string; kind: string; test: () => boolean }[] = [
    {
      id: "audience_age",
      kind: "audience_age",
      question: "לאילו גילאים זה מתאים?",
      placeholder: "למשל: מגיל 18 ומעלה / 16+ / ילדים 8–12",
      test: () => !/(גיל|ילדים|נוער|מבוגרים|\d{1,2}\s*\+|\d{1,2}\s*-\s*\d{1,2})/u.test(text),
    },
    {
      id: "audience_level",
      kind: "audience_level",
      question: "זה מתאים למתחילים?",
      placeholder: "למשל: כן, יש קבוצת מתחילים / צריך ניסיון קודם",
      test: () => !/(מתחילים|מתקדמים|רמות|לכל הרמות|beginner|advanced)/u.test(text),
    },
    {
      id: "fitness_level",
      kind: "fitness_level",
      question: "זה מתאים לכל רמת כושר?",
      placeholder: "למשל: כן, מתחילים בקצב אישי / נדרש בסיס מסוים",
      test: () => !/(רמת כושר|כושר|כושר גופני|לכל רמת כושר|מתאים לכל כושר)/u.test(text),
    },
    {
      id: "parking",
      kind: "parking",
      question: "יש חניה או הנחיות הגעה מיוחדות?",
      placeholder: "למשל: חניה בכחול לבן / חניון קרוב / קומה 2",
      test: () => !input.directionsText.trim() && !/(חניה|חנייה|חניון|parking|park|איך מגיעים|הנחיות הגעה)/u.test(text),
    },
    {
      id: "parking_nearby",
      kind: "parking_nearby",
      question: "יש חניה קרובה?",
      placeholder: "למשל: יש חניון במרחק 2 דקות / כחול-לבן מסביב",
      test: () => !/(חניה|חנייה|חניון|parking|park)/u.test(text),
    },
    {
      id: "showers",
      kind: "showers",
      question: "יש מקלחות וחדרי הלבשה?",
      placeholder: "למשל: כן, יש מקלחות ולוקרים",
      test: () => !/(מקלחות|מקלחת|חדרי הלבשה|לוקר|locker|החלפה)/u.test(text),
    },
    {
      id: "class_size",
      kind: "class_size",
      question: "כמה אנשים יש באימון?",
      placeholder: "למשל: עד 12 משתתפים באימון",
      test: () => !/(כמה אנשים|מספר משתתפים|עד \d+|קבוצה של|בקבוצה|משתתפים|אינטימי|קבוצות קטנות)/u.test(text),
    },
    {
      id: "pregnancy",
      kind: "pregnancy",
      question: "האם זה מתאים לנשים בהיריון?",
      placeholder: "למשל: כן, בתיאום מראש / מומלץ להתייעץ עם רופא",
      test: () => !/(היריון|הריון|בהיריון|בהריון|pregnan)/u.test(text),
    },
    {
      id: "what_to_bring",
      kind: "what_to_bring",
      question: "מה כדאי להביא / ללבוש לשיעור?",
      placeholder: "למשל: בגדי ספורט נוחים + בקבוק מים",
      test: () => !/(מה ללבוש|להביא|בגד|בגדים|נעליים|גרביים|מגבת|מים)/u.test(text),
    },
    {
      id: "equipment",
      kind: "equipment",
      question: "צריך להביא ציוד או שהכל מחכה בסטודיו?",
      placeholder: "למשל: לא צריך להביא כלום / רק מגבת אישית",
      test: () => !/(ציוד|מזרן|מזרונים|הכל מחכה|לא צריך להביא|אביזרים)/u.test(text),
    },
    {
      id: "language",
      kind: "language",
      question: "באיזו שפה האימון מתנהל?",
      placeholder: "למשל: עברית / אנגלית / גם וגם",
      test: () => !/(עברית|אנגלית|שפה|english)/u.test(text),
    },
    {
      id: "cancellation",
      kind: "cancellation",
      question: "מה מדיניות הביטול או ההקפאה?",
      placeholder: "למשל: עד 12 שעות לפני ללא חיוב",
      test: () => !/(מדיניות ביטול|ביטול|הקפאה|דמי ביטול|החזר)/u.test(text),
    },
  ];
  return out.filter((x) => x.test()).map(({ test: _t, ...rest }) => rest);
}

function factFromQuestionAnswer(question: string, answer: string): string {
  const q = String(question ?? "").trim().replace(/\?+$/, "?");
  const a = String(answer ?? "").trim();
  if (!a) return q;
  const normalizedQ = q.replace(/\?+$/, "").trim();
  // Simple “label: answer” conversion for "יש X" questions.
  const m = normalizedQ.match(/^יש\s+(.+)$/u);
  if (m?.[1]) return `${m[1].trim()}: ${a}`;
  return `${q} ${a}`;
}

const Step3Trial = dynamic(() => import("./steps/Step3Trial"), {
  ssr: false,
  loading: () => (
    <Card>
      <CardHeader>
        <CardTitle>
          <StepHeader n={3} title="אימון ניסיון" desc="טוען…" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-zinc-200 bg-white/70 p-6 text-center text-sm text-zinc-500">
          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-3 text-[#7133da]" aria-hidden />
          טוען את הטאב…
        </div>
      </CardContent>
    </Card>
  ),
});

const Step4SalesFlow = dynamic(() => import("./steps/Step4SalesFlow"), {
  ssr: false,
  loading: () => (
    <Card>
      <CardHeader>
        <CardTitle>
          <StepHeader n={4} title="מסלול מכירה" desc="טוען…" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-zinc-200 bg-white/70 p-6 text-center text-sm text-zinc-500">
          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-3 text-[#7133da]" aria-hidden />
          טוען את הטאב…
        </div>
      </CardContent>
    </Card>
  ),
});

function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SlugSettingsPage() {
  const { slug } = useParams() as { slug: string };
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [step, setStep]     = useState(1);
  const [plan, setPlan] = useState<"basic" | "premium">("basic");
  const [loading, setLoading] = useState(true);
  /** נכון רק אחרי GET מוצלח לעסק שתואם ל־slug — מונע אוטו־שמירה שדורסת נתונים */
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [settingsLoadError, setSettingsLoadError] = useState("");
  const [saving, setSaving]   = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [fetchingUrl, setFetchingUrl]         = useState(false);
  const [fetchSiteError, setFetchSiteError]   = useState("");
  const [fetchSiteNotice, setFetchSiteNotice] = useState("");
  // Sales-flow regeneration is now per-section only (no global reset).
  const [businessNameEditing, setBusinessNameEditing] = useState(false);
  const [canAutosave, setCanAutosave] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [autoSaveErr, setAutoSaveErr] = useState("");

  // ── Step 1: Business details (includes optional website import)
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");

  // ── Business details
  const [name, setName]         = useState("");
  const [botName, setBotName]   = useState("זואי");
  const [niche, setNiche]       = useState("");
  const [address, setAddress]   = useState("");
  const [customerServicePhone, setCustomerServicePhone] = useState("");
  const [directions, setDirections] = useState("");
  const [directionsMediaUrl, setDirectionsMediaUrl] = useState("");
  const [directionsMediaType, setDirectionsMediaType] = useState<"image" | "video" | "">("");
  const [businessTagline, setBusinessTagline] = useState("");
  const [traits, setTraits] = useState<string[]>(["", "", ""]);
  const [promotions, setPromotions] = useState("");
  const [vibe, setVibe]         = useState<string[]>([]);
  const [arboxLink, setArboxLink] = useState("");
  const [membershipsUrl, setMembershipsUrl] = useState("");
  const [facebookPixelId, setFacebookPixelId] = useState("");
  const [conversionsApiToken, setConversionsApiToken] = useState("");

  // ── Step 2: Opening media
  const [openingMediaUrl, setOpeningMediaUrl]   = useState("");
  const [openingMediaType, setOpeningMediaType] = useState<"image" | "video" | "">("");
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaUploadError, setMediaUploadError] = useState("");
  const directionsMediaInputRef = useRef<HTMLInputElement>(null);
  const [uploadingDirectionsMedia, setUploadingDirectionsMedia] = useState(false);
  const [directionsMediaUploadError, setDirectionsMediaUploadError] = useState("");
  const [showDirectionsMediaModal, setShowDirectionsMediaModal] = useState(false);
  const [showStarterMediaProModal, setShowStarterMediaProModal] = useState(false);
  const [uploadingTrialPickUiId, setUploadingTrialPickUiId] = useState<string | null>(null);
  const [trialPickMediaUploadError, setTrialPickMediaUploadError] = useState("");
  /** אחרי כשל העלאה — לא מציגים תצוגה מקדימה למדיה שמורה עבור אותו אימון */
  const [trialPickFailedUiId, setTrialPickFailedUiId] = useState<string | null>(null);

  // ── מסלול מכירה: פתיחה + כפתורים
  const [welcomeIntro, setWelcomeIntro] = useState("");
  const [welcomeQuestion, setWelcomeQuestion] = useState("");
  const [welcomeOptions, setWelcomeOptions] = useState<string[]>(["", "", ""]);
  const [salesFlowConfig, setSalesFlowConfig] = useState<SalesFlowConfig>(() =>
    defaultSalesFlowConfig([])
  );

  // ── נשמר ב־DB ללא עריכה במסך (טאב הוסר)
  const [segQuestions, setSegQuestions] = useState<SegQuestion[]>([]);

  // ── Quick replies
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);

  // ── Objections (will live inside "Questions & menu")
  const [objections, setObjections] = useState<Objection[]>([]);
  // ── מעקב אחרי שתיקה בווטסאפ (קרון חיצוני → /api/cron/wa-followups)
  const [waSalesFollowup1, setWaSalesFollowup1] = useState("");
  const [waSalesFollowup2, setWaSalesFollowup2] = useState("");
  const [waSalesFollowup3, setWaSalesFollowup3] = useState("");


  // ── Step 2: Trial classes (אימון ניסיון) + drag & drop
  const [services, setServices]   = useState<ServiceItem[]>([]);
  const [servicesHydrated, setServicesHydrated] = useState(false);
  const dragIdx = useRef<number | null>(null);
  /** true = יש פתיחה שמורה בשרת או שכבר מילאנו טמפלייט — לא לדרוס אוטומטית */
  const welcomeOpeningLockedRef = useRef(false);
  const servicesSignatureRef = useRef("");

  const servicesSignature = useMemo(
    () => services.map((s) => s.name.trim()).filter(Boolean).join("\0"),
    [services]
  );

  const salesOpeningAutoText = useMemo(
    () =>
      composeGreeting(
        salesFlowConfig,
        botName.trim() || "זואי",
        name.trim() || displayNameFromSlug(slug),
        businessTagline.trim(),
        address.trim()
      ),
    [salesFlowConfig, botName, name, slug, businessTagline, address]
  );

  const trialServiceNames = useMemo(
    () => services.map((s) => s.name.trim()).filter(Boolean),
    [services]
  );
  const firstNamedService = useMemo(
    () => services.find((s) => s.name.trim()) ?? null,
    [services]
  );

  /** דוגמה לתבניות שמכילות פרטי אימון — לפי האימון הראשון ברשימה */
  const firstTrialForTemplates = useMemo(() => {
    if (!firstNamedService) return { name: "", priceText: "", durationText: "" };
    return {
      name: firstNamedService.name.trim(),
      priceText: firstNamedService.price_text.trim(),
      durationText: firstNamedService.duration.trim(),
    };
  }, [firstNamedService]);

  const factQuestions = useMemo(() => {
    const servicesText = services
      .map((s) => [s.name, s.description, s.price_text, s.duration].filter(Boolean).join(" "))
      .filter(Boolean)
      .join("\n");
    return buildFactQuestions({
      traits,
      directionsText: directions,
      promotionsText: promotions,
      servicesText,
      addressText: address,
    });
  }, [traits, directions, promotions, services, address]);
  const [factAnswers, setFactAnswers] = useState<Record<string, string>>({});
  const [factQuestionIdx, setFactQuestionIdx] = useState(0);
  useEffect(() => {
    setFactQuestionIdx((i) => {
      if (factQuestions.length === 0) return 0;
      return Math.max(0, Math.min(i, factQuestions.length - 1));
    });
  }, [factQuestions.length]);
  const addFactLine = useCallback((value: string) => {
    const v = String(value ?? "").trim();
    if (!v) return;
    setTraits((prev) => {
      const next = [...prev];
      const emptyIndex = next.findIndex((x) => !String(x ?? "").trim());
      if (emptyIndex >= 0) {
        next[emptyIndex] = v;
        return next;
      }
      next.push(v);
      return next;
    });
  }, []);

  const prevStepForServicesRef = useRef(step);
  useEffect(() => {
    const prev = prevStepForServicesRef.current;
    prevStepForServicesRef.current = step;
    if (step === 3 && prev === 3 && servicesSignatureRef.current !== servicesSignature) {
      welcomeOpeningLockedRef.current = false;
    }
    servicesSignatureRef.current = servicesSignature;
  }, [step, servicesSignature]);

  useEffect(() => {
    if (!settingsHydrated) return;
    const wf = syncWelcomeFromSalesFlow(
      salesFlowConfig,
      services.filter((s) => s.name.trim()).map((s) => ({
        name: s.name,
        benefit_line: s.benefit_line,
        service_slug: s.service_slug,
      })),
      botName.trim() || "זואי",
      name.trim() || displayNameFromSlug(slug),
      businessTagline.trim(),
      address.trim()
    );
    setWelcomeIntro(wf.intro);
    setWelcomeQuestion(wf.question);
    setWelcomeOptions(wf.options.length ? [...wf.options] : ["", "", ""]);
  }, [
    settingsHydrated,
    salesFlowConfig,
    services,
    botName,
    name,
    slug,
    businessTagline,
    address,
  ]);

  // ─── Step persistence in URL (?step=) ─────────────────────────────────────
  // Without this, refresh resets step to 1.
  const stepSyncFromUrlRef = useRef(false);
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  useEffect(() => {
    const sp = searchParams.get("step") ?? "";
    const parsed = Number(sp);
    if (!Number.isFinite(parsed)) return;
    const n = Math.max(1, Math.min(STEPS.length, Math.trunc(parsed)));
    if (n !== stepRef.current) {
      stepSyncFromUrlRef.current = true;
      setStep(n);
    }
  }, [searchParams]);

  useEffect(() => {
    if (stepSyncFromUrlRef.current) {
      stepSyncFromUrlRef.current = false;
      return;
    }
    const current = searchParams.get("step") ?? "";
    if (current === String(step)) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("step", String(step));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [step, router, pathname, searchParams]);

  // ─── Load data ─────────────────────────────────────────────────────────────

  const settingsKey = dashboardSettingsKey(slug);
  const {
    data: swrSettings,
    error: swrSettingsError,
    isLoading: swrSettingsLoading,
  } = useSWR(settingsKey, dashboardSettingsFetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 5000,
    keepPreviousData: true,
    shouldRetryOnError: false,
  });

  useEffect(() => {
    setLoading(Boolean(swrSettingsLoading));
    setSettingsHydrated(false);
    setServicesHydrated(false);
    setSettingsLoadError("");
    if (swrSettingsError) {
      setSettingsLoadError("לא ניתן לטעון את נתוני מסלול המכירה.");
      setLoading(false);
      return;
    }
    if (!swrSettings) return;
    const business = swrSettings.business;
    const svcs = swrSettings.services;
        if (!business) {
          setSettingsLoadError("לא נמצא עסק עבור כתובת זו. בדקו את הכתובת או התחברו מחדש.");
          setLoading(false);
          return;
        }
        if (String(business.slug ?? "").toLowerCase() !== slug.toLowerCase()) {
          setSettingsLoadError("אי-התאמה בין העסק לכתובת. רעננו את הדף.");
          setLoading(false);
          return;
        }
        const sl = (business.social_links && typeof business.social_links === "object"
          ? business.social_links : {}) as Record<string, unknown>;

        setWebsiteUrl(String(sl.website_url ?? business.website_url ?? ""));
        setInstagramUrl(
          String(
            (business as { instagram?: string }).instagram ??
              (typeof sl.instagram === "string" ? sl.instagram : "")
          )
        );
        setPlan((business.plan === "premium" ? "premium" : "basic") as "basic" | "premium");
        {
          const loaded = String(business.name ?? "").trim();
          setName(loaded || displayNameFromSlug(slug));
        }
        setBotName(String(business.bot_name ?? "זואי"));
        setNiche(String(business.niche ?? ""));
        setAddress(String(sl.address ?? ""));
        setCustomerServicePhone(
          typeof sl.customer_service_phone === "string" ? sl.customer_service_phone.trim() : ""
        );
        setDirections(String(sl.directions ?? ""));
        setDirectionsMediaUrl(String(sl.directions_media_url ?? ""));
        setDirectionsMediaType((sl.directions_media_type as "image" | "video" | "") ?? "");
        const taglineLoaded =
          (typeof sl.tagline === "string" && sl.tagline.trim())
            ? sl.tagline
            : (typeof sl.business_description === "string" && sl.business_description.trim())
              ? String(sl.business_description).split("\n")[0] ?? ""
              : "";
        setBusinessTagline(taglineLoaded);
        setPromotions(typeof sl.promotions === "string" ? sl.promotions : "");
        const f1 = typeof sl.fact1 === "string" ? sl.fact1 : "";
        const f2 = typeof sl.fact2 === "string" ? sl.fact2 : "";
        const f3 = typeof sl.fact3 === "string" ? sl.fact3 : "";
        const legacy = taglineLoaded.trim()
          ? ""
          : String(sl.business_description ?? business.business_description ?? "");
        const fromArr = Array.isArray(sl.traits) ? sl.traits.map((x) => String(x ?? "")) : null;
        const hasLegacyFacts = f1.trim() || f2.trim() || f3.trim();
        if (fromArr) {
          setTraits(normalizeTraitsState(fromArr));
        } else if (hasLegacyFacts) {
          setTraits(normalizeTraitsState([f1, f2, f3]));
        } else if (legacy.trim()) {
          const lines = legacy.split(/\n+/).map((s) => s.trim()).filter(Boolean);
          setTraits(normalizeTraitsState(lines.length ? lines : ["", "", ""]));
        } else {
          setTraits(["", "", ""]);
        }
        setVibe(Array.isArray(sl.vibe) ? (sl.vibe as string[]) : []);
        setMembershipsUrl(typeof sl.memberships_url === "string" ? sl.memberships_url.trim() : "");
        setOpeningMediaUrl(String(sl.opening_media_url ?? ""));
        setOpeningMediaType((sl.opening_media_type as "image" | "video" | "") ?? "");
        const fullWelcome = String(business.welcome_message ?? "");
        const hasStructuredWelcome =
          (typeof sl.welcome_intro === "string" && sl.welcome_intro.trim()) ||
          (typeof sl.welcome_question === "string" && sl.welcome_question.trim()) ||
          (Array.isArray(sl.welcome_options) && sl.welcome_options.some((x) => String(x ?? "").trim()));
        const hasSalesFlowSaved =
          Boolean(sl.sales_flow) &&
          typeof sl.sales_flow === "object" &&
          !Array.isArray(sl.sales_flow) &&
          Object.keys(sl.sales_flow as object).length > 0;

        let loadedWelcomeIntro = "";
        if (hasStructuredWelcome) {
          loadedWelcomeIntro = typeof sl.welcome_intro === "string" ? sl.welcome_intro : "";
          setWelcomeIntro(loadedWelcomeIntro);
          setWelcomeQuestion(typeof sl.welcome_question === "string" ? sl.welcome_question : "");
          const wo = Array.isArray(sl.welcome_options) ? sl.welcome_options.map((x) => String(x ?? "")) : [];
          const pad = [...wo, "", "", ""].slice(0, 3);
          setWelcomeOptions(pad);
        } else {
          const { body, chips } = splitWelcomeForChat(fullWelcome, null);
          const lines = body.split("\n");
          const last = lines[lines.length - 1]?.trim() ?? "";
          const looksQ = last && (/\?/.test(last) || last.startsWith("האם") || last.startsWith("מה "));
          if (looksQ) {
            loadedWelcomeIntro = lines.slice(0, -1).join("\n").trim();
            setWelcomeIntro(loadedWelcomeIntro);
            setWelcomeQuestion(last);
          } else {
            loadedWelcomeIntro = body.trim();
            setWelcomeIntro(loadedWelcomeIntro);
            setWelcomeQuestion("");
          }
          const pad = [...chips, "", "", ""].slice(0, 3);
          setWelcomeOptions(pad);
        }
        welcomeOpeningLockedRef.current =
          Boolean(hasStructuredWelcome) ||
          fullWelcome.trim().length > 0 ||
          hasSalesFlowSaved;

        if (hasSalesFlowSaved) {
          const parsed = parseSalesFlowFromSocial(sl.sales_flow);
          if (parsed) setSalesFlowConfig({ ...parsed, greeting_extra_steps: [] });
        } else {
          const def = defaultSalesFlowConfig(Array.isArray(sl.vibe) ? (sl.vibe as string[]) : []);
          if (loadedWelcomeIntro.trim()) def.greeting_body_override = loadedWelcomeIntro.trim();
          def.greeting_extra_steps = [];
          setSalesFlowConfig(def);
        }
        setSegQuestions(Array.isArray(sl.segmentation_questions) ? (sl.segmentation_questions as SegQuestion[]) : []);
        const loadedQr =
          Array.isArray(sl.quick_replies)
            ? (sl.quick_replies as QuickReply[]).map((r) =>
                typeof r === "string"
                  ? { id: uid(), label: r, reply: "" } // migrate old string format
                  : { id: (r as any).id ?? uid(), label: String((r as any).label ?? ""), reply: String((r as any).reply ?? "") }
              )
            : [];
        // Load quick replies as-is (including "מה הכתובת שלכם?" if exists)
        setQuickReplies(loadedQr);
        setArboxLink(String(sl.arbox_link ?? ""));
        setFacebookPixelId(String(business.facebook_pixel_id ?? ""));
        setConversionsApiToken(String(business.conversions_api_token ?? ""));
        setObjections(Array.isArray(sl.objections) ? (sl.objections as Objection[]) : []);

        setWaSalesFollowup1(
          typeof sl.wa_sales_followup_1 === "string" && sl.wa_sales_followup_1.trim()
            ? sl.wa_sales_followup_1.trim()
            : WA_SALES_FOLLOWUP_1_DEFAULT
        );
        setWaSalesFollowup2(
          typeof sl.wa_sales_followup_2 === "string" && sl.wa_sales_followup_2.trim()
            ? sl.wa_sales_followup_2.trim()
            : WA_SALES_FOLLOWUP_2_DEFAULT
        );
        setWaSalesFollowup3(
          typeof sl.wa_sales_followup_3 === "string" && sl.wa_sales_followup_3.trim()
            ? sl.wa_sales_followup_3.trim()
            : WA_SALES_FOLLOWUP_3_DEFAULT
        );

        if (Array.isArray(svcs)) {
          setServices((svcs as Record<string, unknown>[]).map((s, index, arr) => {
            const name = String(s.name ?? "");
            const rawDescription = String(s.description ?? "");
            const meta = parseServiceDescriptionMeta(rawDescription);
            const storedBenefit = String(meta.benefit_line ?? "").trim();
            const storedDescriptionText = String(meta.description_text ?? meta.description ?? "").trim();
            const legacyBenefits = Array.isArray(meta.benefits)
              ? meta.benefits.map((x) => String(x ?? "").trim()).filter(Boolean)
              : [];
            const legacySuggestions = Array.isArray(meta.benefit_suggestions)
              ? meta.benefit_suggestions.map((x) => String(x ?? "").trim()).filter(Boolean)
              : [];
            const regeneratedBenefit = buildServiceReplyDraft(
              name,
              storedDescriptionText || rawDescription,
              "",
              legacyBenefits,
              legacySuggestions,
              meta.levels_enabled === true,
              Array.isArray(meta.levels) ? meta.levels.map((x) => String(x ?? "").trim()).filter(Boolean) : [],
              arr.filter((item) => String((item as Record<string, unknown>).name ?? "").trim()).length > 1
            );
            return {
              ui_id: uid(),
              name,
              price_text: String(s.price_text ?? ""),
              duration: String(meta.duration ?? ""),
              payment_link: String(meta.payment_link ?? ""),
              service_slug: String(s.service_slug ?? ""),
              location_text: String(s.location_text ?? ""),
              description: storedDescriptionText || rawDescription,
              levels_enabled: meta.levels_enabled === true,
              levels: Array.isArray(meta.levels)
                ? meta.levels.map((x) => String(x ?? "").trim()).filter(Boolean)
                : [],
              benefit_line:
                storedBenefit && !isLegacyGeneratedServiceReply(storedBenefit, name)
                  ? storedBenefit
                  : regeneratedBenefit,
              trial_pick_media_url: String(meta.trial_pick_media_url ?? "").trim(),
              trial_pick_media_type:
                meta.trial_pick_media_type === "video"
                  ? "video"
                  : meta.trial_pick_media_type === "image"
                    ? "image"
                    : "",
            };
          }));
          setServicesHydrated(true);
        }
        setSettingsHydrated(true);
    setLoading(false);
  }, [slug, swrSettings, swrSettingsError, swrSettingsLoading]);

  useEffect(() => {
    if (loading || !settingsHydrated) {
      setCanAutosave(false);
      return;
    }
    const t = window.setTimeout(() => setCanAutosave(true), AUTOSAVE_ENABLE_DELAY_MS);
    return () => clearTimeout(t);
  }, [loading, settingsHydrated]);

  // ─── Save payload (ידני + אוטומטי) ─────────────────────────────────────────

  const getSavePayload = useCallback(() => {
    const wf = syncWelcomeFromSalesFlow(
      salesFlowConfig,
      services.filter((s) => s.name.trim()).map((s) => ({
        name: s.name,
        benefit_line: s.benefit_line,
        service_slug: s.service_slug,
      })),
      botName.trim() || "זואי",
      name.trim() || displayNameFromSlug(slug),
      businessTagline.trim(),
      address.trim()
    );
    const base = {
      business: {
        slug,
        name,
        niche,
        bot_name: botName,
        welcome_message: buildWelcomeMessageForStorage(wf.intro, wf.question, wf.options),
        facebook_pixel_id: facebookPixelId,
        conversions_api_token: conversionsApiToken,
        social_links: {
          website_url: websiteUrl,
          instagram: instagramUrl.trim(),
          tagline: businessTagline.trim(),
          traits: traits.map((s) => s.trim()).filter(Boolean),
          fact1: (traits[0] ?? "").trim(),
          fact2: (traits[1] ?? "").trim(),
          fact3: (traits[2] ?? "").trim(),
          business_description: traits.map((s) => s.trim()).filter(Boolean).join("\n"),
          promotions: promotions.trim(),
          address,
          customer_service_phone: customerServicePhone.trim(),
          directions,
          directions_media_url: directionsMediaUrl,
          directions_media_type: directionsMediaType,
          vibe,
          opening_media_url: openingMediaUrl,
          opening_media_type: openingMediaType,
          welcome_intro: wf.intro.trim(),
          welcome_question: wf.question.trim(),
          welcome_options: wf.options.map((o) => o.trim()),
          sales_flow: serializeSalesFlowConfig(salesFlowConfig),
          sales_flow_blocks: [],
          segmentation_questions: segQuestions,
          quick_replies: quickReplies,
          arbox_link: arboxLink,
          objections,
          wa_sales_followup_1: waSalesFollowup1.trim(),
          wa_sales_followup_2: waSalesFollowup2.trim(),
          wa_sales_followup_3: waSalesFollowup3.trim(),
          followup_after_registration: "",
          followup_after_hour_no_registration: "",
          followup_day_after_trial: "",
          membership_tiers: [],
          punch_cards: [],
          memberships_url: membershipsUrl.trim(),
        },
      },
      faqs: [] as unknown[],
    };
    return servicesHydrated
      ? {
          ...base,
          services: services.filter((s) => s.name.trim()).map((s) => ({
            name: truncateTrialServiceName(s.name.trim()),
            service_slug: serviceSlugForPersistence(
              s.service_slug,
              truncateTrialServiceName(s.name.trim()),
              s.ui_id
            ),
            price_text: s.price_text,
            location_text: s.location_text,
            location_mode: "location",
            description: JSON.stringify({
              duration: s.duration,
              payment_link: s.payment_link,
              benefit_line: s.benefit_line,
              description_text: s.description,
              levels_enabled: s.levels_enabled,
              levels: s.levels,
              trial_pick_media_url: (s.trial_pick_media_url ?? "").trim(),
              trial_pick_media_type:
                s.trial_pick_media_type === "video"
                  ? "video"
                  : s.trial_pick_media_type === "image"
                    ? "image"
                    : "",
            }),
          })),
        }
      : base;
  }, [
      slug,
      name,
      niche,
      botName,
      salesFlowConfig,
      facebookPixelId,
      conversionsApiToken,
      websiteUrl,
      instagramUrl,
      businessTagline,
      traits,
      address,
      customerServicePhone,
      directions,
      directionsMediaUrl,
      directionsMediaType,
      vibe,
      openingMediaUrl,
      openingMediaType,
      segQuestions,
      quickReplies,
      arboxLink,
      objections,
      waSalesFollowup1,
      waSalesFollowup2,
      waSalesFollowup3,
      membershipsUrl,
      servicesHydrated,
      services,
  ]);

  const postSettings = useCallback(async () => {
    return fetch("/api/dashboard/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(getSavePayload()),
    });
  }, [getSavePayload]);

  const getSavePayloadRef = useRef(getSavePayload);
  getSavePayloadRef.current = getSavePayload;

  useEffect(() => {
    if (!canAutosave) return;
    const flush = () => {
      try {
        const body = JSON.stringify(getSavePayloadRef.current());
        void fetch("/api/dashboard/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        });
      } catch {
        /* noop */
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [canAutosave]);

  useEffect(() => {
    if (!canAutosave) return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      void (async () => {
        setAutosaveStatus("saving");
        setAutoSaveErr("");
        try {
          const res = await postSettings();
          if (cancelled) return;
          if (!res.ok) {
            const msg = await readSaveErrorFromResponse(res);
            if (!cancelled) {
              setAutosaveStatus("error");
              setAutoSaveErr(msg);
            }
            return;
          }
          if (!cancelled) {
            setAutoSaveErr("");
            setAutosaveStatus("saved");
            window.setTimeout(() => {
              setAutosaveStatus((s) => (s === "saved" ? "idle" : s));
            }, 2500);
          }
        } catch {
          if (!cancelled) {
            setAutosaveStatus("error");
            setAutoSaveErr("בעיית רשת בשמירה אוטומטית.");
          }
        }
      })();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [canAutosave, postSettings]);

  const saveAll = useCallback(async () => {
    setSaving(true);
    setSaveErr("");
    setAutoSaveErr("");
    try {
      const res = await postSettings();
      if (!res.ok) {
        setSaveErr(await readSaveErrorFromResponse(res));
        return false;
      }
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
      setAutosaveStatus("idle");
      setAutoSaveErr("");
      return true;
    } catch {
      setSaveErr("לא ניתן להתחבר לשרת.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [postSettings]);

  const applyWaSalesFollowupDefaults = useCallback(() => {
    setWaSalesFollowup1(WA_SALES_FOLLOWUP_1_DEFAULT);
    setWaSalesFollowup2(WA_SALES_FOLLOWUP_2_DEFAULT);
    setWaSalesFollowup3(WA_SALES_FOLLOWUP_3_DEFAULT);
  }, []);

  const regenerateSalesFlowSection = useCallback(
    (
      section:
        | "opening"
        | "service_pick"
        | "warmup"
        | "cta"
        | "after_trial_registration"
    ) => {
      const base = defaultSalesFlowConfig(vibe);
      setSalesFlowConfig((c) => {
        if (!c) return base;
        if (section === "opening") {
          return {
            ...c,
            greeting_body_override: undefined,
            greeting_opener: base.greeting_opener,
            greeting_line_name: base.greeting_line_name,
            greeting_line_tagline: base.greeting_line_tagline,
            greeting_closer: base.greeting_closer,
            greeting_extra_steps: structuredClone(base.greeting_extra_steps),
          };
        }
        if (section === "service_pick") {
          const namedServices = services.filter((s) => s.name.trim());
          const includeOpener = namedServices.length > 1;
          setServices((prev) =>
            prev.map((service) => {
              const serviceName = service.name.trim();
              if (!serviceName) return service;
              const meta = parseServiceDescriptionMeta(service.description);
              const descriptionText = String(meta.description_text ?? meta.description ?? service.description ?? "").trim();
              const benefits = Array.isArray(meta.benefits)
                ? meta.benefits.map((x) => String(x ?? "").trim()).filter(Boolean)
                : [];
              const suggestions = Array.isArray(meta.benefit_suggestions)
                ? meta.benefit_suggestions.map((x) => String(x ?? "").trim()).filter(Boolean)
                : [];
              return {
                ...service,
                benefit_line: buildServiceReplyDraft(
                  serviceName,
                  descriptionText,
                  "",
                  benefits,
                  suggestions,
                  service.levels_enabled,
                  service.levels,
                  includeOpener
                ),
              };
            })
          );
          return {
            ...c,
            multi_service_question: base.multi_service_question,
            after_service_pick: base.after_service_pick,
            greeting_extra_steps: [],
          };
        }
        if (section === "warmup") {
          return {
            ...c,
            experience_question: base.experience_question,
            experience_options: structuredClone(base.experience_options),
            after_experience: base.after_experience,
            opening_extra_steps: structuredClone(base.opening_extra_steps),
          };
        }
        if (section === "cta") {
          return {
            ...c,
            cta_body: base.cta_body,
            cta_buttons: structuredClone(base.cta_buttons),
            cta_extra_steps: structuredClone(base.cta_extra_steps),
            followup_after_next_class_body: base.followup_after_next_class_body,
            followup_after_next_class_options: structuredClone(base.followup_after_next_class_options),
            free_chat_invite_reply: base.free_chat_invite_reply,
          };
        }
        return { ...c, after_trial_registration_body: base.after_trial_registration_body };
      });
    },
    [services, vibe]
  );

  // ─── Media upload ──────────────────────────────────────────────────────────

  async function uploadMedia(file: File, target: "opening" | "directions") {
    const setError = target === "opening" ? setMediaUploadError : setDirectionsMediaUploadError;
    const setUploading = target === "opening" ? setUploadingMedia : setUploadingDirectionsMedia;
    const setUrl = target === "opening" ? setOpeningMediaUrl : setDirectionsMediaUrl;
    const setType = target === "opening" ? setOpeningMediaType : setDirectionsMediaType;
    setError("");
    if (file.type === "image/webp" || /\.webp$/i.test(file.name)) {
      setError("קובץ WebP לא נתמך ב-WhatsApp. אנא העלו JPG או PNG.");
      return;
    }
    if (file.size > MAX_MEDIA_UPLOAD_BYTES) {
      setError(
        "הקובץ גדול מדי (מקסימום 16MB). נסו לכווץ את הסרטון או קובץ קטן יותר."
      );
      return;
    }
    setUploading(true);
    try {
      const signRes = await fetch("/api/dashboard/upload-media-signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          fileSize: file.size,
        }),
      });
      let signJson: {
        signedUrl?: string;
        publicUrl?: string;
        error?: string;
      } = {};
      try {
        signJson = (await signRes.json()) as typeof signJson;
      } catch {
        setError("תשובת שרת לא תקינה.");
        return;
      }
      if (!signRes.ok) {
        setError(signJson.error?.trim() || `הכנת העלאה נכשלה (${signRes.status}).`);
        return;
      }
      const signedUrl = signJson.signedUrl?.trim();
      const publicUrl = signJson.publicUrl?.trim();
      if (!signedUrl || !publicUrl) {
        setError("לא התקבל קישור חתום להעלאה - נסו שוב.");
        return;
      }

      const putRes = await fetch(signedUrl, {
        method: "PUT",
        headers: {
          "x-upsert": "true",
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });

      if (!putRes.ok) {
        let errText = "";
        try {
          const errJson = (await putRes.json()) as { message?: string; error?: string };
          errText = (errJson.message || errJson.error || "").trim();
        } catch {
          errText = putRes.statusText || "";
        }
        setError(errText || `העלאה ל-Storage נכשלה (${putRes.status}).`);
        return;
      }

      setUrl(publicUrl);
      setType(file.type.startsWith("video") ? "video" : "image");
    } catch {
      setError("בעיית רשת בהעלאה.");
    } finally {
      setUploading(false);
    }
  }

  async function uploadTrialPickMedia(file: File, serviceUiId: string) {
    setTrialPickMediaUploadError("");
    setTrialPickFailedUiId(null);
    if (file.type === "image/webp" || /\.webp$/i.test(file.name)) {
      setTrialPickMediaUploadError("קובץ WebP לא נתמך ב-WhatsApp. אנא העלו JPG או PNG.");
      setTrialPickFailedUiId(serviceUiId);
      return;
    }
    if (file.size > MAX_MEDIA_UPLOAD_BYTES) {
      setTrialPickMediaUploadError(
        "הקובץ גדול מדי (מקסימום 16MB). נסו לכווץ את הסרטון או קובץ קטן יותר."
      );
      setTrialPickFailedUiId(serviceUiId);
      return;
    }
    setUploadingTrialPickUiId(serviceUiId);
    try {
      const signRes = await fetch("/api/dashboard/upload-media-signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          fileSize: file.size,
        }),
      });
      let signJson: { signedUrl?: string; publicUrl?: string; error?: string } = {};
      try {
        signJson = (await signRes.json()) as typeof signJson;
      } catch {
        setTrialPickMediaUploadError("תשובת שרת לא תקינה.");
        setTrialPickFailedUiId(serviceUiId);
        return;
      }
      if (!signRes.ok) {
        setTrialPickMediaUploadError(signJson.error?.trim() || `הכנת העלאה נכשלה (${signRes.status}).`);
        setTrialPickFailedUiId(serviceUiId);
        return;
      }
      const signedUrl = signJson.signedUrl?.trim();
      const publicUrl = signJson.publicUrl?.trim();
      if (!signedUrl || !publicUrl) {
        setTrialPickMediaUploadError("לא התקבל קישור חתום להעלאה - נסו שוב.");
        setTrialPickFailedUiId(serviceUiId);
        return;
      }
      const putRes = await fetch(signedUrl, {
        method: "PUT",
        headers: {
          "x-upsert": "true",
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });
      if (!putRes.ok) {
        let errText = "";
        try {
          const errJson = (await putRes.json()) as { message?: string; error?: string };
          errText = (errJson.message || errJson.error || "").trim();
        } catch {
          errText = putRes.statusText || "";
        }
        setTrialPickMediaUploadError(errText || `העלאה ל-Storage נכשלה (${putRes.status}).`);
        setTrialPickFailedUiId(serviceUiId);
        return;
      }
      const mt: "image" | "video" = file.type.startsWith("video") ? "video" : "image";
      setTrialPickFailedUiId(null);
      setServices((prev) =>
        prev.map((svc) =>
          svc.ui_id === serviceUiId ? { ...svc, trial_pick_media_url: publicUrl, trial_pick_media_type: mt } : svc
        )
      );
    } catch {
      setTrialPickMediaUploadError("בעיית רשת בהעלאה.");
      setTrialPickFailedUiId(serviceUiId);
    } finally {
      setUploadingTrialPickUiId(null);
    }
  }

  // ─── Fetch site ────────────────────────────────────────────────────────────

  async function fetchSite(nextStepAfterScan = 1) {
    if (!websiteUrl) return;
    setFetchingUrl(true);
    setFetchSiteError("");
    setFetchSiteNotice("");
    try {
      const res = await fetch("/api/dashboard/fetch-site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website_url: websiteUrl, business_name: name, niche }),
      });
      let j: Record<string, unknown> = {};
      try {
        j = (await res.json()) as Record<string, unknown>;
      } catch {
        setFetchSiteError("תשובת שרת לא תקינה.");
        return;
      }

      const errStr = typeof j.error === "string" ? j.error : "";
      const msgStr = typeof j.message === "string" ? j.message.trim() : "";

      if (!res.ok) {
        const friendly =
          errStr === "unauthorized"
            ? "נדרשת התחברות מחדש."
            : errStr === "missing_website_url"
              ? "חסרה כתובת אתר."
              : errStr === "missing_anthropic_key"
                ? "חסר מפתח AI בשרת - פנו לתמיכה."
                : errStr === "ai_parse_failed"
                  ? "לא ניתן לעבד את תוצאת הסריקה. נסו שוב."
                  : msgStr ||
                    (errStr === "blocked_auto_scraping"
                      ? "האתר חוסם סריקה אוטומטית - מלאו את השדות ידנית."
                      : `הסריקה נכשלה (${res.status}).`);
        setFetchSiteError(friendly);
        const hasPayload =
          Boolean(j.niche) ||
          Boolean(j.tagline) ||
          Boolean(j.business_description) ||
          (Array.isArray(j.business_traits) && j.business_traits.length > 0) ||
          (Array.isArray(j.products) && j.products.length > 0);
        if (!hasPayload) return;
      }

      if (typeof j.warning === "string" && j.warning && msgStr) {
        setFetchSiteNotice(msgStr);
      }

      const bn =
        (typeof j.business_name === "string" && j.business_name.trim()) ||
        (typeof j.businessName === "string" && j.businessName.trim());
      if (bn) {
        setName(String(bn).trim());
        setBusinessNameEditing(false);
      }

      if (typeof j.niche === "string" && j.niche.trim()) setNiche(j.niche.trim());
      const tag =
        (typeof j.tagline === "string" && j.tagline.trim()) ||
        (typeof j.business_description === "string" && j.business_description.trim()) ||
        "";
      if (!businessTagline.trim() && tag) setBusinessTagline(tag.split("\n")[0].trim());
      if (!address.trim() && typeof j.address === "string" && j.address.trim()) setAddress(j.address.trim());
      if (typeof j.directions === "string" && j.directions.trim()) setDirections(j.directions.trim());
      if (typeof j.customer_service_phone === "string" && j.customer_service_phone.trim()) {
        setCustomerServicePhone(j.customer_service_phone.trim());
      }
      const book =
        (typeof j.schedule_booking_url === "string" && j.schedule_booking_url.trim()) ||
        (typeof j.schedule_url === "string" && j.schedule_url.trim()) ||
        "";
      if (book) setArboxLink(book);
      const scannedTraits = Array.isArray(j.business_traits)
        ? j.business_traits.map((x: unknown) => String(x ?? "").trim()).filter(Boolean)
        : [];
      if (scannedTraits.length) setTraits(normalizeTraitsState(scannedTraits));
      const addrFallback =
        (typeof j.address === "string" && j.address.trim()) ? j.address.trim() : address;
      if (Array.isArray(j.products) && j.products.length > 0) {
        setServices(trialServicesFromSiteProducts(j.products, addrFallback));
        setServicesHydrated(true);
      }
      setStep(nextStepAfterScan);
    } finally {
      setFetchingUrl(false);
    }
  }

  // ─── Services drag & drop ──────────────────────────────────────────────────

  function onDragStart(i: number) { dragIdx.current = i; }
  function onDragOver(e: React.DragEvent, i: number) {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === i) return;
    const arr = [...services];
    const [item] = arr.splice(dragIdx.current, 1);
    arr.splice(i, 0, item);
    dragIdx.current = i;
    setServices(arr);
  }
  function onDragEnd() { dragIdx.current = null; }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="hz-shell min-h-screen bg-transparent" dir="rtl">
        <div className="sticky top-0 z-40 border-b border-white/50 bg-white/65 shadow-[0_14px_40px_rgba(95,64,178,0.1)] backdrop-blur-xl">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between animate-pulse">
            <div className="h-4 w-40 rounded bg-zinc-200" />
            <div className="h-4 w-24 rounded bg-zinc-200" />
          </div>
          <div className="max-w-6xl mx-auto px-4 pb-3 overflow-x-auto">
            <div className="flex gap-2 min-w-max animate-pulse">
              {Array.from({ length: STEPS.length }).map((_, i) => (
                <div key={i} className="h-8 w-24 rounded-[20px] bg-[#ede9fe]" />
              ))}
            </div>
          </div>
        </div>

          <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
          <div className="rounded-[28px] border border-white/75 bg-white/80 p-6 animate-pulse space-y-4 shadow-[0_24px_70px_rgba(95,64,178,0.12)] backdrop-blur-xl">
            <div className="flex items-center justify-end gap-3">
              <div className="h-8 w-8 rounded-full bg-[#f0eaff]" />
              <div className="h-5 w-40 rounded bg-zinc-200" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="h-3 w-20 rounded bg-zinc-200 ml-auto" />
                <div className="h-10 w-full rounded-xl bg-zinc-100" />
              </div>
              <div className="space-y-2">
                <div className="h-3 w-20 rounded bg-zinc-200 ml-auto" />
                <div className="h-10 w-full rounded-xl bg-zinc-100" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-3 w-20 rounded bg-zinc-200 ml-auto" />
              <div className="h-10 w-full rounded-xl bg-zinc-100" />
            </div>
            <div className="space-y-2">
              <div className="h-3 w-24 rounded bg-zinc-200 ml-auto" />
              <div className="h-24 w-full rounded-xl bg-zinc-100" />
            </div>
          </div>

          <div className="mt-8 flex items-center justify-between border-t border-white/70 pt-5 animate-pulse">
            <div className="h-10 w-24 rounded-xl bg-zinc-200" />
            <div className="h-4 w-16 rounded bg-zinc-200" />
            <div className="h-10 w-28 rounded-xl bg-zinc-200" />
          </div>
        </div>
      </div>
    );
  }

  const isFirst = step === 1;
  const isLast  = step === STEPS.length;

  function nextStep() {
    setStep((s) => Math.min(STEPS.length, s + 1));
  }

  function prevStep() {
    setStep((s) => Math.max(1, s - 1));
  }

  return (
    <div className="hz-shell min-h-screen bg-transparent" dir="rtl">

      {/* ── Top bar ── */}
      <div className="sticky top-0 z-40 border-b border-white/50 bg-white/68 shadow-[0_18px_50px_rgba(95,64,178,0.1)] backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
            <span className="hz-gradient-text font-extrabold">HeyZoe</span>
            <span className="text-zinc-300">/</span>
            <span>{slug}</span>
          </div>
          {canAutosave ? (
            <div className="hz-frost-strong text-xs text-zinc-500 flex items-center gap-1.5 shrink-0 min-h-[1.25rem] rounded-full px-3 py-1.5" aria-live="polite">
              {autosaveStatus === "saving" && (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7133da]" aria-hidden />
                  <span>שומר…</span>
                </>
              )}
              {autosaveStatus === "saved" && <span className="text-emerald-600">נשמר אוטומטית</span>}
              {autosaveStatus === "error" && (
                <span className="text-amber-600 max-w-[min(20rem,55vw)] text-right" title={autoSaveErr || undefined}>
                  שמירה אוטומטית נכשלה{autoSaveErr ? ` - ${autoSaveErr}` : ""}
                </span>
              )}
            </div>
          ) : null}
        </div>

        {/* Step indicator */}
        <div className="max-w-6xl mx-auto px-4 pb-4 overflow-x-auto">
        <div className="flex gap-2 sm:gap-2.5 min-w-max items-center">
            {STEPS.map((label, i) => {
              const n = i + 1;
              const active  = step === n;
              return (
                <button
                  key={n}
                  onClick={() => setStep(n)}
                  className={[
                    // Mobile: clear separation via pills + border
                    "px-3 py-1.5 rounded-full border text-[12px] font-semibold transition-all select-none",
                    // Desktop: slightly bigger and more “tabby”
                    "sm:text-sm sm:font-semibold sm:px-4 sm:py-2",
                    active
                      ? "bg-white text-[#2d1a6e] border-[rgba(113,51,218,0.35)] shadow-[0_10px_22px_rgba(112,84,182,0.14)]"
                      : "bg-white/55 text-zinc-700 border-white/60 hover:bg-white hover:text-zinc-900",
                  ].join(" ")}
                  aria-current={active ? "page" : undefined}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {settingsLoadError ? (
        <div className="mx-4 mt-4 rounded-2xl border border-red-200/70 bg-red-50/90 px-4 py-3 text-center text-sm text-red-800 shadow-[0_12px_28px_rgba(239,68,68,0.08)]" role="alert">
          {settingsLoadError}
        </div>
      ) : null}

      {/* ── Step content ── */}
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="max-w-2xl mx-auto w-full">

        {/* ════════════════════ STEP 1 — לינקים ════════════════════ */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle>
                <StepHeader
                  n={1}
                  title="לינקים"
                  desc="זואי תג׳נרט מידע אוטומטית ותשלח לינקים רלוונטים ללידים."
                />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field label="לינק לאתר">
                <p className="text-xs text-zinc-500 mt-0.5 mb-2 text-right leading-relaxed">
                  סרקו והמתינו דקה ליצירת תוכן אוטומטית
                </p>
                <div className="flex gap-2">
                  <Input
                    dir="ltr"
                    placeholder="https://your-business.com"
                    value={websiteUrl}
                    onChange={e => setWebsiteUrl(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && fetchSite()}
                  />
                  <Button onClick={() => void fetchSite()} disabled={!websiteUrl || fetchingUrl} className="shrink-0 gap-2">
                    {fetchingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {fetchingUrl ? "סורק..." : "סרוק"}
                  </Button>
                </div>
              </Field>
              {fetchingUrl && (
                <p className="text-sm text-[#7133da] flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  מנתח את האתר - זה לוקח כמה שניות...
                </p>
              )}
              {fetchSiteError ? (
                <p className="text-sm text-red-600" role="alert">
                  {fetchSiteError}
                </p>
              ) : null}
              {fetchSiteNotice ? (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  {fetchSiteNotice}
                </p>
              ) : null}

              <Field label="לינק מערכת שעות">
                <Input dir="ltr" value={arboxLink} onChange={e => setArboxLink(e.target.value)} placeholder="https://..." />
              </Field>

              <Field label="לינק לדף מנויים וכרטיסיות">
                <Input
                  dir="ltr"
                  value={membershipsUrl}
                  onChange={(e) => setMembershipsUrl(e.target.value)}
                  placeholder="https://..."
                />
              </Field>

              <Field label="לינק לאינסטגרם">
                <div className="flex flex-row-reverse gap-2 items-stretch">
                  <span
                    className="flex items-center justify-center w-11 shrink-0 rounded-xl border border-zinc-200 bg-gradient-to-br from-fuchsia-500/10 to-pink-500/15 text-pink-600"
                    aria-hidden
                  >
                    <InstagramGlyph className="h-5 w-5" />
                  </span>
                  <Input
                    dir="ltr"
                    className="flex-1 min-w-0"
                    placeholder="https://instagram.com/..."
                    value={instagramUrl}
                    onChange={(e) => setInstagramUrl(e.target.value)}
                  />
                </div>
              </Field>
            </CardContent>
          </Card>
        )}

        {/* ════════════════════ STEP 2 — על העסק ════════════════════ */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle>
                <StepHeader n={2} title="על העסק" desc="שם, תיאור, כתובת והטון - מה שזואי יודעת עליכם." />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <WhatsAppNumberSection slug={slug} />

              <div className="grid grid-cols-2 gap-4">
                <Field label="שם העסק *">
                  {name.trim() && !businessNameEditing ? (
                    <div className="flex items-stretch gap-2 rounded-xl border border-zinc-300 bg-zinc-50 min-h-10">
                      <div className="flex-1 px-3 py-2.5 text-sm font-semibold text-zinc-900 text-right leading-snug">
                        {name}
                      </div>
                      <button
                        type="button"
                        onClick={() => setBusinessNameEditing(true)}
                        className="shrink-0 px-3 text-xs font-medium text-[#7133da] hover:bg-[#f0eaff] rounded-l-xl border-r border-zinc-200"
                      >
                        עריכה
                      </button>
                    </div>
                  ) : (
                    <Input
                      dir="rtl"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onBlur={() => {
                        if (name.trim()) setBusinessNameEditing(false);
                      }}
                      placeholder="שם העסק"
                      className="font-medium text-zinc-900"
                      autoFocus={businessNameEditing}
                    />
                  )}
                </Field>
                <Field label="שם הבוט">
                  <Input dir="rtl" value={botName} onChange={e => setBotName(e.target.value)} placeholder="זואי" />
                </Field>
              </div>

              <Field
                label={
                  <div className="flex items-baseline justify-between gap-2">
                    <span>תיאור העסק</span>
                    <span className="text-[11px] font-medium text-zinc-400">קצר וקולע</span>
                  </div>
                }
              >
                <Input
                  dir="rtl"
                  value={businessTagline}
                  onChange={(e) => setBusinessTagline(e.target.value)}
                  placeholder="סטודיו לפילאטיס מכשירים לחיטוב ובריאות הגוף"
                />
              </Field>

              <Field label="כתובת">
                <Input
                  dir="rtl"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  placeholder="רחוב הרצל 5, תל אביב"
                  autoComplete="street-address"
                />
              </Field>

              <Field label="טלפון לשירות לקוחות" description="במידה וזואי לא תדע לענות.">
                <Input
                  dir="ltr"
                  className="font-mono text-sm"
                  value={customerServicePhone}
                  onChange={(e) => setCustomerServicePhone(e.target.value)}
                  placeholder="05…"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                />
              </Field>

              <Field
                label={
                  <div className="flex items-center justify-start gap-3 text-right">
                    <span className="text-right">הנחיות הגעה</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (plan === "basic") {
                          setShowStarterMediaProModal(true);
                          return;
                        }
                        setShowDirectionsMediaModal(true);
                      }}
                      className="text-sm font-light text-[#027eb5] hover:text-[#02638f]"
                    >
                      העלה קובץ
                    </button>
                  </div>
                }
              >
                <Textarea value={directions} onChange={setDirections} placeholder="חנייה בחינם מאחורי הבניין, כניסה מצד ימין..." rows={2} />
              </Field>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 block">כל העובדות שכדאי לציין על העסק</label>

                <div className="space-y-2">
                  {traits.map((row, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <span className="text-sm text-zinc-500 w-6 shrink-0 text-center">{i + 1}</span>
                      <Input
                        dir="rtl"
                        value={row}
                        onChange={(e) =>
                          setTraits((prev) => {
                            const next = [...prev];
                            next[i] = e.target.value;
                            return next;
                          })
                        }
                        placeholder={traitPlaceholder(i)}
                        className="flex-1"
                      />
                      {traits.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => setTraits((prev) => prev.filter((_, j) => j !== i))}
                          className="p-1.5 text-zinc-400 hover:text-red-500 shrink-0"
                          aria-label="הסר שורה"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : (
                        <span className="w-8 shrink-0" />
                      )}
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-violet-200/70 bg-violet-50/70 p-3 text-right">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[#2d1a6e]">שאלות נוספות</p>
                    </div>
                    {factQuestions.length > 1 ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 px-3 text-xs"
                        onClick={() =>
                          setFactQuestionIdx((i) =>
                            factQuestions.length ? (i + 1) % factQuestions.length : 0
                          )
                        }
                      >
                        החלף
                      </Button>
                    ) : null}
                  </div>

                  {factQuestions.length ? (
                    (() => {
                      const q = factQuestions[factQuestionIdx] ?? factQuestions[0]!;
                      return (
                        <div className="mt-3 rounded-xl border border-violet-200/70 bg-white/80 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-zinc-900">{q.question}</p>
                            <Button
                              type="button"
                              variant="outline"
                              className="h-8 px-3 text-xs gap-1"
                              onClick={() => {
                                addFactLine(factFromQuestionAnswer(q.question, factAnswers[q.id] ?? ""));
                                if (factQuestions.length > 1) {
                                  setFactQuestionIdx((i) => (i + 1) % factQuestions.length);
                                }
                              }}
                            >
                              <Plus className="h-3.5 w-3.5" />
                              הוסף לעובדות
                            </Button>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <Input
                              dir="rtl"
                              value={factAnswers[q.id] ?? ""}
                              onChange={(e) => {
                                const v = e.target.value;
                                setFactAnswers((m) => ({ ...m, [q.id]: v }));
                              }}
                              placeholder={q.placeholder}
                            />
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <p className="mt-3 text-sm text-zinc-700">
                      נראה שהעובדות כבר מכסות את רוב השאלות הנפוצות.
                    </p>
                  )}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-1"
                  onClick={() => setTraits((prev) => [...prev, ""])}
                >
                  <Plus className="h-4 w-4" />
                  הוסף
                </Button>
              </div>

              <Field label="הנחות ומבצעים">
                <Input
                  dir="rtl"
                  value={promotions}
                  onChange={(e) => setPromotions(e.target.value)}
                  placeholder="20% הנחה על מנויים חדשים עד סוף החודש"
                />
              </Field>

            </CardContent>
          </Card>
        )}

        {/* ════════════════════ STEP 3 — אימון ניסיון ════════════════════ */}
        {step === 3 && (
          <Step3Trial
            websiteUrl={websiteUrl}
            address={address}
            fetchingUrl={fetchingUrl}
            services={services}
            setServices={setServices}
            fetchSite={fetchSite}
            deriveBenefitLineFromDescription={deriveBenefitLineFromDescription}
            isLegacyGeneratedServiceReply={isLegacyGeneratedServiceReply}
            onDragOver={onDragOver}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            toSlug={toSlug}
            uid={uid}
            planIsStarter={plan === "basic"}
            onStarterMediaBlocked={() => setShowStarterMediaProModal(true)}
            uploadTrialPickMedia={uploadTrialPickMedia}
            uploadingTrialPickUiId={uploadingTrialPickUiId}
            trialPickMediaUploadError={trialPickMediaUploadError}
            trialPickFailedUiId={trialPickFailedUiId}
            videoUrlForPreview={videoUrlForPreview}
          />
        )}

        {/* ════════════════════ STEP 4 — מסלול מכירה ════════════════════ */}
        {step === 4 && (
          <Step4SalesFlow
            planIsStarter={plan === "basic"}
            onStarterMediaBlocked={() => setShowStarterMediaProModal(true)}
            openingMediaUrl={openingMediaUrl}
            openingMediaType={openingMediaType}
            uploadingMedia={uploadingMedia}
            mediaInputRef={mediaInputRef}
            uploadMedia={uploadMedia}
            setOpeningMediaUrl={setOpeningMediaUrl}
            setOpeningMediaType={setOpeningMediaType}
            setMediaUploadError={setMediaUploadError}
            mediaUploadError={mediaUploadError}
            regenerateSalesFlowSection={regenerateSalesFlowSection}
            salesFlowConfig={salesFlowConfig}
            setSalesFlowConfig={setSalesFlowConfig}
            salesOpeningAutoText={salesOpeningAutoText}
            trialServiceNames={trialServiceNames}
            firstNamedService={firstNamedService}
            firstTrialForTemplates={firstTrialForTemplates}
            services={services}
            setServices={setServices}
            videoUrlForPreview={videoUrlForPreview}
            experienceQuestionForDisplay={experienceQuestionForDisplay}
            experienceQuestionToStore={experienceQuestionToStore}
            afterExperienceForDisplay={afterExperienceForDisplay}
            afterExperienceToStore={afterExperienceToStore}
            ctaBodyForDisplay={ctaBodyForDisplay}
            ctaBodyToStore={ctaBodyToStore}
            uid={uid}
          />
        )}

        {/* ════════════════════ STEP 5 — פולואפ ════════════════════ */}
        {step === 5 && (
          <Card>
            <CardHeader>
              <CardTitle>
                <StepHeader
                  n={5}
                  title="פולואפ"
                  desc="הודעות פולואפ לליד שהפסיק לענות. השליחה לא תתבצע בלילות ובמהלך השבת, או אם עברו 24 שעות מהודעת המשתמש האחרונה (מגבלת מטא)."
                />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex flex-wrap justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1 text-xs py-1.5 px-3 h-auto"
                  onClick={applyWaSalesFollowupDefaults}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  איפוס לטקסטי ברירת מחדל
                </Button>
              </div>
              <Field label="הודעה ראשונה (~20 דקות אחרי תשובת הבוט)">
                <Textarea value={waSalesFollowup1} onChange={setWaSalesFollowup1} rows={5} />
              </Field>
              <Field label="הודעה שנייה (~שעתיים)">
                <Textarea value={waSalesFollowup2} onChange={setWaSalesFollowup2} rows={5} />
              </Field>
              <Field label="הודעה שלישית (~23 שעות)">
                <Textarea value={waSalesFollowup3} onChange={setWaSalesFollowup3} rows={6} />
              </Field>
            </CardContent>
          </Card>
        )}

        </div>

        {/* ── Error ── */}
        {saveErr && <p className="text-sm text-red-500 text-center mt-4">{saveErr}</p>}

        {/* ── Navigation ── */}
        <div className="flex items-center justify-between mt-8 pt-4 border-t border-zinc-200 max-w-6xl mx-auto px-4">
          <Button
            variant="outline"
            onClick={prevStep}
            disabled={isFirst}
            className="gap-2"
          >
            <ArrowRight className="h-4 w-4" />
            הקודם
          </Button>

          <span className="text-sm text-zinc-400">{step} / {STEPS.length}</span>

          {isLast ? (
            <Button
              onClick={() => void saveAll()}
              disabled={saving || !settingsHydrated}
              className="gap-2"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {saving ? "שומר..." : "שמור הכל"}
            </Button>
          ) : (
            <Button
              disabled={saving || !settingsHydrated}
              onClick={() => {
                void (async () => {
                  const ok = await saveAll();
                  if (ok) nextStep();
                })();
              }}
              className="gap-2"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              הבא
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
        </div>

        {showStarterMediaProModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-5 text-right shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-zinc-900">תכונה זו זמינה בחבילת Pro בלבד</p>
                  <p className="mt-2 text-sm text-zinc-600 leading-relaxed">
                    שדרג כדי לאפשר העלאת תמונות ווידאו להודעות זואי
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowStarterMediaProModal(false)}
                  className="rounded-full p-1 text-zinc-500 hover:text-zinc-800 shrink-0"
                  aria-label="סגור"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-6 flex justify-start gap-2">
                <NextLink
                  href="/account/billing"
                  onClick={() => setShowStarterMediaProModal(false)}
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-[#7133da] px-5 text-sm font-medium text-white hover:bg-[#5f2bc7]"
                >
                  שדרג ל‑Pro
                </NextLink>
                <Button type="button" variant="outline" className="rounded-xl" onClick={() => setShowStarterMediaProModal(false)}>
                  סגור
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {showDirectionsMediaModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-5 text-right shadow-xl">
              <div className="flex items-start justify-between gap-3 text-right">
                <div>
                  <p className="text-right text-base font-semibold text-zinc-900">מדיה להנחיות הגעה</p>
                  <p className="mt-0.5 text-right text-xs text-zinc-500">תמונה או סרטון שישלחו יחד עם ההוראות הכתובות</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDirectionsMediaModal(false)}
                  className="rounded-full p-1 text-zinc-500 hover:text-zinc-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {!directionsMediaUrl ? (
                  <button
                    type="button"
                    disabled={uploadingDirectionsMedia}
                    onClick={() => !uploadingDirectionsMedia && directionsMediaInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-zinc-300 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-[#7133da]/50 hover:bg-[#f7f3ff] transition-all disabled:opacity-60 disabled:pointer-events-none"
                  >
                    {uploadingDirectionsMedia ? (
                      <>
                        <Loader2 className="h-8 w-8 animate-spin text-[#7133da]/60" />
                        <p className="text-sm text-zinc-500">מעלה ושומרת...</p>
                      </>
                    ) : (
                      <>
                        <Upload className="h-8 w-8 text-zinc-400" />
                        <p className="text-sm text-zinc-500">לחץ להעלאת תמונה או סרטון</p>
                        <p className="text-xs text-zinc-400">עד 16MB. JPG, PNG, GIF, MP4</p>
                      </>
                    )}
                  </button>
                ) : (
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 space-y-3">
                    {directionsMediaType === "video" ? (
                      <div className="relative mx-auto w-fit max-w-full">
                        <video
                          src={videoUrlForPreview(directionsMediaUrl)}
                          className="block max-h-72 max-w-full rounded-xl bg-black"
                          muted
                          playsInline
                          preload="metadata"
                          controls
                        />
                        <p className="text-center text-xs text-emerald-600 mt-2 font-medium">הסרטון הועלה ונשמר</p>
                      </div>
                    ) : (
                      <div className="relative mx-auto w-fit max-w-full">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={directionsMediaUrl} alt="מדיה להנחיות הגעה" className="mx-auto block max-h-72 max-w-full rounded-xl object-contain" />
                        <p className="text-center text-xs text-emerald-600 mt-2 font-medium">התמונה הועלתה ונשמרה</p>
                      </div>
                    )}
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-1 text-xs py-1.5 px-3 h-auto"
                        disabled={uploadingDirectionsMedia}
                        onClick={() => directionsMediaInputRef.current?.click()}
                      >
                        <Upload className="h-4 w-4" />
                        החלף קובץ
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-1 text-xs py-1.5 px-3 h-auto text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => {
                          setDirectionsMediaUrl("");
                          setDirectionsMediaType("");
                          setDirectionsMediaUploadError("");
                        }}
                      >
                        <X className="h-4 w-4" />
                        הסר קובץ
                      </Button>
                    </div>
                  </div>
                )}

                {directionsMediaUploadError ? (
                  <p className="text-sm text-red-600 text-right" role="alert">
                    {directionsMediaUploadError}
                  </p>
                ) : null}
                <input
                  ref={directionsMediaInputRef}
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void uploadMedia(f, "directions");
                  }}
                />
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Saved toast ── */}
        {savedOk && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-green-500 text-white px-5 py-2.5 rounded-full text-sm font-medium shadow-lg flex items-center gap-2 z-50">
            <Check className="h-4 w-4" /> נשמר בהצלחה!
          </div>
        )}
      </div>
    </div>
  );
}
