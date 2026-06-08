"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import NextLink from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import {
  ArrowLeft, ArrowRight, Check,
  Copy,
  Loader2, Upload, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildWelcomeMessageForStorage, splitWelcomeForChat } from "@/lib/welcome-message";
import {
  WA_SALES_FOLLOWUP_1_DEFAULT,
  WA_SALES_FOLLOWUP_2_DEFAULT,
  WA_SALES_FOLLOWUP_3_DEFAULT,
} from "@/lib/wa-sales-followup-defaults";
import {
  type OfferKind,
  type SalesFlowConfig,
  appendTrialPromotionToCtaBody,
  composeGreeting,
  defaultSalesFlowConfig,
  fillAfterExperienceTemplate,
  fillCtaBodyTemplate,
  fillCourseCtaBodyTemplate,
  fillWorkshopCtaBodyTemplate,
  migrateCtaBodyDisplayPlaceholders,
  formatServiceLevelsText,
  offerKindFromServiceMeta,
  parseSalesFlowFromSocial,
  serializeSalesFlowConfig,
  syncWelcomeFromSalesFlow,
  trialServicePhraseForAfterPick,
  patchWarmupRegenerationForOfferKind,
} from "@/lib/sales-flow";
import { truncateTrialServiceName } from "@/lib/trial-service";
import {
  createEmptyCourseCycle,
  migrateLegacyCourseToCycles,
  normalizeProductScheduleSlotsFromMeta,
  syncCourseLegacyDatesFromCycles,
  type CourseCycle,
} from "@/lib/product-schedule-slots";
import { dashboardSettingsFetcher, dashboardSettingsKey } from "@/lib/fetchers";
import { compressImageForWhatsAppIfNeeded } from "@/lib/compress-image-for-whatsapp";
import { buildCourseSchedulePhraseForCta } from "@/lib/product-schedule-slots";
import { dashboardMaxUploadBytesForFile } from "@/lib/whatsapp-media-limits";
import { buildFactQuestions } from "@/lib/fact-questions";
import {
  DASHBOARD_CENTERED_CONTENT,
  DASHBOARD_SETTINGS_SHELL,
  SALES_PATH_STEPS,
  StepHeader,
  StepPanel,
} from "./settings-ui";

// ─── Types ────────────────────────────────────────────────────────────────────

type QuickReply  = { id: string; label: string; reply: string };
type Objection   = { id: string; question: string; answer: string };
type SegQuestion = { id: string; question: string; answers: { id: string; text: string; service_slug: string }[] };
type ServiceItem = {
  ui_id: string; name: string; price_text: string;
  duration: string; payment_link: string;
  service_slug: string; location_text: string; description: string;
  levels_enabled: boolean; levels: string[];
  /** trial (ברירת מחדל) | סדנה | קורס — קובע איזה סשן הנעה בווטסאפ */
  offer_kind: OfferKind;
  /** קורס בלבד: תאריך התחלה / סיום + מספר מפגשים (ידני) */
  course_start_date: string;
  course_end_date: string;
  course_sessions_count: string;
  /** תיאור קצר אחרי בחירת האימון בפלואו (משפט אחד) */
  benefit_line: string;
  /** מדיה שנשלחת לפני תשובת «בחירת סוג האימון» בווטסאפ */
  trial_pick_media_url: string;
  trial_pick_media_type: "image" | "video" | "";
  /** מועדי לוח שבועיים למוצר (מערכת שעות לא־אינטראקטיבית) */
  schedule_slots: { id: string; day: string; time: string }[];
  /** קורס בלבד: מחזורים (תאריכים + מועדים שבועיים) */
  course_cycles: CourseCycle[];
};

type WhatsAppChannel = {
  phone_display: string;
  provisioning_status: "pending" | "active" | "failed" | null;
} | null;

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = [...SALES_PATH_STEPS];

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
function dashboardMediaUploadSizeError(file: File): string | null {
  const max = dashboardMaxUploadBytesForFile(file);
  if (file.size <= max) return null;
  const maxMb = max / (1024 * 1024);
  const isVideo =
    file.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.name);
  if (isVideo) {
    return `הקובץ גדול מדי (סרטון: מקסימום ${maxMb}MB). נסו לכווץ את הקובץ.`;
  }
  return `הקובץ גדול מדי (תמונה: מקסימום ${maxMb}MB להעלאה).`;
}

async function prepareDashboardMediaUpload(
  file: File
): Promise<{ ok: true; file: File } | { ok: false; error: string }> {
  const sizeErr = dashboardMediaUploadSizeError(file);
  if (sizeErr) return { ok: false, error: sizeErr };
  try {
    const prepared = await compressImageForWhatsAppIfNeeded(file);
    return { ok: true, file: prepared };
  } catch {
    return {
      ok: false,
      error: "לא הצלחנו לכווץ את התמונה. נסו JPG/PNG קטן יותר.",
    };
  }
}

function videoUrlForPreview(url: string) {
  if (!url) return url;
  const base = url.split("#")[0];
  return `${base}#t=0.001`;
}

function uid() { return Math.random().toString(36).slice(2, 9); }

const TRIAL_SERVICES_STASH_STORAGE_PREFIX = "hz:dashboard-settings-services:v3:";
const TRIAL_SERVICES_STASH_TTL_MS = 6 * 60 * 60 * 1000;

type TrialServicesStashStoredRow = Omit<ServiceItem, "ui_id">;

function trialServicesStashStorageKey(slug: string): string {
  return `${TRIAL_SERVICES_STASH_STORAGE_PREFIX}${String(slug).trim().toLowerCase()}`;
}

