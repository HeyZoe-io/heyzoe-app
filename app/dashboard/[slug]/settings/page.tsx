"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useParams } from "next/navigation";
import {
  ArrowLeft, ArrowRight, Check,
  GripVertical, Link, Loader2, Plus, RotateCcw, Sparkles, Trash2, Upload, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buildWelcomeMessageForStorage, splitWelcomeForChat } from "@/lib/welcome-message";
import { buildDefaultFollowupPack } from "@/lib/default-followups";
import {
  type SalesFlowConfig,
  type SalesFlowCtaButton,
  type SalesFlowExtraStep,
  composeGreeting,
  defaultSalesFlowConfig,
  parseSalesFlowFromSocial,
  serializeSalesFlowConfig,
  syncWelcomeFromSalesFlow,
} from "@/lib/sales-flow";
import { WhatsAppSettingsPreview } from "@/components/settings/WhatsAppSettingsPreview";
import { TRIAL_SERVICE_NAME_MAX_CHARS, truncateTrialServiceName } from "@/lib/trial-service";

// ─── Types ────────────────────────────────────────────────────────────────────

type QuickReply  = { id: string; label: string; reply: string };
type Objection   = { id: string; question: string; answer: string };
type SegQuestion = { id: string; question: string; answers: { id: string; text: string; service_slug: string }[] };
type ServiceItem = {
  ui_id: string; name: string; price_text: string;
  duration: string; payment_link: string;
  service_slug: string; location_text: string; description: string;
  /** תיאור קצר אחרי בחירת האימון בפלואו (משפט אחד) */
  benefit_line: string;
};
type MembershipTierUI = {
  id: string;
  name: string;
  price: string;
  monthlySessions: string;
  notes: string;
  excludedServiceSlugs: string[];
};