function readTrialServicesStash(slug: string): ServiceItem[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(trialServicesStashStorageKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: unknown; rows?: unknown };
    if (typeof parsed.savedAt !== "number" || !Array.isArray(parsed.rows)) return null;
    if (Date.now() - parsed.savedAt > TRIAL_SERVICES_STASH_TTL_MS) {
      sessionStorage.removeItem(trialServicesStashStorageKey(slug));
      return null;
    }
    const out: ServiceItem[] = [];
    for (const row of parsed.rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Partial<TrialServicesStashStoredRow>;
      const name = String(r.name ?? "").trim();
      if (!name) continue;
      const mediaType = r.trial_pick_media_type;
      out.push({
        ui_id: uid(),
        name: String(r.name ?? ""),
        price_text: String(r.price_text ?? ""),
        duration: String(r.duration ?? ""),
        payment_link: String(r.payment_link ?? ""),
        service_slug: String(r.service_slug ?? ""),
        location_text: String(r.location_text ?? ""),
        description: String(r.description ?? ""),
        levels_enabled: r.levels_enabled === true,
        levels: Array.isArray(r.levels) ? r.levels.map((x) => String(x ?? "").trim()).filter(Boolean) : [],
        benefit_line: String(r.benefit_line ?? ""),
        offer_kind:
          r.offer_kind === "workshop" || r.offer_kind === "course" ? r.offer_kind : "trial",
        course_start_date: String(r.course_start_date ?? "").trim(),
        course_end_date: String(r.course_end_date ?? "").trim(),
        course_sessions_count: String(r.course_sessions_count ?? "").trim(),
        trial_pick_media_url: String(r.trial_pick_media_url ?? "").trim(),
        trial_pick_media_type: mediaType === "video" || mediaType === "image" ? mediaType : "",
        schedule_slots: Array.isArray(r.schedule_slots)
          ? (r.schedule_slots as { id?: unknown; day?: unknown; time?: unknown }[])
              .map((slot) => ({
                id: String(slot?.id ?? "").trim() || uid(),
                day: String(slot?.day ?? "").trim(),
                time: String(slot?.time ?? "").trim(),
              }))
              .filter((slot) => slot.day && slot.time)
          : [],
        course_cycles: Array.isArray(r.course_cycles)
          ? (r.course_cycles as {
              id?: unknown;
              start_date?: unknown;
              end_date?: unknown;
              schedule_slots?: unknown;
            }[])
              .map((cy) => ({
                id: String(cy?.id ?? "").trim() || uid(),
                start_date: String(cy?.start_date ?? "").trim(),
                end_date: String(cy?.end_date ?? "").trim(),
                schedule_slots: normalizeProductScheduleSlotsFromMeta(cy?.schedule_slots, uid),
              }))
          : [],
      });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

function writeTrialServicesStash(slug: string, rows: ServiceItem[]) {
  try {
    const named = rows.filter((s) => s.name.trim());
    if (!named.length) return;
    const payload = {
      savedAt: Date.now(),
      rows: named.map((s) => {
        const { ui_id, ...rest } = s;
        void ui_id;
        return {
          ...rest,
          trial_pick_media_type:
            rest.trial_pick_media_type === "video" || rest.trial_pick_media_type === "image"
              ? rest.trial_pick_media_type
              : ("" as const),
        };
      }),
    };
    sessionStorage.setItem(trialServicesStashStorageKey(slug), JSON.stringify(payload));
  } catch {
    /* quota / privacy mode */
  }
}

function clearTrialServicesStash(slug: string) {
  try {
    sessionStorage.removeItem(trialServicesStashStorageKey(slug));
  } catch {
    /* noop */
  }
}

/** מפתח יציב לשורת מוצר — שומר פתיחת כרטיס גם אחרי ריענון SWR */
function servicePersistenceKey(s: { service_slug?: string; name: string; ui_id: string }): string {
  const slug = serviceSlugForPersistence(String(s.service_slug ?? ""), s.name, s.ui_id);
  const name = truncateTrialServiceName(s.name).trim().toLowerCase();
  return slug || name || s.ui_id;
}

/** מיזוג תשובת שרת — שומר ui_id מקומי כדי שלא ייסגר כרטיס מוצר פתוח */
function mergeServerServicesIntoLocal(
  incomingRows: Record<string, unknown>[],
  current: ServiceItem[]
): ServiceItem[] {
  const fresh = dashboardApiRowsToServiceItems(incomingRows);
  if (!current.length) return fresh;
  const byKey = new Map<string, ServiceItem>();
  for (const row of current) {
    byKey.set(servicePersistenceKey(row), row);
  }
  return fresh.map((item) => {
    const prev = byKey.get(servicePersistenceKey(item));
    return prev ? { ...item, ui_id: prev.ui_id } : item;
  });
}

/** מפת שורות services מהשרת למצב טופס ההגדרות */
function dashboardApiRowsToServiceItems(rows: Record<string, unknown>[]): ServiceItem[] {
  return rows.map((s) => {
    const name = String(s.name ?? "");
    const rawDescription = String(s.description ?? "");
    const parsed = parseStoredServiceDescription(rawDescription);
    const meta = parsed.meta;
    const storedBenefit = String(meta.benefit_line ?? "").trim();
    const descriptionDraftSource = parsed.descriptionTextForUi;
    return {
      ui_id: uid(),
      name,
      price_text: String(s.price_text ?? ""),
      duration: String(meta.duration ?? ""),
      payment_link: String(meta.payment_link ?? ""),
      service_slug: String(s.service_slug ?? ""),
      location_text: String(s.location_text ?? ""),
      description: descriptionDraftSource,
      levels_enabled: meta.levels_enabled === true,
      levels: Array.isArray(meta.levels)
        ? meta.levels.map((x) => String(x ?? "").trim()).filter(Boolean)
        : [],
      benefit_line: descriptionDraftSource.trim()
        ? descriptionDraftSource.trim()
        : storedBenefit && !isLegacyGeneratedServiceReply(storedBenefit, name)
          ? storedBenefit
          : "",
      trial_pick_media_url: String(meta.trial_pick_media_url ?? "").trim(),
      trial_pick_media_type:
        meta.trial_pick_media_type === "video"
          ? "video"
          : meta.trial_pick_media_type === "image"
            ? "image"
            : "",
      offer_kind: offerKindFromServiceMeta(meta),
      course_sessions_count: String(meta.course_sessions_count ?? "").trim(),
      ...(() => {
        const kind = offerKindFromServiceMeta(meta);
        if (kind === "course") {
          let course_cycles = migrateLegacyCourseToCycles(meta, uid);
          if (!course_cycles.length) course_cycles = [createEmptyCourseCycle(uid)];
          const legacy = syncCourseLegacyDatesFromCycles(course_cycles);
          return {
            course_cycles,
            course_start_date: legacy.course_start_date,
            course_end_date: legacy.course_end_date,
            schedule_slots: [] as ServiceItem["schedule_slots"],
          };
        }
        return {
          course_cycles: [] as CourseCycle[],
          course_start_date: String(meta.course_start_date ?? "").trim(),
          course_end_date: String(meta.course_end_date ?? "").trim(),
          schedule_slots: normalizeProductScheduleSlotsFromMeta(meta.schedule_slots, uid),
        };
      })(),
    };
  });
}

function serviceDescriptionMetaForSave(s: ServiceItem): Record<string, unknown> {
  const base = {
    price_text: (s.price_text ?? "").trim(),
    duration: s.duration,
    payment_link: s.payment_link,
    benefit_line: benefitLineFromProductDescription(s.description),
    description_text: s.description,
    levels_enabled: s.levels_enabled,
    levels: s.levels,
    offer_kind: s.offer_kind,
    course_sessions_count: s.course_sessions_count,
    trial_pick_media_url: (s.trial_pick_media_url ?? "").trim(),
    trial_pick_media_type:
      s.trial_pick_media_type === "video"
        ? "video"
        : s.trial_pick_media_type === "image"
          ? "image"
          : "",
  };
  if (s.offer_kind === "course") {
    const course_cycles = (s.course_cycles ?? []).map((cy) => ({
      id: cy.id,
      start_date: cy.start_date.trim(),
      end_date: cy.end_date.trim(),
      schedule_slots: cy.schedule_slots,
    }));
    const { course_start_date, course_end_date } = syncCourseLegacyDatesFromCycles(course_cycles);
    return {
      ...base,
      course_cycles,
      course_start_date,
      course_end_date,
      schedule_slots: [],
    };
  }
  return {
    ...base,
    course_start_date: s.course_start_date,
    course_end_date: s.course_end_date,
    schedule_slots: s.schedule_slots,
  };
}

function payloadSavedTrialsWereCleared(payload: Record<string, unknown>): boolean {
  if (!Array.isArray(payload.services)) return false;
  return !payload.services.some((x: unknown) => String((x as { name?: unknown })?.name ?? "").trim());
}

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

/** ספרות בלבד עם קידומת מדינה, ללא + — לפי הפורמט של wa.me */
function whatsAppMeDigitsFromDisplay(phoneDisplay: string): string | null {
  const only = String(phoneDisplay ?? "").replace(/\D/g, "");
  if (!only) return null;
  if (only.startsWith("972")) return only;
  if (only.startsWith("0")) return `972${only.slice(1)}`;
  if (only.length === 9) return `972${only}`;
  return only;
}

function whatsAppPrefilledMessageHref(phoneDisplay: string, text: string): string | null {
  const num = whatsAppMeDigitsFromDisplay(phoneDisplay);
  if (!num) return null;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}

function WhatsAppNumberSection({ slug, compact = false }: { slug: string; compact?: boolean }) {
  const fetcher = useCallback(async (key: string) => {
    const res = await fetch(key, { method: "GET" });
    const j = (await res.json()) as { channel?: WhatsAppChannel; error?: string };
    if (!res.ok) throw new Error(j.error || `request_failed (${res.status})`);
    return (j.channel ?? null) as WhatsAppChannel;
  }, []);

  const key = useMemo(() => `/api/dashboard/whatsapp-channel?slug=${encodeURIComponent(slug)}`, [slug]);
  const { data, error, isLoading } = useSWR(key, fetcher, {
    /** מעבר בין טאבי ההגדרות לא אמור «למרר» את הנראות; רענון בפוקוס לא נחוץ */
    revalidateOnFocus: false,
    keepPreviousData: true,
    refreshInterval: (latest) => {
      const st = (latest as WhatsAppChannel)?.provisioning_status ?? null;
      return st === "pending" ? 10_000 : 0;
    },
  });

  const status = data?.provisioning_status ?? null;
  const friendly = formatIlWhatsAppPhoneFriendly(data?.phone_display ?? "");
  const whatsAppSendHref = useMemo(
    () => whatsAppPrefilledMessageHref(data?.phone_display ?? "", "היי"),
    [data?.phone_display]
  );

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
      if (st === "CONNECTED" || st === "PENDING" || st === "UNVERIFIED") {
        return st as "CONNECTED" | "PENDING" | "UNVERIFIED";
      }
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

    let cancelled = false;
    void (async () => {
      setMetaStatus(null);
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
    <div
      className={
        compact ? "h-full min-w-0" : "border-b border-zinc-200/80 pb-6 mb-2"
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-right">
          <div className="text-[0.95rem] font-semibold tracking-[-0.01em] text-zinc-800">
            מספר ה‑WhatsApp שלך
          </div>
          {compact ? null : (
            <div className="mt-0.5 text-xs text-zinc-500">המספר שעליו זואי עונה ללקוחות שלך</div>
          )}
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
        <div
          className={`${compact ? "mt-2" : "mt-3"} text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-right`}
        >
          לא ניתן לטעון את סטטוס המספר כרגע.
        </div>
      ) : null}

      {isLoading && !data ? (
        <div
          className={`${compact ? "mt-2 p-3" : "mt-3 p-4"} rounded-xl border border-zinc-200 bg-zinc-50/60 text-right text-sm text-zinc-600 flex items-center justify-between gap-3`}
        >
          <span>טוען…</span>
          <Loader2 className="h-4 w-4 animate-spin text-[#7133da]" aria-hidden />
        </div>
      ) : null}

      {metaStatus === "CONNECTED" || status === "active" ? (
        <div className={`${compact ? "mt-2" : "mt-3"} space-y-1.5 text-right`}>
          <div
            className={`flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white ${
              compact ? "px-2.5 py-1.5" : "px-3 py-2"
            }`}
          >
            <span className={`font-semibold text-zinc-900 ${compact ? "text-xs" : "text-sm"}`} dir="ltr">
              {friendly || data?.phone_display || "—"}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="outline"
                className={compact ? "h-7 w-8 px-0" : "h-8 w-9 px-0"}
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
                <Copy className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden />
              </Button>
              {whatsAppSendHref ? (
                <a
                  href={whatsAppSendHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={
                    compact
                      ? "inline-flex h-7 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-2xl border border-[rgba(120,92,200,0.18)] bg-white/80 px-2.5 text-[11px] font-semibold tracking-[-0.01em] text-zinc-900 shadow-[0_8px_18px_rgba(117,90,180,0.08)] backdrop-blur-sm transition-all duration-200 hover:border-[rgba(113,51,218,0.26)] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                      : "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-2xl border border-[rgba(120,92,200,0.18)] bg-white/80 px-3 text-xs font-semibold tracking-[-0.01em] text-zinc-900 shadow-[0_10px_24px_rgba(117,90,180,0.1)] backdrop-blur-sm transition-all duration-200 hover:border-[rgba(113,51,218,0.26)] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white hz-lift"
                  }
                >
                  שלח הודעה
                </a>
              ) : null}
            </div>
          </div>
          {copied ? <div className="text-[11px] text-emerald-700">המספר הועתק</div> : null}
          {compact ? null : (
            <p className="text-sm text-zinc-700">
              {metaText || "זואי עונה על המספר הזה. אפשר לשתף אותו עם הלקוחות שלך!"}
            </p>
          )}
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

/** מפתחות המזהים את אובייקט ה־JSON השמור בשדה description ב־API (לא טקסט חופשי) */
const SERVICE_META_JSON_HINT_KEYS = new Set([
  "benefit_line",
  "description_text",
  "description",
  "payment_link",
  "duration",
  "levels_enabled",
  "levels",
  "benefits",
  "benefit_suggestions",
  "trial_pick_media_url",
  "trial_pick_media_type",
  "schedule_slots",
  "offer_kind",
  "course_start_date",
  "course_end_date",
  "course_sessions_count",
  "course_cycles",
]);

/**
 * שדה ה־service.description בשרת נשמר כ־JSON.stringify({ duration, benefit_line, description_text, … }).
 * בטאב אימון ניסיון חייבים להציג רק את description_text — לא את כל ה־JSON.
 */
function parseStoredServiceDescription(rawDescription: string): {
  isStructured: boolean;
  meta: Record<string, unknown>;
  /** טקסט לשדה «תיאור» בלבד */
  descriptionTextForUi: string;
} {
  const trimmed = rawDescription.trim();
  if (!trimmed) return { isStructured: false, meta: {}, descriptionTextForUi: "" };

  const candidate = trimmed.startsWith("__META__:") ? trimmed.slice("__META__:".length).trim() : trimmed;
  if (!candidate.startsWith("{")) {
    return { isStructured: false, meta: {}, descriptionTextForUi: trimmed };
  }
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { isStructured: false, meta: {}, descriptionTextForUi: trimmed };
    }
    const rec = parsed as Record<string, unknown>;
    const structured = Object.keys(rec).some((k) => SERVICE_META_JSON_HINT_KEYS.has(k));
    if (!structured) {
      return { isStructured: false, meta: {}, descriptionTextForUi: trimmed };
    }
    const descriptionTextForUi = String(rec.description_text ?? rec.description ?? "").trim();
    return { isStructured: true, meta: rec, descriptionTextForUi };
  } catch {
    return { isStructured: false, meta: {}, descriptionTextForUi: trimmed };
  }
}

function serviceReplyPhrase(serviceName: string): string {
  const trimmed = serviceName.trim();
  if (!trimmed) return "האימון";
  if (/^שיעור(?:י)?\s+/u.test(trimmed)) return trimmed;
  if (/עמיד(?:ת|ו) יד(?:יים|ים)/u.test(trimmed)) return `שיעורי ${trimmed}`;
  return trialServicePhraseForAfterPick(trimmed);
}

function isLegacyGeneratedServiceReply(value: string, serviceName: string): boolean {
  const trimmed = value.trim();
  const phrase = serviceReplyPhrase(serviceName);
  return (
    /^(איזה כיף|אוקיי מדהים|כיף גדול|מהמם|כיף לשמוע|וואו|מדהים|מצוין|סופר)!/.test(trimmed) &&
    (trimmed.includes(`${phrase} מתמקדים ב`) ||
      trimmed.includes(`${phrase} שלנו מתמקדים ב`) ||
      trimmed.includes(`${phrase} אצלנו עובדים על בניית טכניקה נכונה`) ||
      trimmed.includes(`${phrase} שלנו הם דרך מעולה ל`))
  );
}

function benefitLineFromProductDescription(description: string): string {
  return String(description ?? "").trim();
}

/** מפתח למיזוג סריקה — אחרי קיצור שם וליישור פרפיקסים חוזים (שיעורי/אימון) */
function trialServiceMatchKey(rawName: string): string {
  let s = truncateTrialServiceName(String(rawName ?? "").trim()).toLowerCase();
  s = s.replace(/^שיעורי\s+/u, "").replace(/^שיעור\s+/u, "").replace(/^אימון\s+/u, "").trim();
  return s;
}

/** שורת אימון ניסיון מתוצאת סריקה (משמש גם בהוספת שורה חדשה בלבד — לא למצב עדכון) */
function trialServiceItemFromSiteProduct(
  p: Record<string, unknown>,
  addrFallback: string,
  rowId: string
): ServiceItem {
  const pname = truncateTrialServiceName(String(p.name ?? ""));
  const description = String(p.description ?? "").trim();
  const benefit_line = benefitLineFromProductDescription(description);
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
    offer_kind: "trial",
    course_start_date: "",
    course_end_date: "",
    course_sessions_count: "",
    benefit_line,
    trial_pick_media_url: "",
    trial_pick_media_type: "",
    schedule_slots: [],
    course_cycles: [],
  };
}

/**
 * סריקה מהאתר: לא משנה אימונים קיימים — רק מוסיף בסוף שורות לפי מוצרים שזיהה ובהם שם שלא מתאים לאף אימון בשם (אותה לוגיקת מפתח כמו בהתאמת מיזוג ישן).
 * עדכון תיאור/מחיר לשירות קיים רק באמצעות עריכה ידנית או כפתור «ג׳נרט» בטאב.
 */
function mergeTrialServicesWithScannedProducts(
  existing: ServiceItem[],
  products: unknown[],
  addrFallback: string
): ServiceItem[] {
  if (!Array.isArray(products) || products.length === 0) return existing;

  const slice = products.slice(0, 8).map((raw) => raw as Record<string, unknown>);
  const existingKeys = new Set<string>();
  for (const svc of existing) {
    const k = trialServiceMatchKey(svc.name);
    if (k) existingKeys.add(k);
  }

  const appended: ServiceItem[] = [];
  const addedFromScanKeys = new Set<string>();

  for (const raw of slice) {
    const k = trialServiceMatchKey(String(raw.name ?? ""));
    if (k && existingKeys.has(k)) continue;
    if (k && addedFromScanKeys.has(k)) continue;
    if (k) addedFromScanKeys.add(k);
    appended.push(trialServiceItemFromSiteProduct(raw, addrFallback, uid()));
  }

  return [...existing, ...appended];
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
  const displayName = service?.name?.trim() || "(שם המוצר)";
  return fillAfterExperienceTemplate(
    stored,
    service?.levels_enabled ?? false,
    service?.levels ?? [],
    displayName
  );
}

function afterExperienceToStore(typed: string, service: ServiceItem | null): string {
  if (!service) return typed;
  let s = typed;
  const resolved = formatServiceLevelsText(service.levels_enabled, service.levels);
  if (resolved && s.includes(resolved)) s = s.split(resolved).join("{levelsText}");
  const sn = service.name?.trim() ?? "";
  if (s.includes("(שם המוצר)")) s = s.split("(שם המוצר)").join("{serviceName}");
  if (s.includes("(שם האימון)")) s = s.split("(שם האימון)").join("{serviceName}");
  if (sn && s.includes(sn)) s = s.split(sn).join("{serviceName}");
  return s;
}

function ctaBodyForDisplay(stored: string): string {
  // ב־UI מציגים משתנה קבוע (x) כי המחיר/משך תלויים בבחירת סוג האימון
  return fillCtaBodyTemplate(stored, "x", "x");
}

function ctaBodyToStore(typed: string, priceText: string, durationText: string): string {
  let s = migrateCtaBodyDisplayPlaceholders(typed);
  // אם המשתמש השאיר x כפי שמוצג ב־UI, נשמור חזרה את התבנית.
  const p = priceText.trim();
  const d = durationText.trim();
  if (p && s.includes(p)) s = s.split(p).join("{priceText}");
  if (d && s.includes(d)) s = s.split(d).join("{durationText}");
  return s;
}

function workshopCtaBodyForDisplayUi(stored: string): string {
  return fillWorkshopCtaBodyTemplate(stored, "x", "x");
}

function workshopCtaBodyToStore(
  typed: string,
  priceText: string,
  durationText: string
): string {
  let s = migrateCtaBodyDisplayPlaceholders(typed)
    .replace(/\{priceText\}/g, "{price}")
    .replace(/\{durationText\}/g, "{duration}");
  const p = priceText.trim();
  const d = durationText.trim();
  if (p && s.includes(p)) s = s.split(p).join("{price}");
  if (d && s.includes(d)) s = s.split(d).join("{duration}");
  return s;
}

function courseCtaBodyForDisplayUi(stored: string): string {
  return fillCourseCtaBodyTemplate(stored, "x", "x", "x", "x", "כל יום x בשעה x");
}

function courseCtaBodyToStore(
  typed: string,
  priceText: string,
  sessionsText: string,
  startDate: string,
  endDate: string,
  schedulePhrase: string
): string {
  let s = typed;
  s = migrateCtaBodyDisplayPlaceholders(s).replace(/\{priceText\}/g, "{price}");
  s = s.replace(/כ-?x\s+מפגשים/gu, "כ-{sessions} מפגשים").replace(/x\s+מפגשים/gu, "{sessions} מפגשים");
  s = s.replace(/כל יום x בשעה x/gu, "{schedule_phrase}");
  s = s.replace(/x\s+עד\s+x/gu, "{start_date} עד {end_date}");
  const p = priceText.trim();
  const sess = sessionsText.trim();
  const a = startDate.trim();
  const b = endDate.trim();
  const sched = schedulePhrase.trim();
  if (p && s.includes(p)) s = s.split(p).join("{price}");
  if (sess && s.includes(sess)) s = s.split(sess).join("{sessions}");
  if (sched && s.includes(sched)) s = s.split(sched).join("{schedule_phrase}");
  if (a && s.includes(a)) s = s.split(a).join("{start_date}");
  if (b && s.includes(b)) s = s.split(b).join("{end_date}");
  return s;
}

/** שם תצוגה מ־slug כשאין שם שמור בדאטהבייס */
function displayNameFromSlug(s: string) {
  const parts = s.trim().split("-").filter(Boolean);
  if (parts.length === 0) return "";
  return parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function normalizeTraitsState(arr: string[]): string[] {
  const t = arr.map((s) => String(s ?? ""));
  if (t.length === 0) return ["", "", ""];
  if (t.length < 3) return [...t, ...Array(3 - t.length).fill("")];
  return t;
}

import { AboutBusinessStepPanel } from "./steps/AboutBusinessStepPanel";
import { FollowupStepPanel } from "./steps/FollowupStepPanel";
import { LinksStepPanel } from "./steps/LinksStepPanel";
import { normalizeCrmType, type CrmType } from "@/lib/crm/types";

const Step3Trial = dynamic(() => import("./steps/Step3Trial"), {
  ssr: false,
  loading: () => (
    <StepPanel className="space-y-4">
      <StepHeader n={3} title="מוצרים" desc="טוען…" />
      <div className="rounded-xl border border-zinc-200/80 bg-white p-6 text-center text-sm text-zinc-500">
        <Loader2 className="h-5 w-5 animate-spin mx-auto mb-3 text-[#7133da]" aria-hidden />
        טוען את הטאב…
      </div>
    </StepPanel>
  ),
});

const Step4SalesFlow = dynamic(() => import("./steps/Step4SalesFlow"), {
  ssr: false,
  loading: () => (
    <StepPanel className="space-y-4">
      <StepHeader n={4} title="מסלול מכירה" desc="טוען…" />
      <div className="rounded-xl border border-zinc-200/80 bg-white p-6 text-center text-sm text-zinc-500">
        <Loader2 className="h-5 w-5 animate-spin mx-auto mb-3 text-[#7133da]" aria-hidden />
        טוען את הטאב…
      </div>
    </StepPanel>
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

function formatConcurrentEditorNames(names: string[]): string {
  const cleaned = names.map((n) => n.trim()).filter(Boolean);
  if (!cleaned.length) return "משתמש אחר";
  if (cleaned.length === 1) return cleaned[0]!;
  if (cleaned.length === 2) return `${cleaned[0]} ו${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(", ")} ו${cleaned[cleaned.length - 1]}`;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SlugSettingsPage({
  settingsPresenceLocked = false,
  settingsPresenceEditorName = "",
  settingsPresenceConcurrentNames = [],
}: {
  settingsPresenceLocked?: boolean;
  settingsPresenceEditorName?: string;
  settingsPresenceConcurrentNames?: string[];
} = {}) {
  const { slug } = useParams() as { slug: string };
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [step, setStep]     = useState(1);
  /** טאב «על העסק»: נשאיר במאונט לאחר הביקור הראשון כדי שלא תאופס הנראות של מצב WhatsApp במעבר בין שלבים */
  const keepAboutBusinessStepMountedRef = useRef(false);
  const aboutStepSlugRef = useRef(slug);
  if (aboutStepSlugRef.current !== slug) {
    aboutStepSlugRef.current = slug;
    keepAboutBusinessStepMountedRef.current = false;
  }
  if (step === 2) keepAboutBusinessStepMountedRef.current = true;
  const [plan, setPlan] = useState<"basic" | "premium">("basic");
  /** נכון רק אחרי GET מוצלח לעסק שתואם ל־slug — מונע אוטו־שמירה שדורסת נתונים */
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [settingsLoadError, setSettingsLoadError] = useState("");
  const [saving, setSaving]   = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [fetchingUrl, setFetchingUrl]         = useState(false);
  const [fetchSiteError, setFetchSiteError]   = useState("");
  const [fetchSiteNotice, setFetchSiteNotice] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [busyError, setBusyError] = useState("");
  // Sales-flow regeneration is now per-section only (no global reset).
  const [businessNameEditing, setBusinessNameEditing] = useState(false);
  const [canAutosave, setCanAutosave] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [autoSaveErr, setAutoSaveErr] = useState("");

  /** מונע שחזור גלילה של הדפדפן שמתנגש עם ההאדר (קפיצות בטאבים / מכירה) */
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const prev = history.scrollRestoration;
    history.scrollRestoration = "manual";
    return () => {
      history.scrollRestoration = prev;
    };
  }, []);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [step]);

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
  const [crmType, setCrmType] = useState<CrmType>("");
  const [crmApiKey, setCrmApiKey] = useState("");
  const [schedulePublicUrl, setSchedulePublicUrl] = useState("");
  const [scheduleDirectRegistration, setScheduleDirectRegistration] = useState(true);
  const [warmupSessionEnabled, setWarmupSessionEnabled] = useState(true);
  const [membershipsUrl, setMembershipsUrl] = useState("");
  const [facebookPixelId, setFacebookPixelId] = useState("");
  const [conversionsApiToken, setConversionsApiToken] = useState("");
  const [scheduleScanImageUrl, setScheduleScanImageUrl] = useState("");

  // ── Step 2: Opening media
  const [openingMediaUrl, setOpeningMediaUrl]   = useState("");
  const [openingMediaType, setOpeningMediaType] = useState<"image" | "video" | "">("");
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaUploadError, setMediaUploadError] = useState("");
  const directionsMediaInputRef = useRef<HTMLInputElement>(null);
  const [uploadingDirectionsMedia, setUploadingDirectionsMedia] = useState(false);
  const [directionsMediaUploadError, setDirectionsMediaUploadError] = useState("");
  const scheduleCtaMediaInputRef = useRef<HTMLInputElement>(null);
  const [uploadingScheduleCtaMedia, setUploadingScheduleCtaMedia] = useState(false);
  const [scheduleCtaMediaUploadError, setScheduleCtaMediaUploadError] = useState("");
  const scheduleScanMediaInputRef = useRef<HTMLInputElement>(null);
  const [uploadingScheduleScanMedia, setUploadingScheduleScanMedia] = useState(false);
  const [scheduleScanMediaUploadError, setScheduleScanMediaUploadError] = useState("");
  const [showDirectionsMediaModal, setShowDirectionsMediaModal] = useState(false);
  const [showStarterMediaProModal, setShowStarterMediaProModal] = useState(false);
  const [uploadingTrialPickUiId, setUploadingTrialPickUiId] = useState<string | null>(null);
  const [trialPickMediaUploadError, setTrialPickMediaUploadError] = useState("");
  /** אחרי כשל העלאה — לא מציגים תצוגה מקדימה למדיה שמורה עבור אותו אימון */
  const [trialPickFailedUiId, setTrialPickFailedUiId] = useState<string | null>(null);

  // ── מסלול מכירה: פתיחה + כפתורים
  const [, setWelcomeIntro] = useState("");
  const [, setWelcomeQuestion] = useState("");
  const [, setWelcomeOptions] = useState<string[]>(["", "", ""]);
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
  const servicesRef = useRef<ServiceItem[]>(services);
  servicesRef.current = services;
  const [servicesHydrated, setServicesHydrated] = useState(false);
  const dragIdx = useRef<number | null>(null);
  /** true = יש פתיחה שמורה בשרת או שכבר מילאנו טמפלייט — לא לדרוס אוטומטית */
  const welcomeOpeningLockedRef = useRef(false);
  const servicesSignatureRef = useRef("");
  const lastTrialPromoAppliedRef = useRef("");

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

  /** דוגמה לתבניות שמכילות פרטי אימון ניסיון — שירות ראשון מסוג trial */
  const firstTrialForTemplates = useMemo(() => {
    const row = services.find((s) => s.name.trim() && s.offer_kind === "trial");
    if (!row) return { name: "", priceText: "", durationText: "" };
    return {
      name: row.name.trim(),
      priceText: row.price_text.trim(),
      durationText: row.duration.trim(),
    };
  }, [services]);

  const workshopCtaSample = useMemo(() => {
    const row = services.find((s) => s.name.trim() && s.offer_kind === "workshop");
    if (!row) return { priceText: "", durationText: "" };
    return { priceText: row.price_text.trim(), durationText: row.duration.trim() };
  }, [services]);

  const courseCtaSample = useMemo(() => {
    const row = services.find((s) => s.name.trim() && s.offer_kind === "course");
    if (!row) {
      return { priceText: "", sessionsText: "", startDate: "", endDate: "", schedulePhrase: "" };
    }
    const fromCycles = syncCourseLegacyDatesFromCycles(row.course_cycles ?? []);
    return {
      priceText: row.price_text.trim(),
      sessionsText: row.course_sessions_count.trim(),
      startDate: fromCycles.course_start_date || row.course_start_date.trim(),
      endDate: fromCycles.course_end_date || row.course_end_date.trim(),
      schedulePhrase: buildCourseSchedulePhraseForCta(row.course_cycles ?? []),
    };
  }, [services]);

  const hasWorkshopOffers = services.some((s) => s.name.trim() && s.offer_kind === "workshop");
  const hasCourseOffers = services.some((s) => s.name.trim() && s.offer_kind === "course");
  const hasTrialOffers = services.some((s) => s.name.trim() && s.offer_kind === "trial");

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

  useEffect(() => {
    if (!settingsHydrated || !hasTrialOffers) return;
    const promo = promotions.trim();
    if (!promo) {
      lastTrialPromoAppliedRef.current = "";
      return;
    }
    const promoKey = `${slug}\0${promo}`;
    if (lastTrialPromoAppliedRef.current === promoKey) return;

    setSalesFlowConfig((current) => {
      const nextCtaBody = appendTrialPromotionToCtaBody(current.cta_body, promo);
      if (nextCtaBody === current.cta_body) return current;
      return { ...current, cta_body: nextCtaBody };
    });
    lastTrialPromoAppliedRef.current = promoKey;
  }, [settingsHydrated, hasTrialOffers, promotions, slug]);

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
        benefit_line: benefitLineFromProductDescription(s.description),
        service_slug: s.service_slug,
        offer_kind: s.offer_kind,
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
  } = useSWR(settingsKey, dashboardSettingsFetcher, {
    /** ריענון בפוקוס דרס מוצרים עם ui_id חדש וסגר כרטיסים באמצע עריכה */
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 5000,
    keepPreviousData: true,
    shouldRetryOnError: false,
  });
  const { mutate: revalidateDashboardSettings } = useSWRConfig();

  /** טעינת מסך מלאה רק לפני התשובה הראשונה — לא בריענון ברקע (מונע קפיצות גלילה וסקלטון) */
  const blockingSettingsLoad = Boolean(settingsKey && !swrSettings && !swrSettingsError);

  const swrHydrationSlugRef = useRef(slug);
  const swrLastAppliedPayloadJsonRef = useRef<string | null>(null);
  /** מפתח מתעדכן אחרי משיכת טמפ ארעי מתוך sessionStorage בעת תשובת שרת ריקה (קריאה חוזית אחת) */
  const trialServicesStashConsumedRef = useRef(false);
  /** עריכות מוצרים מקומיות מאז טעינה אחרונה מהשרת — מונע דריסה בריענון SWR */
  const servicesUserEditCountRef = useRef(0);
  const servicesHydrationBaselineRef = useRef(0);

  const setServicesFromUser = useCallback<typeof setServices>((action) => {
    servicesUserEditCountRef.current += 1;
    setServices(action);
  }, []);

  useEffect(() => {
    setSettingsLoadError("");
    if (swrSettingsError) {
      setSettingsLoadError("לא ניתן לטעון את נתוני מסלול המכירה.");
      setSettingsHydrated(false);
      setServicesHydrated(false);
      return;
    }
    if (!swrSettings) {
      setSettingsHydrated(false);
      setServicesHydrated(false);
      return;
    }

    if (swrHydrationSlugRef.current !== slug) {
      swrHydrationSlugRef.current = slug;
      swrLastAppliedPayloadJsonRef.current = null;
      trialServicesStashConsumedRef.current = false;
      servicesUserEditCountRef.current = 0;
      servicesHydrationBaselineRef.current = 0;
    }

    let serialized = "";
    try {
      serialized = JSON.stringify(swrSettings);
    } catch {
      serialized = "";
    }
    if (
      serialized &&
      serialized === swrLastAppliedPayloadJsonRef.current &&
      settingsHydrated &&
      servicesHydrated
    ) {
      return;
    }
    const business = swrSettings.business;
    const svcs = swrSettings.services;
        if (!business) {
          setSettingsLoadError("לא נמצא עסק עבור כתובת זו. בדקו את הכתובת או התחברו מחדש.");
          return;
        }
        if (String(business.slug ?? "").toLowerCase() !== slug.toLowerCase()) {
          setSettingsLoadError("אי-התאמה בין העסק לכתובת. רעננו את הדף.");
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
        setSchedulePublicUrl(
          typeof sl.schedule_public_url === "string"
            ? sl.schedule_public_url.trim()
            : typeof sl.arbox_schedule_url === "string"
              ? sl.arbox_schedule_url.trim()
              : ""
        );
        setScheduleScanImageUrl(typeof sl.schedule_scan_image_url === "string" ? sl.schedule_scan_image_url.trim() : "");
        setScheduleDirectRegistration((business as { schedule_direct_registration?: boolean }).schedule_direct_registration !== false);
        setWarmupSessionEnabled((business as { warmup_session_enabled?: boolean }).warmup_session_enabled !== false);
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
                  : {
                      id: String((r as Partial<QuickReply>).id ?? uid()),
                      label: String((r as Partial<QuickReply>).label ?? ""),
                      reply: String((r as Partial<QuickReply>).reply ?? ""),
                    }
              )
            : [];
        // Load quick replies as-is (including "מה הכתובת שלכם?" if exists)
        setQuickReplies(loadedQr);
        setArboxLink(String(sl.arbox_link ?? ""));
        setCrmType(normalizeCrmType((business as { crm_type?: unknown }).crm_type));
        setCrmApiKey(String((business as { crm_api_key?: unknown }).crm_api_key ?? ""));
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
          const rowsRaw = svcs as Record<string, unknown>[];
          const incomingHasNamed = rowsRaw.some((s) => String(s.name ?? "").trim());
          const localHasNamed = servicesRef.current.some((s) => s.name.trim());
          if (!incomingHasNamed && localHasNamed) {
            setServicesHydrated(true);
          } else if (incomingHasNamed || rowsRaw.length > 0) {
            const userEditedSinceHydrate =
              servicesUserEditCountRef.current > servicesHydrationBaselineRef.current;
            const mapped = userEditedSinceHydrate
              ? mergeServerServicesIntoLocal(rowsRaw, servicesRef.current)
              : mergeServerServicesIntoLocal(rowsRaw, []);
            if (!userEditedSinceHydrate) {
              setServices(mapped);
              servicesHydrationBaselineRef.current = servicesUserEditCountRef.current;
            }
            setServicesHydrated(true);
            if (incomingHasNamed) writeTrialServicesStash(slug, servicesRef.current);
          } else if (!trialServicesStashConsumedRef.current) {
            const restored = readTrialServicesStash(slug);
            if (restored?.length) {
              trialServicesStashConsumedRef.current = true;
              setServices(restored);
              setServicesHydrated(true);
              if (settingsKey) void revalidateDashboardSettings(settingsKey);
            } else {
              setServices([]);
              setServicesHydrated(true);
            }
          } else {
            setServices([]);
            setServicesHydrated(true);
          }
        } else if (servicesRef.current.some((s) => s.name.trim())) {
          setServicesHydrated(true);
        } else if (!trialServicesStashConsumedRef.current) {
          const restored = readTrialServicesStash(slug);
          if (restored?.length) {
            trialServicesStashConsumedRef.current = true;
            setServices(restored);
            setServicesHydrated(true);
            if (settingsKey) void revalidateDashboardSettings(settingsKey);
          } else {
            setServices([]);
            setServicesHydrated(true);
          }
        } else {
          setServices([]);
          setServicesHydrated(true);
        }
        setSettingsHydrated(true);
        if (serialized) swrLastAppliedPayloadJsonRef.current = serialized;
  }, [slug, swrSettings, swrSettingsError, settingsHydrated, servicesHydrated, settingsKey, revalidateDashboardSettings]);

  useEffect(() => {
    if (blockingSettingsLoad || !settingsHydrated) {
      setCanAutosave(false);
      return;
    }
    const t = window.setTimeout(() => setCanAutosave(true), AUTOSAVE_ENABLE_DELAY_MS);
    return () => clearTimeout(t);
  }, [blockingSettingsLoad, settingsHydrated]);

  // ─── Save payload (ידני + אוטומטי) ─────────────────────────────────────────

  const getSavePayload = useCallback(() => {
    const wf = syncWelcomeFromSalesFlow(
      salesFlowConfig,
      services.filter((s) => s.name.trim()).map((s) => ({
        name: s.name,
        benefit_line: benefitLineFromProductDescription(s.description),
        service_slug: s.service_slug,
        offer_kind: s.offer_kind,
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
        schedule_direct_registration: scheduleDirectRegistration,
        warmup_session_enabled: warmupSessionEnabled,
        crm_type: crmType,
        crm_api_key: crmApiKey.trim(),
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
          schedule_public_url: schedulePublicUrl.trim(),
          schedule_scan_image_url: scheduleScanImageUrl.trim(),
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
            description: JSON.stringify(serviceDescriptionMetaForSave(s)),
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
      promotions,
      segQuestions,
      quickReplies,
      arboxLink,
      crmType,
      crmApiKey,
      scheduleDirectRegistration,
      warmupSessionEnabled,
      objections,
      waSalesFollowup1,
      waSalesFollowup2,
      waSalesFollowup3,
      membershipsUrl,
      scheduleScanImageUrl,
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
    if (!canAutosave || settingsPresenceLocked) return;
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
  }, [canAutosave, settingsPresenceLocked]);

  useEffect(() => {
    if (!canAutosave || settingsPresenceLocked) return;
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
            const body = getSavePayloadRef.current() as Record<string, unknown>;
            if (payloadSavedTrialsWereCleared(body)) clearTrialServicesStash(slug);
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
  }, [canAutosave, postSettings, settingsPresenceLocked, slug, services]);

  useEffect(() => {
    if (!settingsPresenceLocked) return;
    setAutosaveStatus("idle");
    setAutoSaveErr("");
  }, [settingsPresenceLocked]);

  const saveAll = useCallback(async () => {
    if (settingsPresenceLocked) {
      setSaveErr("משתמש אחר עורך כרגע את ההגדרות. נסה שוב בעוד מעט.");
      return false;
    }
    setSaving(true);
    setSaveErr("");
    setAutoSaveErr("");
    try {
      const res = await postSettings();
      if (!res.ok) {
        setSaveErr(await readSaveErrorFromResponse(res));
        return false;
      }
      const body = getSavePayloadRef.current() as Record<string, unknown>;
      if (payloadSavedTrialsWereCleared(body)) clearTrialServicesStash(slug);
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
  }, [postSettings, settingsPresenceLocked, slug]);

  const applyWaSalesFollowupDefaults = useCallback(() => {
    setWaSalesFollowup1(WA_SALES_FOLLOWUP_1_DEFAULT);
    setWaSalesFollowup2(WA_SALES_FOLLOWUP_2_DEFAULT);
    setWaSalesFollowup3(WA_SALES_FOLLOWUP_3_DEFAULT);
  }, []);

  const runBusy = useCallback((key: string, fn: () => void | Promise<void>) => {
    const startedAt = Date.now();
    setBusyAction(key);
    setBusyError("");
    Promise.resolve()
      .then(fn)
      .catch((err: unknown) => {
        const e = err as { name?: string; message?: string; code?: string };
        const name = String(e?.name ?? "").trim();
        const msg = String(e?.message ?? "").trim();
        const code = String(e?.code ?? "").trim();
        const kind = code || name || "unknown_error";
        const detail = msg || String(err ?? "").trim() || "לא ידוע";
        setBusyError(`שגיאה בג׳ינרוט (${kind}): ${detail}`);
      })
      .finally(() => {
        const elapsed = Date.now() - startedAt;
        const minMs = 650;
        const wait = Math.max(0, minMs - elapsed);
        window.setTimeout(() => setBusyAction((cur) => (cur === key ? null : cur)), wait);
      });
  }, []);

  const buildBenefitLineFromService = useCallback((service: ServiceItem) => {
    return {
      ...service,
      benefit_line: benefitLineFromProductDescription(service.description),
    };
  }, []);

  /** מסנכרן תשובות בטאב מכירה מתיאור המוצר */
  const regenerateServiceBenefitLinesFromDescriptions = useCallback(() => {
    setServices((prev) =>
      prev.map((service) => {
        if (!service.name.trim()) return service;
        return buildBenefitLineFromService(service);
      })
    );
  }, [buildBenefitLineFromService]);

  const regenerateSalesFlowSection = useCallback(
    (
      section:
        | "opening"
        | "service_pick"
        | "warmup"
        | "cta"
        | "after_trial_registration",
      warmupOfferKind: OfferKind = "trial"
    ) => {
      const base = defaultSalesFlowConfig(vibe);
      if (section === "service_pick") {
        regenerateServiceBenefitLinesFromDescriptions();
      }
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
            ...patchWarmupRegenerationForOfferKind(c, base, warmupOfferKind, uid),
          };
        }
        if (section === "cta") {
          const kind = warmupOfferKind ?? "trial";
          if (kind === "workshop") {
            return {
              ...c,
              cta_workshop_body: base.cta_workshop_body,
              cta_workshop_buttons: structuredClone(base.cta_workshop_buttons),
            };
          }
          if (kind === "course") {
            return {
              ...c,
              cta_course_body: base.cta_course_body,
              cta_course_buttons: structuredClone(base.cta_course_buttons),
            };
          }
          const prevMembershipsBtn = c.cta_buttons.find((b) => b.kind === "memberships");
          return {
            ...c,
            cta_body: base.cta_body,
            cta_body_after_schedule: base.cta_body_after_schedule,
            cta_buttons: structuredClone(base.cta_buttons).map((btn) => {
              if (btn.kind !== "memberships" || !prevMembershipsBtn) return btn;
              return {
                ...btn,
                label: prevMembershipsBtn.label?.trim() || btn.label,
                memberships_cta_delivery:
                  prevMembershipsBtn.memberships_cta_delivery ?? btn.memberships_cta_delivery,
                memberships_price_range_min: prevMembershipsBtn.memberships_price_range_min ?? "",
                memberships_price_range_max: prevMembershipsBtn.memberships_price_range_max ?? "",
              };
            }),
            followup_after_next_class_body: base.followup_after_next_class_body,
            followup_after_next_class_options: structuredClone(base.followup_after_next_class_options),
            free_chat_invite_reply: base.free_chat_invite_reply,
          };
        }
        if (section === "after_trial_registration") {
          const kind = warmupOfferKind ?? "trial";
          if (kind === "workshop") {
            return {
              ...c,
              after_workshop_registration_body: base.after_workshop_registration_body,
              after_workshop_registration_body_after_schedule:
                base.after_workshop_registration_body_after_schedule,
            };
          }
          if (kind === "course") {
            return {
              ...c,
              after_course_registration_body: base.after_course_registration_body,
              after_course_registration_body_after_schedule:
                base.after_course_registration_body_after_schedule,
            };
          }
          return {
            ...c,
            after_trial_registration_body: base.after_trial_registration_body,
            after_trial_registration_body_after_schedule:
              base.after_trial_registration_body_after_schedule,
          };
        }
        return c;
      });
    },
    [regenerateServiceBenefitLinesFromDescriptions, vibe]
  );

  const regenerateSalesFlowSectionBusy = useCallback(
    (
      section:
        | "opening"
        | "service_pick"
        | "warmup"
        | "cta"
        | "after_trial_registration",
      warmupOfferKind?: OfferKind
    ) => {
      const busyKey =
        section === "warmup" && warmupOfferKind
          ? `sales:warmup:${warmupOfferKind}`
          : section === "cta" && warmupOfferKind
            ? `sales:cta:${warmupOfferKind}`
            : section === "after_trial_registration" && warmupOfferKind
              ? `sales:after_registration:${warmupOfferKind}`
              : `sales:${section}`;
      runBusy(busyKey, () => regenerateSalesFlowSection(section, warmupOfferKind ?? "trial"));
    },
    [regenerateSalesFlowSection, runBusy]
  );

  // ─── Media upload ──────────────────────────────────────────────────────────

  async function uploadMedia(file: File, target: "opening" | "directions" | "schedule_cta" | "schedule_scan") {
    if (target === "schedule_cta") {
      setScheduleCtaMediaUploadError("");
      if (file.type === "image/webp" || /\.webp$/i.test(file.name)) {
        setScheduleCtaMediaUploadError("קובץ WebP לא נתמך ב-WhatsApp. אנא העלו JPG או PNG.");
        return;
      }
      if (!file.type.startsWith("image")) {
        setScheduleCtaMediaUploadError("למערכת שעות יש להעלות תמונה בלבד (JPG/PNG).");
        return;
      }
      setUploadingScheduleCtaMedia(true);
      try {
        const prepared = await prepareDashboardMediaUpload(file);
        if (!prepared.ok) {
          setScheduleCtaMediaUploadError(prepared.error);
          return;
        }
        const uploadFile = prepared.file;
        const signRes = await fetch("/api/dashboard/upload-media-signed-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: uploadFile.name,
            contentType: uploadFile.type || "application/octet-stream",
            fileSize: uploadFile.size,
          }),
        });
        let signJson: { signedUrl?: string; publicUrl?: string; error?: string } = {};
        try {
          signJson = (await signRes.json()) as typeof signJson;
        } catch {
          setScheduleCtaMediaUploadError("תשובת שרת לא תקינה.");
          return;
        }
        if (!signRes.ok) {
          setScheduleCtaMediaUploadError(signJson.error?.trim() || `הכנת העלאה נכשלה (${signRes.status}).`);
          return;
        }
        const signedUrl = signJson.signedUrl?.trim();
        const publicUrl = signJson.publicUrl?.trim();
        if (!signedUrl || !publicUrl) {
          setScheduleCtaMediaUploadError("לא התקבל קישור חתום להעלאה - נסו שוב.");
          return;
        }
        const putRes = await fetch(signedUrl, {
          method: "PUT",
          headers: {
            "x-upsert": "true",
            "Content-Type": uploadFile.type || "application/octet-stream",
          },
          body: uploadFile,
        });
        if (!putRes.ok) {
          setScheduleCtaMediaUploadError(`העלאה ל-Storage נכשלה (${putRes.status}).`);
          return;
        }
        setSalesFlowConfig((c) => ({
          ...c,
          cta_buttons: c.cta_buttons.map((btn) =>
            btn.kind === "schedule"
              ? {
                  ...btn,
                  schedule_cta_delivery: "image",
                  schedule_cta_image_url: publicUrl,
                  schedule_cta_image_type: "image",
                }
              : btn
          ),
        }));
      } catch {
        setScheduleCtaMediaUploadError("בעיית רשת בהעלאה.");
      } finally {
        setUploadingScheduleCtaMedia(false);
      }
      return;
    }
    if (target === "schedule_scan") {
      setScheduleScanMediaUploadError("");
      if (file.type === "image/webp" || /\.webp$/i.test(file.name)) {
        setScheduleScanMediaUploadError("קובץ WebP לא נתמך. אנא העלו JPG או PNG.");
        return;
      }
      if (!file.type.startsWith("image")) {
        setScheduleScanMediaUploadError("יש להעלות תמונה בלבד (JPG/PNG).");
        return;
      }
      setUploadingScheduleScanMedia(true);
      try {
        const prepared = await prepareDashboardMediaUpload(file);
        if (!prepared.ok) {
          setScheduleScanMediaUploadError(prepared.error);
          return;
        }
        const uploadFile = prepared.file;
        const signRes = await fetch("/api/dashboard/upload-media-signed-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: uploadFile.name,
            contentType: uploadFile.type || "application/octet-stream",
            fileSize: uploadFile.size,
          }),
        });
        let signJson: { signedUrl?: string; publicUrl?: string; error?: string } = {};
        try {
          signJson = (await signRes.json()) as typeof signJson;
        } catch {
          setScheduleScanMediaUploadError("תשובת שרת לא תקינה.");
          return;
        }
        if (!signRes.ok) {
          setScheduleScanMediaUploadError(signJson.error?.trim() || `הכנת העלאה נכשלה (${signRes.status}).`);
          return;
        }
        const signedUrl = signJson.signedUrl?.trim();
        const publicUrl = signJson.publicUrl?.trim();
        if (!signedUrl || !publicUrl) {
          setScheduleScanMediaUploadError("לא התקבל קישור חתום להעלאה - נסו שוב.");
          return;
        }
        const putRes = await fetch(signedUrl, {
          method: "PUT",
          headers: {
            "x-upsert": "true",
            "Content-Type": uploadFile.type || "application/octet-stream",
          },
          body: uploadFile,
        });
        if (!putRes.ok) {
          setScheduleScanMediaUploadError(`העלאה ל-Storage נכשלה (${putRes.status}).`);
          return;
        }
        setScheduleScanImageUrl(publicUrl);
      } catch {
        setScheduleScanMediaUploadError("בעיית רשת בהעלאה.");
      } finally {
        setUploadingScheduleScanMedia(false);
      }
      return;
    }

    const setError = target === "opening" ? setMediaUploadError : setDirectionsMediaUploadError;
    const setUploading = target === "opening" ? setUploadingMedia : setUploadingDirectionsMedia;
    const setUrl = target === "opening" ? setOpeningMediaUrl : setDirectionsMediaUrl;
    const setType = target === "opening" ? setOpeningMediaType : setDirectionsMediaType;
    setError("");
    if (file.type === "image/webp" || /\.webp$/i.test(file.name)) {
      setError("קובץ WebP לא נתמך ב-WhatsApp. אנא העלו JPG או PNG.");
      return;
    }
    setUploading(true);
    try {
      const prepared = await prepareDashboardMediaUpload(file);
      if (!prepared.ok) {
        setError(prepared.error);
        return;
      }
      const uploadFile = prepared.file;
      const signRes = await fetch("/api/dashboard/upload-media-signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: uploadFile.name,
          contentType: uploadFile.type || "application/octet-stream",
          fileSize: uploadFile.size,
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
          "Content-Type": uploadFile.type || "application/octet-stream",
        },
        body: uploadFile,
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
      setType(uploadFile.type.startsWith("video") ? "video" : "image");
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
    setUploadingTrialPickUiId(serviceUiId);
    try {
      const prepared = await prepareDashboardMediaUpload(file);
      if (!prepared.ok) {
        setTrialPickMediaUploadError(prepared.error);
        setTrialPickFailedUiId(serviceUiId);
        return;
      }
      const uploadFile = prepared.file;
      const signRes = await fetch("/api/dashboard/upload-media-signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: uploadFile.name,
          contentType: uploadFile.type || "application/octet-stream",
          fileSize: uploadFile.size,
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
          "Content-Type": uploadFile.type || "application/octet-stream",
        },
        body: uploadFile,
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
      const mt: "image" | "video" = uploadFile.type.startsWith("video") ? "video" : "image";
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
        setServicesFromUser((prev) =>
          mergeTrialServicesWithScannedProducts(prev, j.products as unknown[], addrFallback)
        );
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
    setServicesFromUser(arr);
  }
  function onDragEnd() { dragIdx.current = null; }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (blockingSettingsLoad) {
    return (
      <div className="min-h-[50vh]" dir="rtl">
        <div className={DASHBOARD_SETTINGS_SHELL}>
        <div className="space-y-6 py-10 animate-pulse">
          <div className="space-y-4">
            <div className="h-6 w-48 rounded bg-zinc-200 ms-auto" />
            <div className="h-10 w-full rounded-xl bg-zinc-100" />
            <div className="h-10 w-full rounded-xl bg-zinc-100" />
            <div className="h-24 w-full rounded-xl bg-zinc-100" />
          </div>
          <div className="flex items-center justify-between border-t border-zinc-200 pt-5">
            <div className="h-10 w-24 rounded-xl bg-zinc-200" />
            <div className="h-4 w-16 rounded bg-zinc-200" />
            <div className="h-10 w-28 rounded-xl bg-zinc-200" />
          </div>
        </div>
        </div>
      </div>
    );
  }

  const isFirst = step === 1;
  const isLast  = step === STEPS.length;
  const effectiveCanAutosave = canAutosave && !settingsPresenceLocked;
  const concurrentEditorsLabel = formatConcurrentEditorNames(settingsPresenceConcurrentNames);

  function nextStep() {
    setStep((s) => Math.min(STEPS.length, s + 1));
  }

  function prevStep() {
    setStep((s) => Math.max(1, s - 1));
  }

  return (
    <div className="min-h-[50vh]" dir="rtl">
      <div className={DASHBOARD_SETTINGS_SHELL}>
        {settingsPresenceLocked ? (
          <div
            className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-right text-sm font-medium text-amber-800"
            role="status"
          >
            משתמש אחר עורך כרגע את ההגדרות. נסה שוב בעוד מעט.
            {settingsPresenceEditorName ? (
              <span className="block pt-1 text-xs font-normal text-amber-700">
                עורך כרגע: {settingsPresenceEditorName}
              </span>
            ) : null}
          </div>
        ) : settingsPresenceConcurrentNames.length > 0 ? (
          <div
            className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-right text-sm font-medium text-amber-800"
            role="status"
          >
            {concurrentEditorsLabel} עורכ/ים גם כרגע את ההגדרות. שימו לב — שינויים עלולים להידרס.
          </div>
        ) : null}

        <div
          className="flex h-5 items-center justify-end gap-1.5 pb-3 text-xs leading-none text-zinc-500"
          aria-live={effectiveCanAutosave ? "polite" : "off"}
        >
          {effectiveCanAutosave ? (
            <>
              {autosaveStatus === "saving" && (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7133da]" aria-hidden />
                  <span>שומר…</span>
                </>
              )}
              {autosaveStatus === "saved" && <span className="text-emerald-600">נשמר אוטומטית</span>}
              {autosaveStatus === "error" && (
                <span
                  className="max-w-[min(20rem,55vw)] text-right text-amber-600"
                  title={autoSaveErr || undefined}
                >
                  שמירה אוטומטית נכשלה{autoSaveErr ? ` - ${autoSaveErr}` : ""}
                </span>
              )}
              {autosaveStatus === "idle" ? <span aria-hidden>&nbsp;</span> : null}
            </>
          ) : (
            <span aria-hidden>&nbsp;</span>
          )}
        </div>

      {settingsLoadError ? (
        <div
          className="mt-4 rounded-xl border border-red-200/70 bg-red-50/90 px-4 py-3 text-center text-sm text-red-800"
          role="alert"
        >
          {settingsLoadError}
        </div>
      ) : null}
      {busyError ? (
        <div
          className="mt-4 rounded-xl border border-red-200/70 bg-red-50/90 px-4 py-3 text-center text-sm text-red-800"
          role="alert"
        >
          {busyError}
        </div>
      ) : null}

      <div
        className={`py-8 sm:py-10 ${DASHBOARD_CENTERED_CONTENT}`}
        style={{ overflowAnchor: "none" }}
      >
        <fieldset
          disabled={settingsPresenceLocked}
          aria-disabled={settingsPresenceLocked}
          className={`m-0 border-0 p-0 ${settingsPresenceLocked ? "pointer-events-none select-text opacity-75" : ""}`}
        >

        {/* ════════════════════ STEP 1 — לינקים ════════════════════ */}
        {step === 1 && (
          <StepPanel className="!text-right [&_input]:!text-right [&_textarea]:!text-right">
            <LinksStepPanel
              websiteUrl={websiteUrl}
              setWebsiteUrl={setWebsiteUrl}
              fetchSite={() => void fetchSite()}
              fetchingUrl={fetchingUrl}
              fetchSiteError={fetchSiteError}
              fetchSiteNotice={fetchSiteNotice}
              arboxLink={arboxLink}
              setArboxLink={setArboxLink}
              scheduleScanImageUrl={scheduleScanImageUrl}
              setScheduleScanImageUrl={setScheduleScanImageUrl}
              scheduleScanMediaInputRef={scheduleScanMediaInputRef}
              uploadingScheduleScanMedia={uploadingScheduleScanMedia}
              scheduleScanMediaUploadError={scheduleScanMediaUploadError}
              uploadMedia={uploadMedia}
              scheduleDirectRegistration={scheduleDirectRegistration}
              setScheduleDirectRegistration={setScheduleDirectRegistration}
              membershipsUrl={membershipsUrl}
              setMembershipsUrl={setMembershipsUrl}
              instagramUrl={instagramUrl}
              setInstagramUrl={setInstagramUrl}
              instagramIcon={<InstagramGlyph className="h-5 w-5" />}
              crmType={crmType}
              setCrmType={setCrmType}
              crmApiKey={crmApiKey}
              setCrmApiKey={setCrmApiKey}
            />
          </StepPanel>
        )}

        {/* ════════════════════ STEP 2 — על העסק ════════════════════ */}
        {keepAboutBusinessStepMountedRef.current ? (
          <div className={step !== 2 ? "hidden" : undefined} aria-hidden={step !== 2}>
            <StepPanel className="!text-right [&_input]:!text-right [&_textarea]:!text-right">
              <AboutBusinessStepPanel
                whatsAppSlot={<WhatsAppNumberSection slug={slug} compact />}
                customerServicePhone={customerServicePhone}
                setCustomerServicePhone={setCustomerServicePhone}
                name={name}
                setName={setName}
                businessNameEditing={businessNameEditing}
                setBusinessNameEditing={setBusinessNameEditing}
                botName={botName}
                setBotName={setBotName}
                businessTagline={businessTagline}
                setBusinessTagline={setBusinessTagline}
                address={address}
                setAddress={setAddress}
                directions={directions}
                setDirections={setDirections}
                planIsStarter={plan === "basic"}
                onStarterMediaBlocked={() => setShowStarterMediaProModal(true)}
                onDirectionsMediaClick={() => setShowDirectionsMediaModal(true)}
                promotions={promotions}
                setPromotions={setPromotions}
                traits={traits}
                setTraits={setTraits}
                factQuestions={factQuestions}
                factAnswers={factAnswers}
                setFactAnswers={setFactAnswers}
                factQuestionIdx={factQuestionIdx}
                setFactQuestionIdx={setFactQuestionIdx}
                addFactLine={addFactLine}
              />
            </StepPanel>
          </div>
        ) : null}

        {/* ════════════════════ STEP 3 — מוצרים ════════════════════ */}
        {step === 3 && (
          <Step3Trial
            websiteUrl={websiteUrl}
            address={address}
            fetchingUrl={fetchingUrl}
            services={services}
            setServices={setServicesFromUser}
            fetchSite={fetchSite}
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
            busyAction={busyAction}
            runBusy={runBusy}
            scheduleDirectRegistration={scheduleDirectRegistration}
            scheduleUrl={(scheduleScanImageUrl.trim() || arboxLink).trim()}
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
            scheduleCtaMediaInputRef={scheduleCtaMediaInputRef}
            uploadingScheduleCtaMedia={uploadingScheduleCtaMedia}
            scheduleCtaMediaUploadError={scheduleCtaMediaUploadError}
            setScheduleCtaMediaUploadError={setScheduleCtaMediaUploadError}
            uploadMedia={uploadMedia}
            setOpeningMediaUrl={setOpeningMediaUrl}
            setOpeningMediaType={setOpeningMediaType}
            setMediaUploadError={setMediaUploadError}
            mediaUploadError={mediaUploadError}
            regenerateSalesFlowSection={regenerateSalesFlowSectionBusy}
            regeneratingKey={busyAction}
            salesFlowConfig={salesFlowConfig}
            setSalesFlowConfig={setSalesFlowConfig}
            scheduleDirectRegistration={scheduleDirectRegistration}
            scheduleScanImageUrl={scheduleScanImageUrl}
            scheduleBoardLink={(schedulePublicUrl.trim() || arboxLink.trim()).trim()}
            warmupSessionEnabled={warmupSessionEnabled}
            setWarmupSessionEnabled={setWarmupSessionEnabled}
            salesOpeningAutoText={salesOpeningAutoText}
            trialServiceNames={trialServiceNames}
            firstNamedService={firstNamedService}
            firstTrialForTemplates={firstTrialForTemplates}
            services={services}
            videoUrlForPreview={videoUrlForPreview}
            experienceQuestionForDisplay={experienceQuestionForDisplay}
            experienceQuestionToStore={experienceQuestionToStore}
            afterExperienceForDisplay={afterExperienceForDisplay}
            afterExperienceToStore={afterExperienceToStore}
            ctaBodyForDisplay={ctaBodyForDisplay}
            ctaBodyToStore={ctaBodyToStore}
            hasTrialOffers={hasTrialOffers}
            hasWorkshopOffers={hasWorkshopOffers}
            hasCourseOffers={hasCourseOffers}
            workshopCtaSample={workshopCtaSample}
            courseCtaSample={courseCtaSample}
            workshopCtaBodyForDisplayUi={workshopCtaBodyForDisplayUi}
            workshopCtaBodyToStore={workshopCtaBodyToStore}
            courseCtaBodyForDisplayUi={courseCtaBodyForDisplayUi}
            courseCtaBodyToStore={courseCtaBodyToStore}
            uid={uid}
          />
        )}

        {/* ════════════════════ STEP 5 — פולואפ ════════════════════ */}
        {step === 5 && (
          <StepPanel className="!text-right [&_input]:!text-right [&_textarea]:!text-right">
            <FollowupStepPanel
              waSalesFollowup1={waSalesFollowup1}
              setWaSalesFollowup1={setWaSalesFollowup1}
              waSalesFollowup2={waSalesFollowup2}
              setWaSalesFollowup2={setWaSalesFollowup2}
              waSalesFollowup3={waSalesFollowup3}
              setWaSalesFollowup3={setWaSalesFollowup3}
              busyAction={busyAction}
              onApplyDefaults={() => runBusy("followup:defaults", applyWaSalesFollowupDefaults)}
            />
          </StepPanel>
        )}
        </fieldset>

        {saveErr ? <p className="mt-4 text-center text-sm text-red-500">{saveErr}</p> : null}

        {/* ── ניווט שלבים ── */}
        <div className="mx-auto mt-8 flex w-full max-w-2xl items-center justify-between border-t border-zinc-200 pt-4">
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
              disabled={saving || !settingsHydrated || settingsPresenceLocked}
              className="gap-2"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {saving ? "שומר..." : "שמור הכל"}
            </Button>
          ) : (
            <Button
              disabled={saving || !settingsHydrated}
              onClick={() => {
                if (settingsPresenceLocked) {
                  nextStep();
                  return;
                }
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
                  href={`/${encodeURIComponent(String(slug ?? "").trim().toLowerCase())}/account/billing`}
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
    </div>
  );
}