type PunchCardUI = {
  id: string;
  sessionCount: string;
  validity: string;
  notes: string;
  excludedServiceSlugs: string[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = [
  "פרטי העסק",
  "אימון ניסיון",
  "כרטיסיות ומנויים",
  "מסלול מכירה",
  "חיבור פייסבוק",
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

const VIBES = ["חברי", "מקצועי", "מצחיק", "רוחני", "יוקרתי", "ישיר", "אמפתי", "סמכותי"];

const AUTOSAVE_DEBOUNCE_MS = 1600;
const AUTOSAVE_ENABLE_DELAY_MS = 500;
/** מדיה לפתיחה: העלאה ישירה ל-Supabase (Signed URL) — לא עוברת בגוף הבקשה ל-Vercel */
const MAX_OPENING_MEDIA_BYTES = 16 * 1024 * 1024;

function videoUrlForPreview(url: string) {
  if (!url) return url;
  const base = url.split("#")[0];
  return `${base}#t=0.001`;
}

function uid() { return Math.random().toString(36).slice(2, 9); }
function toSlug(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-");
}

/** סלאג לשמירה — שמות בעברית בלבד נותנים toSlug ריק והשרת היה מדלג על השירות */
function serviceSlugForPersistence(serviceSlugField: string, name: string, uiId: string): string {
  const fromField = toSlug(serviceSlugField);
  if (fromField) return fromField;
  const fromName = toSlug(name);
  if (fromName) return fromName;
  return `trial-${uiId}`;
}

function trialServicesFromSiteProducts(products: unknown[], addrFallback: string): ServiceItem[] {
  if (!Array.isArray(products) || products.length === 0) return [];
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
    const flowFeatures = typeof p.flow_features === "string" ? p.flow_features.trim() : "";
    const benefit_line = flowFeatures || benefits.join(" · ") || sugg[0] || "";
    return {
      ui_id: rowId,
      name: pname,
      price_text: String(p.price_text ?? "").trim(),
      duration: "",
      payment_link: "",
      service_slug: serviceSlugForPersistence("", pname, rowId),
      location_text: String(p.location_text ?? "").trim() || addrFallback,
      description: String(p.description ?? "").trim(),
      benefit_line,
    };
  });
}

/** תצוגה בשדה — ללא {serviceName} */
function experienceQuestionForDisplay(stored: string, serviceName: string): string {
  if (!serviceName.trim()) return stored.replace(/\{serviceName\}/g, "האימון");
  return stored.replace(/\{serviceName\}/g, serviceName);
}

/** שמירה מהשדה — מחזירה תבנית עם {serviceName} כשמתאים */
function experienceQuestionToStore(typed: string, serviceName: string): string {
  if (!serviceName.trim()) return typed;
  if (!typed.includes(serviceName)) return typed;
  return typed.split(serviceName).join("{serviceName}");
}

function afterPickForDisplay(stored: string, serviceName: string, benefit: string): string {
  return stored
    .replace(/\{serviceName\}/g, serviceName.trim() || "שם האימון שנבחר")
    .replace(/\{benefitLine\}/g, benefit.trim() || "תיאור מההגדרות");
}

function afterPickToStore(typed: string, serviceName: string, benefit: string): string {
  let s = typed;
  const ben = benefit.trim();
  const sn = serviceName.trim();
  if (ben && s.includes(ben)) s = s.split(ben).join("{benefitLine}");
  if (sn && s.includes(sn)) s = s.split(sn).join("{serviceName}");
  return s;
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

function parseMembershipTier(raw: unknown): MembershipTierUI {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const ex = Array.isArray(o.excluded_service_slugs)
      ? o.excluded_service_slugs.map(String)
      : [];
    return {
      id: typeof o.id === "string" ? o.id : uid(),
      name: String(o.name ?? ""),
      price: String(o.price ?? ""),
      monthlySessions: String(o.monthly_sessions ?? ""),
      notes: String(o.notes ?? ""),
      excludedServiceSlugs: ex,
    };
  }
  return {
    id: uid(),
    name: "",
    price: "",
    monthlySessions: "",
    notes: "",
    excludedServiceSlugs: [],
  };
}

function parsePunchCard(raw: unknown): PunchCardUI {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const ex = Array.isArray(o.excluded_service_slugs)
      ? o.excluded_service_slugs.map(String)
      : [];
    return {
      id: typeof o.id === "string" ? o.id : uid(),
      sessionCount: String(o.session_count ?? ""),
      validity: String(o.validity ?? ""),
      notes: String(o.notes ?? ""),
      excludedServiceSlugs: ex,
    };
  }
  return {
    id: uid(),
    sessionCount: "",
    validity: "",
    notes: "",
    excludedServiceSlugs: [],
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepHeader({ n, title, desc }: { n: number; title: string; desc?: string }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-1">
        <span className="w-8 h-8 rounded-full bg-[#f0eaff] text-[#7133da] text-sm font-bold flex items-center justify-center shrink-0">
          {n}
        </span>
        <h2 className="text-xl font-bold text-zinc-900">{title}</h2>
      </div>
      {desc && <p className="text-sm text-zinc-500 mr-11">{desc}</p>}
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label className="text-sm font-medium text-zinc-700 block">{label}</label>
      {children}
    </div>
  );
}

function Textarea({ value, onChange, placeholder, rows = 3 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <textarea
      dir="rtl"
      rows={rows}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#7133da]/40 resize-none"
    />
  );
}

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

function ServiceExcludePicker({
  services,
  excludedSlugs,
  onChange,
}: {
  services: ServiceItem[];
  excludedSlugs: string[];
  onChange: (next: string[]) => void;
}) {
  const opts = services
    .filter((s) => s.name.trim())
    .map((s) => {
      // `toSlug` returns empty for Hebrew-only names which caused multiple rows to share "".
      // Always derive a stable, unique slug for toggling.
      const slug = serviceSlugForPersistence(s.service_slug ?? "", s.name, s.ui_id).trim();
      return { slug, name: s.name.trim() };
    });

  if (opts.length === 0) {
    return (
      <p className="text-xs text-zinc-500 text-right">
        הוסיפו אימוני ניסיון בטאב «אימון ניסיון» כדי לסמן אימונים שאינם כלולים.
      </p>
    );
  }

  return (
    <div className="space-y-2 border border-zinc-100 rounded-xl p-3 bg-white">
      <p className="text-xs font-medium text-zinc-700 text-right">אימונים שנכללים במנוי או בכרטיסיה זו</p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {opts.map(({ slug, name }) => (
          <label key={slug} className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="rounded border-zinc-300"
              // Default: included (checked). If unchecked — it becomes excluded.
              checked={!excludedSlugs.includes(slug)}
              onChange={(e) => {
                const isIncluded = e.target.checked;
                if (isIncluded) onChange(excludedSlugs.filter((x) => x !== slug));
                else onChange([...excludedSlugs, slug]);
              }}
            />
            <span>{name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SlugSettingsPage() {
  const { slug } = useParams() as { slug: string };

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
  const [salesFlowRegenerating, setSalesFlowRegenerating] = useState(false);
  const [resetSalesFlowConfirmOpen, setResetSalesFlowConfirmOpen] = useState(false);
  const [salesFlowRegenToast, setSalesFlowRegenToast] = useState(false);
  const [fetchingArbox, setFetchingArbox] = useState(false);
  const [fetchArboxError, setFetchArboxError] = useState("");
  const [fetchArboxNotice, setFetchArboxNotice] = useState("");
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
  const [directions, setDirections] = useState("");
  const [businessTagline, setBusinessTagline] = useState("");
  const [traits, setTraits] = useState<string[]>(["", "", ""]);
  const [vibe, setVibe]         = useState<string[]>([]);
  const [arboxLink, setArboxLink] = useState("");
  /** דף מנויים/חבילות בארבוקס — סריקה לטאב כרטיסיות ומנויים */
  const [arboxMembershipsUrl, setArboxMembershipsUrl] = useState("");
  const [facebookPixelId, setFacebookPixelId] = useState("");
  const [conversionsApiToken, setConversionsApiToken] = useState("");
  const [showTokenHelp, setShowTokenHelp] = useState(false);

  // ── Step 2: Opening media
  const [openingMediaUrl, setOpeningMediaUrl]   = useState("");
  const [openingMediaType, setOpeningMediaType] = useState<"image" | "video" | "">("");
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaUploadError, setMediaUploadError] = useState("");

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
  // ── Step 7: Follow-up
  const [followupAfterRegistration, setFollowupAfterRegistration] = useState("");
  const [followupAfterHourNoRegistration, setFollowupAfterHourNoRegistration] = useState("");
  const [followupDayAfterTrial, setFollowupDayAfterTrial] = useState("");

  const [membershipTiers, setMembershipTiers] = useState<MembershipTierUI[]>([]);
  const [punchCards, setPunchCards] = useState<PunchCardUI[]>([]);

  // ── Step 2: Trial classes (אימון ניסיון) + drag & drop
  const [services, setServices]   = useState<ServiceItem[]>([]);
  const dragIdx = useRef<number | null>(null);
  /** true = יש פתיחה שמורה בשרת או שכבר מילאנו טמפלייט — לא לדרוס אוטומטית */
  const welcomeOpeningLockedRef = useRef(false);
  const welcomePrevStepRef = useRef(step);
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
        businessTagline.trim()
      ),
    [salesFlowConfig, botName, name, slug, businessTagline]
  );

  const trialServiceNames = useMemo(
    () => services.map((s) => s.name.trim()).filter(Boolean),
    [services]
  );

  /** דוגמה לתבניות שמכילות שם אימון ותיאור — לפי האימון הראשון ברשימה */
  const firstTrialForTemplates = useMemo(() => {
    const n = trialServiceNames[0];
    if (!n) return { name: "", benefit: "" };
    const row = services.find((s) => s.name.trim() === n);
    return { name: n, benefit: (row?.benefit_line ?? "").trim() };
  }, [trialServiceNames, services]);

  const prevStepForServicesRef = useRef(step);
  useEffect(() => {
    const prev = prevStepForServicesRef.current;
    prevStepForServicesRef.current = step;
    if (step === 2 && prev === 2 && servicesSignatureRef.current !== servicesSignature) {
      welcomeOpeningLockedRef.current = false;
    }
    servicesSignatureRef.current = servicesSignature;
  }, [step, servicesSignature]);

  useEffect(() => {
    const prev = welcomePrevStepRef.current;
    welcomePrevStepRef.current = step;
    if (!settingsHydrated || step !== 4) return;
    if (welcomeOpeningLockedRef.current) return;
    if (prev !== 3) return;

    setSalesFlowConfig(defaultSalesFlowConfig(vibe));
    welcomeOpeningLockedRef.current = true;
  }, [settingsHydrated, step, vibe]);

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
      businessTagline.trim()
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
  ]);

  const isPremium = plan === "premium";

  useEffect(() => {
    if (!isPremium && step === 5) setStep(6);
  }, [isPremium, step]);

  // ─── Load data ─────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setSettingsHydrated(false);
    setSettingsLoadError("");
    fetch(`/api/dashboard/settings?slug=${encodeURIComponent(slug)}`)
      .then(async (r) => {
        const data = (await r.json()) as {
          error?: string;
          business?: Record<string, unknown> | null;
          services?: unknown[];
        };
        if (cancelled) return;
        if (!r.ok) {
          setSettingsLoadError(
            data.error === "unauthorized"
              ? "נדרשת התחברות מחדש."
              : "לא ניתן לטעון את הגדרות העסק."
          );
          return;
        }
        const business = data.business;
        const svcs = data.services;
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
        setDirections(String(sl.directions ?? ""));
        setBusinessTagline(typeof sl.tagline === "string" ? sl.tagline : "");
        const f1 = typeof sl.fact1 === "string" ? sl.fact1 : "";
        const f2 = typeof sl.fact2 === "string" ? sl.fact2 : "";
        const f3 = typeof sl.fact3 === "string" ? sl.fact3 : "";
        const legacy = String(sl.business_description ?? business.business_description ?? "");
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
        {
          const mt = Array.isArray(sl.membership_tiers) ? sl.membership_tiers : [];
          setMembershipTiers(mt.length ? mt.map(parseMembershipTier) : []);
          const pc = Array.isArray(sl.punch_cards) ? sl.punch_cards : [];
          setPunchCards(pc.length ? pc.map(parsePunchCard) : []);
        }
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
          if (parsed) setSalesFlowConfig(parsed);
        } else {
          const def = defaultSalesFlowConfig(Array.isArray(sl.vibe) ? (sl.vibe as string[]) : []);
          if (loadedWelcomeIntro.trim()) def.greeting_body_override = loadedWelcomeIntro.trim();
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
        setArboxMembershipsUrl(String(sl.arbox_memberships_url ?? ""));
        setFacebookPixelId(String(business.facebook_pixel_id ?? ""));
        setConversionsApiToken(String(business.conversions_api_token ?? ""));
        setObjections(Array.isArray(sl.objections) ? (sl.objections as Objection[]) : []);

        const svcNamesForFollowup = Array.isArray(svcs)
          ? (svcs as Record<string, unknown>[])
              .map((s) => String(s.name ?? "").trim())
              .filter(Boolean)
          : [];
        const defaultFollow = buildDefaultFollowupPack({
          botName: String(business.bot_name ?? "זואי"),
          businessName: String(business.name ?? "").trim() || displayNameFromSlug(slug),
          niche: String(business.niche ?? ""),
          vibeLabels: Array.isArray(sl.vibe) ? (sl.vibe as string[]) : [],
          serviceNames: svcNamesForFollowup,
          address: String(sl.address ?? ""),
          tagline: typeof sl.tagline === "string" ? sl.tagline.trim() : "",
          hasBookingLink: Boolean(
            String(sl.arbox_link ?? "").trim() || String(sl.arbox_memberships_url ?? "").trim()
          ),
        });
        const regSaved =
          typeof sl.followup_after_registration === "string" ? sl.followup_after_registration.trim() : "";
        const hourSaved =
          typeof sl.followup_after_hour_no_registration === "string"
            ? sl.followup_after_hour_no_registration.trim()
            : "";
        const trialSaved =
          typeof sl.followup_day_after_trial === "string" ? sl.followup_day_after_trial.trim() : "";
        setFollowupAfterRegistration(regSaved || defaultFollow.followupAfterRegistration);
        setFollowupAfterHourNoRegistration(hourSaved || defaultFollow.followupAfterHourNoRegistration);
        setFollowupDayAfterTrial(trialSaved || defaultFollow.followupDayAfterTrial);

        if (Array.isArray(svcs)) {
          setServices((svcs as Record<string, unknown>[]).map((s) => {
            let meta: Record<string, unknown> = {};
            try { meta = JSON.parse(String(s.description ?? "{}")); } catch { /* empty */ }
            return {
              ui_id: uid(),
              name: String(s.name ?? ""),
              price_text: String(s.price_text ?? ""),
              duration: String(meta.duration ?? ""),
              payment_link: String(meta.payment_link ?? ""),
              service_slug: String(s.service_slug ?? ""),
              location_text: String(s.location_text ?? ""),
              description: String(s.description ?? ""),
              benefit_line: String(meta.benefit_line ?? ""),
            };
          }));
        }
        setSettingsHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setSettingsLoadError("שגיאת רשת בטעינת ההגדרות.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

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
      businessTagline.trim()
    );
    return {
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
          address,
          directions,
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
          arbox_memberships_url: arboxMembershipsUrl.trim(),
          objections,
          followup_after_registration: followupAfterRegistration,
          followup_after_hour_no_registration: followupAfterHourNoRegistration,
          followup_day_after_trial: followupDayAfterTrial,
          membership_tiers: membershipTiers
            .filter(
              (m) =>
                m.name.trim() ||
                m.price.trim() ||
                m.monthlySessions.trim() ||
                m.notes.trim()
            )
            .map((m) => ({
              id: m.id,
              name: m.name.trim(),
              price: m.price.trim(),
              monthly_sessions: m.monthlySessions.trim(),
              notes: m.notes.trim(),
              excluded_service_slugs: m.excludedServiceSlugs,
            })),
          punch_cards: punchCards
            .filter((c) => c.sessionCount.trim() || c.validity.trim() || c.notes.trim())
            .map((c) => ({
              id: c.id,
              session_count: c.sessionCount.trim(),
              validity: c.validity.trim(),
              notes: c.notes.trim(),
              excluded_service_slugs: c.excludedServiceSlugs,
            })),
        },
      },
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
        }),
      })),
      faqs: [] as unknown[],
    };
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
      directions,
      vibe,
      openingMediaUrl,
      openingMediaType,
      segQuestions,
      quickReplies,
      arboxLink,
      arboxMembershipsUrl,
      objections,
      followupAfterRegistration,
      followupAfterHourNoRegistration,
      followupDayAfterTrial,
      membershipTiers,
      punchCards,
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

  const applyFollowupTemplate = useCallback(() => {
    const pack = buildDefaultFollowupPack({
      botName: botName.trim() || "זואי",
      businessName: name.trim() || displayNameFromSlug(slug),
      niche: niche.trim(),
      vibeLabels: vibe,
      serviceNames: services.map((s) => s.name.trim()).filter(Boolean),
      address: address.trim(),
      tagline: businessTagline.trim(),
      hasBookingLink: Boolean(arboxLink.trim() || arboxMembershipsUrl.trim()),
    });
    setFollowupAfterRegistration(pack.followupAfterRegistration);
    setFollowupAfterHourNoRegistration(pack.followupAfterHourNoRegistration);
    setFollowupDayAfterTrial(pack.followupDayAfterTrial);
  }, [arboxLink, arboxMembershipsUrl, botName, businessTagline, name, niche, services, slug, vibe, address]);

  // ─── Media upload ──────────────────────────────────────────────────────────

  async function uploadMedia(file: File) {
    setMediaUploadError("");
    if (file.size > MAX_OPENING_MEDIA_BYTES) {
      setMediaUploadError(
        "הקובץ גדול מדי (מקסימום 16MB). נסו לכווץ את הסרטון או קובץ קטן יותר."
      );
      return;
    }
    setUploadingMedia(true);
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
        setMediaUploadError("תשובת שרת לא תקינה.");
        return;
      }
      if (!signRes.ok) {
        setMediaUploadError(signJson.error?.trim() || `הכנת העלאה נכשלה (${signRes.status}).`);
        return;
      }
      const signedUrl = signJson.signedUrl?.trim();
      const publicUrl = signJson.publicUrl?.trim();
      if (!signedUrl || !publicUrl) {
        setMediaUploadError("לא התקבל קישור חתום להעלאה — נסו שוב.");
        return;
      }

      const uploadBody = new FormData();
      uploadBody.append("cacheControl", "3600");
      uploadBody.append("", file);

      const putRes = await fetch(signedUrl, {
        method: "PUT",
        headers: { "x-upsert": "true" },
        body: uploadBody,
      });

      if (!putRes.ok) {
        let errText = "";
        try {
          const errJson = (await putRes.json()) as { message?: string; error?: string };
          errText = (errJson.message || errJson.error || "").trim();
        } catch {
          errText = putRes.statusText || "";
        }
        setMediaUploadError(errText || `העלאה ל-Storage נכשלה (${putRes.status}).`);
        return;
      }

      setOpeningMediaUrl(publicUrl);
      setOpeningMediaType(file.type.startsWith("video") ? "video" : "image");
    } catch {
      setMediaUploadError("בעיית רשת בהעלאה.");
    } finally {
      setUploadingMedia(false);
    }
  }

  // ─── Fetch site ────────────────────────────────────────────────────────────

  async function fetchSite() {
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
                ? "חסר מפתח AI בשרת — פנו לתמיכה."
                : errStr === "ai_parse_failed"
                  ? "לא ניתן לעבד את תוצאת הסריקה. נסו שוב."
                  : msgStr ||
                    (errStr === "blocked_auto_scraping"
                      ? "האתר חוסם סריקה אוטומטית — מלאו את השדות ידנית."
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
      if (tag) setBusinessTagline(tag.split("\n")[0].trim());
      if (typeof j.address === "string" && j.address.trim()) setAddress(j.address.trim());
      if (typeof j.directions === "string" && j.directions.trim()) setDirections(j.directions.trim());
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
      }
      setStep(1);
    } finally {
      setFetchingUrl(false);
    }
  }

  async function resetAndRegenerateSalesFlow() {
    setResetSalesFlowConfirmOpen(false);
    setSalesFlowRegenerating(true);
    setFetchSiteError("");
    setFetchSiteNotice("");
    setSaveErr("");
    let j: Record<string, unknown> = {};
    try {
      if (websiteUrl.trim()) {
        try {
          const res = await fetch("/api/dashboard/fetch-site", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ website_url: websiteUrl, business_name: name, niche }),
          });
          try {
            j = (await res.json()) as Record<string, unknown>;
          } catch {
            setFetchSiteError("תשובת שרת לא תקינה.");
            j = {};
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
                    ? "חסר מפתח AI בשרת — פנו לתמיכה."
                    : errStr === "ai_parse_failed"
                      ? "לא ניתן לעבד את תוצאת הסריקה. נסו שוב."
                      : msgStr ||
                        (errStr === "blocked_auto_scraping"
                          ? "האתר חוסם סריקה אוטומטית — מלאו את השדות ידנית."
                          : `הסריקה נכשלה (${res.status}).`);
            setFetchSiteError(friendly);
            const hasPayload =
              Boolean(j.niche) ||
              Boolean(j.tagline) ||
              Boolean(j.business_description) ||
              (Array.isArray(j.business_traits) && j.business_traits.length > 0) ||
              (Array.isArray(j.products) && j.products.length > 0);
            if (!hasPayload) {
              j = {};
            }
          }

          if (typeof j.warning === "string" && j.warning && msgStr) {
            setFetchSiteNotice(msgStr);
          }
        } catch {
          setFetchSiteError("בעיית רשת בסריקת האתר.");
          j = {};
        }
      }

      const addrFallback =
        (typeof j.address === "string" && j.address.trim()) ? j.address.trim() : address;

      const nextServices =
        Array.isArray(j.products) && j.products.length > 0
          ? trialServicesFromSiteProducts(j.products, addrFallback)
          : [];

      flushSync(() => {
        setSalesFlowConfig(defaultSalesFlowConfig(vibe));
        setSegQuestions([]);
        setServices(nextServices);

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
        if (tag) setBusinessTagline(tag.split("\n")[0].trim());
        if (typeof j.address === "string" && j.address.trim()) setAddress(j.address.trim());
        if (typeof j.directions === "string" && j.directions.trim()) setDirections(j.directions.trim());
        const book =
          (typeof j.schedule_booking_url === "string" && j.schedule_booking_url.trim()) ||
          (typeof j.schedule_url === "string" && j.schedule_url.trim()) ||
          "";
        if (book) setArboxLink(book);
        const scannedTraits = Array.isArray(j.business_traits)
          ? j.business_traits.map((x: unknown) => String(x ?? "").trim()).filter(Boolean)
          : [];
        if (scannedTraits.length) setTraits(normalizeTraitsState(scannedTraits));
      });

      const saveRes = await fetch("/api/dashboard/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getSavePayloadRef.current()),
      });
      if (!saveRes.ok) {
        setSaveErr(await readSaveErrorFromResponse(saveRes));
        return;
      }
      setSalesFlowRegenToast(true);
      window.setTimeout(() => setSalesFlowRegenToast(false), 4000);
      setAutosaveStatus("idle");
      setAutoSaveErr("");
    } finally {
      setSalesFlowRegenerating(false);
    }
  }

  async function fetchArboxMemberships() {
    const u = arboxMembershipsUrl.trim() || arboxLink.trim();
    if (!u) {
      setFetchArboxError("הזינו קישור לדף מנויים בארבוקס.");
      return;
    }
    setFetchingArbox(true);
    setFetchArboxError("");
    setFetchArboxNotice("");
    try {
      const res = await fetch("/api/dashboard/fetch-arbox-memberships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: u }),
      });
      const j = (await res.json()) as Record<string, unknown>;
      const msgStr = typeof j.message === "string" ? j.message.trim() : "";
      if (!res.ok) {
        setFetchArboxError(
          msgStr ||
            (j.error === "unauthorized"
              ? "נדרשת התחברות מחדש."
              : j.error === "missing_anthropic_key"
                ? "חסר מפתח AI בשרת."
                : "המשיכה מארבוקס נכשלה. נסו שוב או מלאו ידנית.")
        );
        return;
      }
      if (typeof j.warning === "string" && j.warning && msgStr) {
        setFetchArboxNotice(msgStr);
      }
      const mt = Array.isArray(j.membership_tiers) ? j.membership_tiers : [];
      const pc = Array.isArray(j.punch_cards) ? j.punch_cards : [];
      if (mt.length) {
        setMembershipTiers(
          mt
            .filter((row): row is Record<string, unknown> => row !== null && typeof row === "object")
            .map((row) => ({
              id: uid(),
              name: String(row.name ?? "").trim(),
              price: String(row.price ?? "").trim(),
              monthlySessions: String(row.monthly_sessions ?? "").trim(),
              notes: String(row.notes ?? "").trim(),
              excludedServiceSlugs: [] as string[],
            }))
        );
      }
      if (pc.length) {
        setPunchCards(
          pc
            .filter((row): row is Record<string, unknown> => row !== null && typeof row === "object")
            .map((row) => ({
              id: uid(),
              sessionCount: String(row.session_count ?? "").trim(),
              validity: String(row.validity ?? "").trim(),
              notes: String(row.notes ?? "").trim(),
              excludedServiceSlugs: [] as string[],
            }))
        );
      }
      if (!mt.length && !pc.length && !msgStr) {
        setFetchArboxNotice("לא נמצאו מנויים או כרטיסיות — בדקו את הקישור או מלאו ידנית.");
      }
    } catch {
      setFetchArboxError("בעיית רשת במשיכת ארבוקס.");
    } finally {
      setFetchingArbox(false);
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
      <div className="min-h-screen bg-[#f5f3ff]" dir="rtl">
        <div className="sticky top-0 z-40 bg-white border-b border-zinc-200 shadow-sm">
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

        <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
          <div className="rounded-2xl bg-white border border-[rgba(113,51,218,0.1)] p-5 animate-pulse space-y-4">
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

          <div className="flex items-center justify-between mt-8 pt-4 border-t border-zinc-200 animate-pulse">
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
    setStep((s) => {
      let n = Math.min(STEPS.length, s + 1);
      if (!isPremium && n === 5) n = 6;
      return n;
    });
  }

  function prevStep() {
    setStep((s) => {
      let n = Math.max(1, s - 1);
      if (!isPremium && s === 6 && n === 5) n = 4;
      return n;
    });
  }

  return (
    <div className="min-h-screen bg-[#f5f3ff]" dir="rtl">

      {/* ── Top bar ── */}
      <div className="sticky top-0 z-40 bg-white border-b border-zinc-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
            <span className="text-[#7133da]">HeyZoe</span>
            <span className="text-zinc-300">/</span>
            <span>{slug}</span>
          </div>
          {canAutosave ? (
            <div className="text-xs text-zinc-500 flex items-center gap-1.5 shrink-0 min-h-[1.25rem]" aria-live="polite">
              {autosaveStatus === "saving" && (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7133da]" aria-hidden />
                  <span>שומר…</span>
                </>
              )}
              {autosaveStatus === "saved" && <span className="text-emerald-600">נשמר אוטומטית</span>}
              {autosaveStatus === "error" && (
                <span className="text-amber-600 max-w-[min(20rem,55vw)] text-right" title={autoSaveErr || undefined}>
                  שמירה אוטומטית נכשלה{autoSaveErr ? ` — ${autoSaveErr}` : ""}
                </span>
              )}
            </div>
          ) : null}
        </div>

        {/* Step indicator */}
        <div className="max-w-6xl mx-auto px-4 pb-3 overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {STEPS.map((label, i) => {
              const n = i + 1;
              if (!isPremium && label === "חיבור פייסבוק") return null;
              const active  = step === n;
              const done    = step > n;
              return (
                <button
                  key={n}
                  onClick={() => setStep(n)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    active  ? "text-white shadow-sm bg-[linear-gradient(135deg,#7133da,#ff92ff)]" :
                    done    ? "bg-[#f0eaff] text-[#7133da]" :
                              "bg-zinc-100 text-zinc-400 hover:bg-zinc-200"
                  }`}
                >
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    active ? "bg-white/30" : done ? "bg-[#e6dcff]" : "bg-zinc-200"
                  }`}>{done ? "✓" : n}</span>
                  <span className="hidden sm:inline">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {settingsLoadError ? (
        <div className="bg-red-50 border-b border-red-200 px-4 py-3 text-sm text-red-800 text-center" role="alert">
          {settingsLoadError}
        </div>
      ) : null}

      {/* ── Step content ── */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-col xl:flex-row gap-8 items-start justify-center">
          <div className="flex-1 min-w-0 w-full max-w-2xl mx-auto xl:mx-0">

        {/* ════════════════════ STEP 1 ════════════════════ */}
        {step === 1 && (
          <Card>
            <CardHeader><CardTitle><StepHeader n={1} title="פרטי העסק" /></CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <Field label="כתובת האתר (אופציונלי)">
                <div className="flex gap-2">
                  <Input
                    dir="ltr"
                    placeholder="https://your-business.com"
                    value={websiteUrl}
                    onChange={e => setWebsiteUrl(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && fetchSite()}
                  />
                  <Button onClick={fetchSite} disabled={!websiteUrl || fetchingUrl} className="shrink-0 gap-2">
                    {fetchingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {fetchingUrl ? "סורק..." : "סרוק"}
                  </Button>
                </div>
              </Field>
              {fetchingUrl && (
                <p className="text-sm text-[#7133da] flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  מנתח את האתר — זה לוקח כמה שניות...
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

              <Field label="תיאור העסק">
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

              <Field label="לינק מערכת שעות / Arbox">
                <Input dir="ltr" value={arboxLink} onChange={e => setArboxLink(e.target.value)} placeholder="https://..." />
              </Field>

              <Field label="הנחיות הגעה">
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

              <Field label="אינסטגרם">
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

              <Field label="סגנון דיבור">
                <div className="flex flex-wrap gap-2">
                  {VIBES.map(v => (
                    <button
                      key={v}
                      onClick={() => setVibe(curr => curr.includes(v) ? curr.filter(x => x !== v) : [...curr, v])}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-all ${
                        vibe.includes(v)
                          ? "text-white shadow-sm border-transparent bg-[linear-gradient(135deg,#7133da,#ff92ff)]"
                          : "bg-[#f0eaff] text-[#7133da] border-transparent hover:opacity-90"
                      }`}
                    >{v}</button>
                  ))}
                </div>
              </Field>
            </CardContent>
          </Card>
        )}

        {/* ════════════════════ STEP 2 — אימון ניסיון ════════════════════ */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle>
                <StepHeader
                  n={2}
                  title="אימון ניסיון"
                  desc="רשימת סוגי האימונים/שירותים — ממולאת אוטומטית מסריקת האתר ב«פרטי העסק». אפשר לערוך, לגרור לסדר או לסרוק שוב."
                />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row-reverse gap-2 sm:items-center sm:justify-between rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-2.5">
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2 shrink-0 h-9 text-sm"
                  onClick={() => void fetchSite()}
                  disabled={!websiteUrl.trim() || fetchingUrl}
                >
                  {fetchingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {fetchingUrl ? "סורק..." : "סרוק שוב מהאתר"}
                </Button>
                <p className="text-xs text-zinc-600 text-right leading-snug">
                  {!websiteUrl.trim()
                    ? "הוסיפו כתובת אתר בטאב «פרטי העסק» ולחצו «סרוק» כדי למלא את הרשימה."
                    : "הסריקה מעדכנת גם שדות בפרטי העסק — רק אם רוצים לרענן את השירותים מהאתר."}
                </p>
              </div>

              {services.map((s, i) => (
                <div
                  key={s.ui_id}
                  onDragOver={(e) => onDragOver(e, i)}
                  className="border border-[rgba(113,51,218,0.1)] rounded-2xl p-4 space-y-3 bg-white hover:border-[rgba(113,51,218,0.25)] transition-colors"
                >
                  <div className="flex gap-2 items-center">
                    <span
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        onDragStart(i);
                      }}
                      onDragEnd={(e) => {
                        e.stopPropagation();
                        onDragEnd();
                      }}
                      className="inline-flex items-center justify-center p-1 -m-1 rounded-lg cursor-grab active:cursor-grabbing text-zinc-300 hover:text-zinc-500 shrink-0 touch-none select-none"
                      aria-label="גרירה לשינוי סדר"
                      title="גררו מהאייקון כדי לסדר מחדש"
                    >
                      <GripVertical className="h-4 w-4 pointer-events-none" />
                    </span>
                    <div className="flex-1 space-y-1">
                      <Input
                        dir="rtl"
                        value={s.name}
                        maxLength={TRIAL_SERVICE_NAME_MAX_CHARS}
                        onChange={(e) => {
                          const arr = [...services];
                          const newName = [...e.target.value].slice(0, TRIAL_SERVICE_NAME_MAX_CHARS).join("");
                          const slugFromName = toSlug(newName);
                          arr[i] = {
                            ...s,
                            name: newName,
                            service_slug: slugFromName || s.service_slug || `trial-${s.ui_id}`,
                          };
                          setServices(arr);
                        }}
                        placeholder="שם קצר לכפתור (עד 15 תווים) *"
                        className="font-medium w-full"
                      />
                      <p className="text-[11px] text-zinc-500 text-right leading-snug pr-0.5">
                        קצר יותר = כפתור ברור יותר (עד 3 מילים)
                      </p>
                    </div>
                    <button onClick={() => setServices(sv => sv.filter((_, j) => j !== i))} className="p-1 text-zinc-400 hover:text-red-400">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="מחיר">
                      <Input dir="rtl" value={s.price_text} onChange={e => { const arr = [...services]; arr[i] = { ...s, price_text: e.target.value }; setServices(arr); }} placeholder="₪ 80" />
                    </Field>
                    <Field label="משך">
                      <Input dir="rtl" value={s.duration} onChange={e => { const arr = [...services]; arr[i] = { ...s, duration: e.target.value }; setServices(arr); }} placeholder="60 דק׳" />
                    </Field>
                  </div>

                  <Field label="לינק סליקה *">
                    <div className="flex gap-2 items-center">
                      <Link className="h-4 w-4 text-zinc-400 shrink-0" />
                      <Input dir="ltr" value={s.payment_link} onChange={e => { const arr = [...services]; arr[i] = { ...s, payment_link: e.target.value }; setServices(arr); }} placeholder="https://..." />
                    </div>
                  </Field>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="תיאור">
                      <Input
                        dir="rtl"
                        value={s.benefit_line}
                        onChange={(e) => {
                          const arr = [...services];
                          arr[i] = { ...s, benefit_line: e.target.value };
                          setServices(arr);
                        }}
                        placeholder="למשל: שיעורים לכל הרמות באווירה הכי כיפית שיש"
                      />
                    </Field>
                    <Field label="מיקום">
                      <Input dir="rtl" value={s.location_text} onChange={e => { const arr = [...services]; arr[i] = { ...s, location_text: e.target.value }; setServices(arr); }} placeholder={address || "תל אביב"} />
                    </Field>
                  </div>
                </div>
              ))}

              <Button
                variant="outline"
                onClick={() =>
                  setServices((sv) => [
                    ...sv,
                    {
                      ui_id: uid(),
                      name: "",
                      price_text: "",
                      duration: "",
                      payment_link: "",
                      service_slug: "",
                      location_text: address,
                      description: "",
                      benefit_line: "",
                    },
                  ])
                }
                className="w-full gap-2"
              >
                <Plus className="h-4 w-4" /> הוסף שורה
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ════════════════════ STEP 3 — כרטיסיות ומנויים ════════════════════ */}
        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle>
                <StepHeader
                  n={3}
                  title="כרטיסיות ומנויים"
                  desc="מנויים חודשיים וכרטיסיות — זואי תשתמש בזה בתשובות על מחירים והרשמה"
                />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-8">
              <div className="space-y-3 border border-[rgba(113,51,218,0.15)] rounded-2xl p-4 bg-[#faf8ff]">
                <Field label="קישור לדף מנויים / חבילות בארבוקס">
                  <Input
                    dir="ltr"
                    className="font-mono text-sm"
                    placeholder="https://....web.arboxapp.com/membership?..."
                    value={arboxMembershipsUrl}
                    onChange={(e) => setArboxMembershipsUrl(e.target.value)}
                  />
                </Field>
                <p className="text-xs text-zinc-600 text-right leading-relaxed">
                  זואי משתמשת בקישור בהקשר מחירים והרשמה. אפשר למשוך מנויים וכרטיסיות אוטומטית מהדף (טקסט שנסרק) — אם הדף ריק, מלאו ידנית למטה.
                </p>
                <div className="flex flex-col sm:flex-row-reverse gap-2 sm:items-center">
                  <Button
                    type="button"
                    className="gap-2 shrink-0"
                    disabled={fetchingArbox || (!arboxMembershipsUrl.trim() && !arboxLink.trim())}
                    onClick={() => void fetchArboxMemberships()}
                  >
                    {fetchingArbox ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {fetchingArbox ? "מושך מארבוקס..." : "משוך מנויים וכרטיסיות מהדף"}
                  </Button>
                  {!arboxMembershipsUrl.trim() && arboxLink.trim() ? (
                    <p className="text-xs text-zinc-500 text-right">אין קישור כאן — ייעשה שימוש בלינק מערכת השעות מפרטי העסק.</p>
                  ) : null}
                </div>
                {fetchArboxError ? (
                  <p className="text-sm text-red-600" role="alert">
                    {fetchArboxError}
                  </p>
                ) : null}
                {fetchArboxNotice ? (
                  <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    {fetchArboxNotice}
                  </p>
                ) : null}
              </div>

              <div className="space-y-4 border border-zinc-200 rounded-2xl p-4 bg-white">
                <p className="text-sm font-semibold text-zinc-900">מנויים</p>
                <p className="text-xs text-zinc-500">
                  לכל מנוי: שם, מחיר, כמות אימונים חודשית והערות. ברירת מחדל — כל אימוני הניסיון כלולים; אפשר לסמן חריגות.
                </p>
                {membershipTiers.map((m, i) => (
                  <div
                    key={m.id}
                    className="border border-dashed border-zinc-200 rounded-xl p-4 space-y-3 bg-zinc-50/50"
                  >
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-xs font-medium text-zinc-500">מנוי {i + 1}</span>
                      <button
                        type="button"
                        onClick={() => setMembershipTiers((prev) => prev.filter((x) => x.id !== m.id))}
                        className="p-1 text-zinc-400 hover:text-red-500"
                        aria-label="הסר מנוי"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <Field label="שם המנוי">
                      <Input
                        dir="rtl"
                        value={m.name}
                        onChange={(e) => {
                          const v = e.target.value;
                          setMembershipTiers((prev) =>
                            prev.map((x) => (x.id === m.id ? { ...x, name: v } : x))
                          );
                        }}
                        placeholder="למשל: מנוי בוקר"
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="מחיר">
                        <Input
                          dir="rtl"
                          value={m.price}
                          onChange={(e) => {
                            const v = e.target.value;
                            setMembershipTiers((prev) =>
                              prev.map((x) => (x.id === m.id ? { ...x, price: v } : x))
                            );
                          }}
                          placeholder="₪ 390 לחודש"
                        />
                      </Field>
                      <Field label="כמות אימונים חודשית">
                        <Input
                          dir="rtl"
                          value={m.monthlySessions}
                          onChange={(e) => {
                            const v = e.target.value;
                            setMembershipTiers((prev) =>
                              prev.map((x) => (x.id === m.id ? { ...x, monthlySessions: v } : x))
                            );
                          }}
                          placeholder="8"
                        />
                      </Field>
                    </div>
                    <Field label="הערות">
                      <Textarea
                        value={m.notes}
                        onChange={(v) =>
                          setMembershipTiers((prev) =>
                            prev.map((x) => (x.id === m.id ? { ...x, notes: v } : x))
                          )
                        }
                        rows={2}
                        placeholder="תנאים, התחייבות, מה כלול…"
                      />
                    </Field>
                    <ServiceExcludePicker
                      services={services}
                      excludedSlugs={m.excludedServiceSlugs}
                      onChange={(next) =>
                        setMembershipTiers((prev) =>
                          prev.map((x) => (x.id === m.id ? { ...x, excludedServiceSlugs: next } : x))
                        )
                      }
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() =>
                    setMembershipTiers((prev) => [
                      ...prev,
                      {
                        id: uid(),
                        name: "",
                        price: "",
                        monthlySessions: "",
                        notes: "",
                        excludedServiceSlugs: [],
                      },
                    ])
                  }
                >
                  <Plus className="h-4 w-4" />
                  הוסף מנוי
                </Button>
              </div>

              <div className="space-y-4 border border-zinc-200 rounded-2xl p-4 bg-white">
                <p className="text-sm font-semibold text-zinc-900">כרטיסיות</p>
                <p className="text-xs text-zinc-500">
                  כמות אימונים, תוקף והערות לכל כרטיסיה. ברירת מחדל — כל אימוני הניסיון כלולים; אפשר לסמן חריגות.
                </p>
                {punchCards.map((c, i) => (
                  <div
                    key={c.id}
                    className="border border-dashed border-zinc-200 rounded-xl p-4 space-y-3 bg-zinc-50/50"
                  >
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-xs font-medium text-zinc-500">כרטיסיה {i + 1}</span>
                      <button
                        type="button"
                        onClick={() => setPunchCards((prev) => prev.filter((x) => x.id !== c.id))}
                        className="p-1 text-zinc-400 hover:text-red-500"
                        aria-label="הסר כרטיסיה"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="כמות אימונים">
                        <Input
                          dir="rtl"
                          value={c.sessionCount}
                          onChange={(e) => {
                            const v = e.target.value;
                            setPunchCards((prev) =>
                              prev.map((x) => (x.id === c.id ? { ...x, sessionCount: v } : x))
                            );
                          }}
                          placeholder="10"
                        />
                      </Field>
                      <Field label="תוקף הכרטיסיה">
                        <Input
                          dir="rtl"
                          value={c.validity}
                          onChange={(e) => {
                            const v = e.target.value;
                            setPunchCards((prev) =>
                              prev.map((x) => (x.id === c.id ? { ...x, validity: v } : x))
                            );
                          }}
                          placeholder="3 חודשים ממועד הרכישה"
                        />
                      </Field>
                    </div>
                    <Field label="הערות">
                      <Textarea
                        value={c.notes}
                        onChange={(v) =>
                          setPunchCards((prev) =>
                            prev.map((x) => (x.id === c.id ? { ...x, notes: v } : x))
                          )
                        }
                        rows={2}
                        placeholder="מדיניות ביטול, הרחבות…"
                      />
                    </Field>
                    <ServiceExcludePicker
                      services={services}
                      excludedSlugs={c.excludedServiceSlugs}
                      onChange={(next) =>
                        setPunchCards((prev) =>
                          prev.map((x) => (x.id === c.id ? { ...x, excludedServiceSlugs: next } : x))
                        )
                      }
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() =>
                    setPunchCards((prev) => [
                      ...prev,
                      {
                        id: uid(),
                        sessionCount: "",
                        validity: "",
                        notes: "",
                        excludedServiceSlugs: [],
                      },
                    ])
                  }
                >
                  <Plus className="h-4 w-4" />
                  הוסף כרטיסיה
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ════════════════════ STEP 4 — מסלול מכירה ════════════════════ */}
        {step === 4 && (
          <Card>
            <CardHeader>
              <CardTitle>
                <StepHeader
                  n={4}
                  title="מסלול מכירה"
                  desc="פתיחה, שאלה וכפתורים; הנעה לפעולה למטה. זואי ממשיכה לפי הכללים במערכת (מעל שלושה אימונים — רשימה ממוספרת)."
                />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <p className="text-sm font-medium text-zinc-700 mb-2">מדיה לפתיחה (אופציונלי)</p>
                {!openingMediaUrl ? (
                  <button
                    type="button"
                    disabled={uploadingMedia}
                    onClick={() => !uploadingMedia && mediaInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-zinc-300 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-[#7133da]/50 hover:bg-[#f7f3ff] transition-all disabled:opacity-60 disabled:pointer-events-none"
                  >
                    {uploadingMedia ? (
                      <>
                        <Loader2 className="h-8 w-8 animate-spin text-[#7133da]/60" />
                        <p className="text-sm text-zinc-500">מעלה…</p>
                      </>
                    ) : (
                      <>
                        <Upload className="h-8 w-8 text-zinc-400" />
                        <p className="text-sm text-zinc-500">לחץ להעלאת תמונה או סרטון</p>
                        <p className="text-xs text-zinc-400">עד 16MB. JPG, PNG, GIF, MP4 (העלאה ישירה ל-Storage)</p>
                      </>
                    )}
                  </button>
                ) : (
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 space-y-3">
                    {openingMediaType === "video" ? (
                      <div className="relative w-full max-w-sm mx-auto">
                        <video
                          src={videoUrlForPreview(openingMediaUrl)}
                          className="max-h-48 w-full rounded-xl object-cover bg-black"
                          muted
                          playsInline
                          preload="metadata"
                          controls
                        />
                        <p className="text-center text-xs text-emerald-600 mt-2 font-medium">
                          הווידאו הועלה — תצוגה מקדימה (אפשר להפעיל)
                        </p>
                      </div>
                    ) : (
                      <div className="relative w-full max-w-sm mx-auto">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={openingMediaUrl} alt="מדיה לפתיחה" className="max-h-48 w-full rounded-xl object-contain mx-auto" />
                        <p className="text-center text-xs text-emerald-600 mt-2 font-medium">התמונה הועלתה</p>
                      </div>
                    )}
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-1 text-xs py-1.5 px-3 h-auto"
                        disabled={uploadingMedia}
                        onClick={() => mediaInputRef.current?.click()}
                      >
                        <Upload className="h-4 w-4" />
                        החלף קובץ
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-1 text-xs py-1.5 px-3 h-auto text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => {
                          setOpeningMediaUrl("");
                          setOpeningMediaType("");
                          setMediaUploadError("");
                        }}
                      >
                        <X className="h-4 w-4" />
                        הסר מדיה
                      </Button>
                    </div>
                  </div>
                )}
                {mediaUploadError ? (
                  <p className="text-sm text-red-600 mt-2 text-right" role="alert">
                    {mediaUploadError}
                  </p>
                ) : null}
                <input
                  ref={mediaInputRef}
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) uploadMedia(f);
                  }}
                />
              </div>

              <div className="flex flex-wrap justify-end gap-2 border-t border-dashed border-zinc-200 pt-5">
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1 text-xs py-1.5 px-3 h-auto"
                  onClick={() => setSalesFlowConfig(defaultSalesFlowConfig(vibe))}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  החל טקסטים לפי סגנון דיבור (שלב 1)
                </Button>
              </div>
              <div className="flex justify-start pt-1">
                <Button
                  type="button"
                  variant="outline"
                  aria-label="Reset and regenerate sales flow"
                  className="gap-1 text-xs py-1.5 px-3 h-auto text-red-800/90 border-red-200 bg-white hover:bg-red-50"
                  disabled={
                    salesFlowRegenerating || !settingsHydrated || saving || fetchingUrl
                  }
                  onClick={() => setResetSalesFlowConfirmOpen(true)}
                >
                  {salesFlowRegenerating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                  Reset & Regenerate
                </Button>
              </div>
              <p className="text-[11px] text-zinc-400 leading-snug text-right max-w-md mr-auto">
                מוחק את אימוני הניסיון והמסלול הנוכחי, מריץ סריקת אתר מחדש (אם הוזן אתר בשלב 1) ושומר ברירת מחדל לפי סגנון הדיבור.
              </p>

              <div className="space-y-2">
                <p className="text-sm font-semibold text-zinc-900 text-right">סשן פתיחה</p>
                <div className="border border-zinc-200 rounded-2xl p-4 space-y-3 bg-white">
                <p className="text-xs text-zinc-600 leading-relaxed text-right">
                  טקסט הפתיחה נשען על שם העסק, שם הבוט והתיאור מ«פרטי העסק». עורכים כאן את הטקסט שיישלח ללקוח — בלי סוגריים או קוד, רק משפטים מוכנים.
                </p>

                <Field label="טקסט פתיחה ללקוח">
                  <Textarea
                    value={
                      salesFlowConfig.greeting_body_override !== undefined
                        ? salesFlowConfig.greeting_body_override
                        : salesOpeningAutoText
                    }
                    onChange={(v) =>
                      setSalesFlowConfig((c) => ({ ...c, greeting_body_override: v }))
                    }
                    rows={5}
                    placeholder={salesOpeningAutoText}
                  />
                </Field>
                <div className="flex flex-wrap justify-end gap-2 pb-0.5">
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-1 text-xs py-1.5 px-3 h-auto"
                    onClick={() =>
                      setSalesFlowConfig((c) => ({
                        ...c,
                        greeting_body_override: undefined,
                      }))
                    }
                  >
                    חזרה לטקסט אוטומטי משלב 1
                  </Button>
                </div>

                {trialServiceNames.length > 1 ? (
                  <>
                    <div className="pt-2 border-t border-zinc-200/80 space-y-2">
                      <Field label="שאלה לפני בחירת אימון" className="space-y-1">
                        <Textarea
                          value={salesFlowConfig.multi_service_question}
                          onChange={(v) =>
                            setSalesFlowConfig((c) => ({ ...c, multi_service_question: v }))
                          }
                          rows={2}
                          placeholder="למשל: איזה אימון הכי מדבר אליך?"
                        />
                      </Field>
                      <p className="text-xs text-zinc-500 text-right leading-snug">
                        אחרי השאלה יוצגו ללקוח שמות האימונים מהגדרות — עד שלושה ככפתורי בחירה, מעל שלושה כרשימה ממוספרת.
                      </p>
                      <div className="flex flex-wrap gap-2 justify-end">
                        {trialServiceNames.map((n) => (
                          <span
                            key={n}
                            className="px-3 py-2 rounded-xl text-xs font-medium text-right border border-[#7133da]/20 bg-white text-zinc-800 shadow-sm"
                          >
                            {n}
                          </span>
                        ))}
                      </div>
                    </div>

                    <Field label="מענה אחרי בחירת האימון">
                      <p className="text-[11px] text-zinc-500 text-right mb-1.5 leading-snug">
                        זואי ממלאה את שם האימון שנבחר ואת שדה «תיאור» מ«אימון ניסיון». כתבו משפט קצר וחי (למשל: שיעורים לכל הרמות באווירה הכי כיפית שיש) — לא רשימת נקודות.
                      </p>
                      <Textarea
                        rows={4}
                        value={afterPickForDisplay(
                          salesFlowConfig.after_service_pick,
                          firstTrialForTemplates.name,
                          firstTrialForTemplates.benefit
                        )}
                        onChange={(v) =>
                          setSalesFlowConfig((c) => ({
                            ...c,
                            after_service_pick: afterPickToStore(
                              v,
                              firstTrialForTemplates.name,
                              firstTrialForTemplates.benefit
                            ),
                          }))
                        }
                        placeholder="למשל: אוקיי מדהים! שיעורי האקרו אצלנו הם דרך כיפית להתחזק, להתגמש, ולהיות חלק מקהילה…"
                      />
                    </Field>
                  </>
                ) : null}

                {trialServiceNames.length === 0 ? (
                  <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-right">
                    הוסיפו לפחות אימון ניסיון אחד בטאב «אימון ניסיון» כדי להגדיר שאלה וכפתורים בפתיחה.
                  </p>
                ) : null}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold text-zinc-900 text-right">סשן חימום</p>
                <div className="border border-zinc-200 rounded-2xl p-4 space-y-3 bg-white">
                  <p className="text-xs text-zinc-600 text-right leading-relaxed">
                    מומלץ לא יותר מ־2–3 שאלות בסך הכול אחרי הפתיחה (כולל שאלת הניסיון). שמרו על זרימה קצרה לפני שלב ההנעה לפעולה.
                  </p>

                  {trialServiceNames.length === 0 ? (
                    <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-right">
                      כדי לערוך כאן את שאלת הניסיון והכפתורים — הוסיפו לפחות אימון ניסיון אחד בטאב «אימון ניסיון» (שלב 2).
                    </p>
                  ) : (
                    <>
                      <Field
                        label={
                          trialServiceNames.length > 1
                            ? "שאלת ניסיון קודם"
                            : "שאלת ניסיון קודם (אחרי הפתיחה)"
                        }
                      >
                        <Input
                          dir="rtl"
                          value={experienceQuestionForDisplay(
                            salesFlowConfig.experience_question,
                            trialServiceNames.length > 1
                              ? firstTrialForTemplates.name
                              : trialServiceNames[0] ?? ""
                          )}
                          onChange={(e) => {
                            const sn =
                              trialServiceNames.length > 1
                                ? firstTrialForTemplates.name
                                : trialServiceNames[0] ?? "";
                            setSalesFlowConfig((c) => ({
                              ...c,
                              experience_question: experienceQuestionToStore(e.target.value, sn),
                            }));
                          }}
                          placeholder={
                            trialServiceNames.length > 1
                              ? "למשל: יצא לך לנסות בעבר?"
                              : "למשל: יש לך כבר ניסיון בפילאטיס?"
                          }
                        />
                      </Field>
                      <p className="text-xs font-medium text-zinc-700 text-right">כפתורי תשובה</p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {([0, 1, 2] as const).map((i) => (
                          <Field key={i} label={`כפתור ${i + 1}`}>
                            <Input
                              dir="rtl"
                              value={salesFlowConfig.experience_options[i]}
                              onChange={(e) => {
                                const next = [...salesFlowConfig.experience_options] as [
                                  string,
                                  string,
                                  string,
                                ];
                                next[i] = e.target.value;
                                setSalesFlowConfig((c) => ({ ...c, experience_options: next }));
                              }}
                            />
                          </Field>
                        ))}
                      </div>
                      <Field label="מענה אחרי בחירה בשאלת הניסיון">
                        <Textarea
                          value={salesFlowConfig.after_experience}
                          onChange={(v) =>
                            setSalesFlowConfig((c) => ({ ...c, after_experience: v }))
                          }
                          rows={2}
                          placeholder="משפט מעודד קצר לפני המשך הפלואו…"
                        />
                      </Field>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold text-zinc-900 text-right">סשן הנעה לפעולה</p>
                <div className="border border-zinc-200 rounded-2xl p-4 space-y-4 bg-white">
                <p className="text-xs text-zinc-500 text-right">
                  מכאן בכל תשובה מציגים גם את כפתורי ההנעה (מערכת שעות, הרשמה לניסיון, מחירי מנויים) — לפי התוויות והידע במערכת.
                </p>
                <Field label="גוף ההודעה">
                  <Textarea
                    value={salesFlowConfig.cta_body}
                    onChange={(v) => setSalesFlowConfig((c) => ({ ...c, cta_body: v }))}
                    rows={3}
                  />
                </Field>
                {salesFlowConfig.cta_buttons.map((b, bi) => (
                  <div key={b.id} className="flex flex-wrap gap-2 items-end border-t border-zinc-100 pt-3">
                    <Field label={`כפתור ${bi + 1} — תווית`}>
                      <Input
                        dir="rtl"
                        className="min-w-[12rem]"
                        value={b.label}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSalesFlowConfig((c) => ({
                            ...c,
                            cta_buttons: c.cta_buttons.map((x) =>
                              x.id === b.id ? { ...x, label: v } : x
                            ),
                          }));
                        }}
                      />
                    </Field>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-600 block">סוג</label>
                      <select
                        dir="rtl"
                        className="rounded-xl border border-zinc-300 px-3 py-2 text-sm text-zinc-800 bg-white min-w-[11rem]"
                        value={b.kind}
                        onChange={(e) => {
                          const kind = e.target.value as SalesFlowCtaButton["kind"];
                          setSalesFlowConfig((c) => ({
                            ...c,
                            cta_buttons: c.cta_buttons.map((x) =>
                              x.id === b.id ? { ...x, kind } : x
                            ),
                          }));
                        }}
                      >
                        <option value="schedule">מערכת שעות (לינק Arbox)</option>
                        <option value="trial">הרשמה לניסיון (לינק לאימון)</option>
                        <option value="memberships">מחירי מנויים (מתוך הגדרות)</option>
                      </select>
                    </div>
                  </div>
                ))}

                {salesFlowConfig.cta_extra_steps.map((st, si) => (
                  <div
                    key={st.id}
                    className="border border-dashed border-zinc-200 rounded-xl p-3 space-y-2 bg-white"
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-medium text-zinc-500">שאלה {si + 1} (הנעה)</span>
                      <button
                        type="button"
                        className="p-1 text-zinc-400 hover:text-red-500"
                        onClick={() =>
                          setSalesFlowConfig((c) => ({
                            ...c,
                            cta_extra_steps: c.cta_extra_steps.filter((x) => x.id !== st.id),
                          }))
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <Field label="שאלה">
                      <Input
                        dir="rtl"
                        value={st.question}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSalesFlowConfig((c) => ({
                            ...c,
                            cta_extra_steps: c.cta_extra_steps.map((x) =>
                              x.id === st.id ? { ...x, question: v } : x
                            ),
                          }));
                        }}
                      />
                    </Field>
                    {st.options.map((o, oi) => (
                      <div key={oi} className="flex gap-2">
                        <Input
                          dir="rtl"
                          className="flex-1"
                          value={o}
                          onChange={(e) => {
                            const v = e.target.value;
                            setSalesFlowConfig((c) => ({
                              ...c,
                              cta_extra_steps: c.cta_extra_steps.map((x) =>
                                x.id === st.id
                                  ? {
                                      ...x,
                                      options: x.options.map((t, j) => (j === oi ? v : t)),
                                    }
                                  : x
                              ),
                            }));
                          }}
                        />
                        <button
                          type="button"
                          className="p-1 text-zinc-400 hover:text-red-500"
                          onClick={() =>
                            setSalesFlowConfig((c) => ({
                              ...c,
                              cta_extra_steps: c.cta_extra_steps.map((x) =>
                                x.id === st.id
                                  ? { ...x, options: x.options.filter((_, j) => j !== oi) }
                                  : x
                              ),
                            }))
                          }
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
                        setSalesFlowConfig((c) => ({
                          ...c,
                          cta_extra_steps: c.cta_extra_steps.map((x) =>
                            x.id === st.id ? { ...x, options: [...x.options, ""] } : x
                          ),
                        }))
                      }
                    >
                      <Plus className="h-3 w-3" /> הוסף כפתור
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-1 text-sm"
                  onClick={() =>
                    setSalesFlowConfig((c) => ({
                      ...c,
                      cta_extra_steps: [
                        ...c.cta_extra_steps,
                        { id: uid(), question: "", options: ["", ""] },
                      ],
                    }))
                  }
                >
                  <Plus className="h-4 w-4" />
                  הוסף שאלה לסשן הנעה לפעולה
                </Button>
                </div>
              </div>

              <p className="text-[11px] text-zinc-500 text-right">
                כשנכנסים לטאב זה אחרי «כרטיסיות ומנויים» נטען לעיתים טקסט ברירת מחדל לפי סגנון הדיבור. מעל שלושה אימוני ניסיון — בווטסאפ נשלחת רשימה ממוספרת.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ════════════════════ STEP 5 — פייסבוק ════════════════════ */}
        {step === 5 && isPremium ? (
          <Card>
            <CardHeader>
              <CardTitle>
                <StepHeader n={5} title="חיבור פייסבוק" desc="חבילה בסיסית + Pixel (פרימיום)" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-900">חבילה 1 — חיבור בסיסי</p>
                <p className="text-xs text-zinc-600">
                  שלחו Partner Request והקימו קמפיין "הודעות לוואטסאפ" דרך מנהל המודעות. אין צורך בשדות טכניים בשלב זה.
                </p>
              </div>

              <div className="space-y-2 border-t border-dashed border-zinc-200 pt-3">
                <p className="text-sm font-medium text-zinc-900">חבילה 2 — פרימיום (Pixel + Conversions API)</p>
                <Field label="Facebook Pixel ID">
                  <Input dir="ltr" value={facebookPixelId} onChange={e => setFacebookPixelId(e.target.value)} placeholder="123456789012345" />
                </Field>
                <Field label="Conversions API Access Token">
                  <Input dir="ltr" type="password" value={conversionsApiToken} onChange={e => setConversionsApiToken(e.target.value)} placeholder="הדבק כאן את הטוקן" />
                </Field>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowTokenHelp(true)}
                    className="text-[11px] underline underline-offset-4 text-zinc-500 hover:text-zinc-700 cursor-pointer"
                  >
                    איך מוצאים את הטוקן?
                  </button>
                </div>
                <p className="text-[11px] text-zinc-500">
                  כאשר שני השדות מלאים, נשלח אירוע Server-to-Server לפייסבוק על כל המרה.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* ════════════════════ STEP 6 — פולואפ ════════════════════ */}
        {step === 6 && (
          <Card>
            <CardHeader>
              <CardTitle>
                <StepHeader
                  n={6}
                  title="פולואפ"
                  desc="ברירת המחדל נוצרת לפי שם הבוט, סגנון דיבור, אימוני ניסיון וכתובת. זואי בצ'אט ובווטסאפ תמיד: עונה מהידע בהגדרות, מוסיפה שאלת המשך, ואז 2–4 אפשרויות ממוספרות (כמו כפתורים) — גם אחרי שאלה פתוחה — כדי לקדם שריון לשיעור ניסיון."
                />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1 text-xs py-1.5 px-3 h-auto"
                  onClick={applyFollowupTemplate}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  חידוש טקסטים לפי העסק וסגנון
                </Button>
              </div>
              <Field label="פולואפ לאחר הרשמה">
                <Textarea
                  value={followupAfterRegistration}
                  onChange={setFollowupAfterRegistration}
                  rows={8}
                />
              </Field>

              <Field label="פולואפ אחרי שעה אם לא נרשם">
                <Textarea
                  value={followupAfterHourNoRegistration}
                  onChange={setFollowupAfterHourNoRegistration}
                  rows={5}
                />
              </Field>

              <Field label="פולואפ יום אחרי שיעור הניסיון">
                <Textarea
                  value={followupDayAfterTrial}
                  onChange={setFollowupDayAfterTrial}
                  rows={5}
                />
                <p className="text-[11px] text-zinc-500">
                  הערה: בעתיד המועד (יום אחרי שיעור הניסיון) יישאב אוטומטית מארבוקס.
                </p>
              </Field>
            </CardContent>
          </Card>
        )}

          </div>

          <WhatsAppSettingsPreview
            step={step as 1 | 2 | 3 | 4 | 5 | 6}
            botName={botName}
            businessName={name}
            openingMediaUrl={openingMediaUrl}
            openingMediaType={openingMediaType}
            salesFlowConfig={salesFlowConfig}
            services={services.map((s) => ({
              name: s.name,
              price_text: s.price_text,
              benefit_line: s.benefit_line,
            }))}
            businessTagline={businessTagline}
            traits={traits}
            address={address}
            followupAfterRegistration={followupAfterRegistration}
            followupAfterHourNoRegistration={followupAfterHourNoRegistration}
            followupDayAfterTrial={followupDayAfterTrial}
          />
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

        {resetSalesFlowConfirmOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-5 text-right shadow-xl" dir="rtl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-zinc-900">איפוס מסלול מכירה</p>
                  <p className="text-xs text-zinc-500 mt-0.5">הפעולה תישמר בשרת מיד אחרי האישור</p>
                </div>
                <button
                  type="button"
                  onClick={() => setResetSalesFlowConfirmOpen(false)}
                  className="rounded-full p-1 text-zinc-500 hover:text-zinc-800 cursor-pointer shrink-0"
                  aria-label="סגור"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-4 text-sm text-zinc-700 leading-relaxed">
                האם את/ה בטוח/ה? פעולה זו תמחק את כל מסלול המכירה הנוכחי ותייצר חדש
              </p>
              <div className="mt-5 flex flex-wrap justify-start gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-zinc-300"
                  disabled={salesFlowRegenerating}
                  onClick={() => setResetSalesFlowConfirmOpen(false)}
                >
                  ביטול
                </Button>
                <Button
                  type="button"
                  className="gap-1.5 bg-red-600 hover:bg-red-600/90 text-white border-0 shadow-sm"
                  disabled={salesFlowRegenerating || !settingsHydrated}
                  onClick={() => void resetAndRegenerateSalesFlow()}
                >
                  {salesFlowRegenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                  {salesFlowRegenerating ? "מייצר מחדש…" : "אישור איפוס"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {showTokenHelp ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-5 text-right shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-zinc-900">איך מוצאים את הטוקן?</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Conversions API Access Token</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTokenHelp(false)}
                  className="rounded-full p-1 text-zinc-500 hover:text-zinc-800 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ol className="mt-4 space-y-2 text-sm text-zinc-700 list-decimal pr-5">
                <li>כנס ל־Events Manager.</li>
                <li>בחר את ה־Dataset שלך.</li>
                <li>לך ל־Settings והעתק את ה־Access Token.</li>
              </ol>
              <div className="mt-5 flex justify-start">
                <Button onClick={() => setShowTokenHelp(false)} className="px-4">סגור</Button>
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
        {salesFlowRegenToast && (
          <div className="fixed bottom-16 left-1/2 -translate-x-1/2 bg-zinc-800 text-white px-5 py-2.5 rounded-full text-sm font-medium shadow-lg flex items-center gap-2 z-50">
            <Check className="h-4 w-4" /> מסלול המכירה אופס ונוצר מחדש
          </div>
        )}
      </div>
    </div>
  );
}
