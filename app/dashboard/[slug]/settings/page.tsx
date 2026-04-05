"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft, ArrowRight, Check, ChevronDown,
  GripVertical, Link, Loader2, Plus, Sparkles, Trash2, Upload, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buildWelcomeMessageForStorage, splitWelcomeForChat } from "@/lib/welcome-message";
import { buildDefaultSaleWelcome } from "@/lib/default-welcome";
import { WhatsAppSettingsPreview } from "@/components/settings/WhatsAppSettingsPreview";

// ─── Types ────────────────────────────────────────────────────────────────────

type QuickReply  = { id: string; label: string; reply: string };
type Objection   = { id: string; question: string; answer: string };
type SegQuestion = { id: string; question: string; answers: { id: string; text: string; service_slug: string }[] };
type ServiceItem = {
  ui_id: string; name: string; price_text: string;
  duration: string; payment_link: string;
  service_slug: string; location_text: string; description: string;
};
type SalesFlowBlockUI = { id: string; intro: string; question: string; options: string[] };

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = [
  "פרטי העסק",
  "שירותים",
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

const DEFAULT_FOLLOWUP_REGISTRATION = `כל הכבוד! נרשמת בהצלחה 🎉

מה לצפות מהשיעור הראשון:
- הגיעו 10 דקות לפני
- לבשו בגדים נוחים
- שתו מים לפני השיעור

מחכים לכם!`;

const DEFAULT_FOLLOWUP_HOUR = `רק מזכירה בעדינות — אם תרצו לשריין מקום לשיעור ניסיון, אפשר לענות בקצרה כאן 🙂`;

const DEFAULT_FOLLOWUP_TRIAL = `היי! איך היה שיעור הניסיון? אשמח לשמוע איך היה ולהציע את המסלול שהכי מתאים לך.`;

const AUTOSAVE_DEBOUNCE_MS = 1600;
const AUTOSAVE_ENABLE_DELAY_MS = 500;
/** תואם למגבלת גוף בקשה ב-Vercel — גם בצד לקוח כדי להציג הודעה לפני העלאה */
const MAX_OPENING_MEDIA_BYTES = 4 * 1024 * 1024;

function videoUrlForPreview(url: string) {
  if (!url) return url;
  const base = url.split("#")[0];
  return `${base}#t=0.001`;
}

function uid() { return Math.random().toString(36).slice(2, 9); }
function toSlug(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-");
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SlugSettingsPage() {
  const { slug } = useParams() as { slug: string };

  const [step, setStep]     = useState(1);
  const [plan, setPlan] = useState<"basic" | "premium">("basic");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [fetchingUrl, setFetchingUrl]         = useState(false);
  const [canAutosave, setCanAutosave] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [autoSaveErr, setAutoSaveErr] = useState("");

  // ── Step 1: Business details (includes optional website import)
  const [websiteUrl, setWebsiteUrl] = useState("");

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
  const [salesFlowBlocks, setSalesFlowBlocks] = useState<SalesFlowBlockUI[]>([]);
  const [expandedFlowBlockId, setExpandedFlowBlockId] = useState<string | null>(null);

  // ── נשמר ב־DB ללא עריכה במסך (טאב הוסר)
  const [segQuestions, setSegQuestions] = useState<SegQuestion[]>([]);

  // ── Quick replies
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);

  // ── Step 4: Services + drag & drop
  const [services, setServices]   = useState<ServiceItem[]>([]);
  const dragIdx = useRef<number | null>(null);

  const defaultWelcomeParts = useMemo(
    () =>
      buildDefaultSaleWelcome({
        botName: botName.trim() || "זואי",
        businessName: name.trim() || slug,
        address: address.trim(),
        services: services.filter((s) => s.name.trim()).map((s) => ({ name: s.name })),
        niche: niche.trim(),
        vibeLabels: vibe,
      }),
    [address, botName, name, niche, services, slug, vibe]
  );

  const applyWelcomeTemplate = useCallback(() => {
    const p = buildDefaultSaleWelcome({
      botName: botName.trim() || "זואי",
      businessName: name.trim() || slug,
      address: address.trim(),
      services: services.filter((s) => s.name.trim()).map((s) => ({ name: s.name })),
      niche: niche.trim(),
      vibeLabels: vibe,
    });
    setWelcomeIntro(p.intro);
    setWelcomeQuestion(p.question);
    setWelcomeOptions(p.options.length ? p.options : [""]);
  }, [address, botName, name, niche, services, slug, vibe]);

  useEffect(() => {
    if (step !== 3) return;
    const optsEmpty = welcomeOptions.every((o) => !o.trim());
    if (welcomeIntro.trim() || welcomeQuestion.trim() || !optsEmpty) return;
    setWelcomeIntro(defaultWelcomeParts.intro);
    setWelcomeQuestion(defaultWelcomeParts.question);
    const o = defaultWelcomeParts.options;
    setWelcomeOptions(o.length ? [...o] : ["", "", ""]);
  }, [step, defaultWelcomeParts, welcomeIntro, welcomeQuestion, welcomeOptions]);

  // ── Objections (will live inside "Questions & menu")
  const [objections, setObjections] = useState<Objection[]>([]);
  // ── Step 7: Follow-up
  const [followupAfterRegistration, setFollowupAfterRegistration] = useState(DEFAULT_FOLLOWUP_REGISTRATION);
  const [followupAfterHourNoRegistration, setFollowupAfterHourNoRegistration] = useState(DEFAULT_FOLLOWUP_HOUR);
  const [followupDayAfterTrial, setFollowupDayAfterTrial] = useState(DEFAULT_FOLLOWUP_TRIAL);

  const isPremium = plan === "premium";

  useEffect(() => {
    if (!isPremium && step === 4) setStep(5);
  }, [isPremium, step]);

  // ─── Load data ─────────────────────────────────────────────────────────────

  useEffect(() => {
    fetch("/api/dashboard/settings")
      .then(r => r.json())
      .then(({ business, services: svcs }) => {
        if (!business) return;
        const sl = (business.social_links && typeof business.social_links === "object"
          ? business.social_links : {}) as Record<string, unknown>;

        setWebsiteUrl(String(sl.website_url ?? business.website_url ?? ""));
        setPlan((business.plan === "premium" ? "premium" : "basic") as "basic" | "premium");
        setName(String(business.name ?? ""));
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
        setOpeningMediaUrl(String(sl.opening_media_url ?? ""));
        setOpeningMediaType((sl.opening_media_type as "image" | "video" | "") ?? "");
        const fullWelcome = String(business.welcome_message ?? "");
        const hasStructuredWelcome =
          (typeof sl.welcome_intro === "string" && sl.welcome_intro.trim()) ||
          (typeof sl.welcome_question === "string" && sl.welcome_question.trim()) ||
          (Array.isArray(sl.welcome_options) && sl.welcome_options.some((x) => String(x ?? "").trim()));
        if (hasStructuredWelcome) {
          setWelcomeIntro(typeof sl.welcome_intro === "string" ? sl.welcome_intro : "");
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
            setWelcomeIntro(lines.slice(0, -1).join("\n").trim());
            setWelcomeQuestion(last);
          } else {
            setWelcomeIntro(body.trim());
            setWelcomeQuestion("");
          }
          const pad = [...chips, "", "", ""].slice(0, 3);
          setWelcomeOptions(pad);
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
        const sfb = Array.isArray(sl.sales_flow_blocks) ? sl.sales_flow_blocks : [];
        setSalesFlowBlocks(
          sfb.map((b: unknown) => {
            if (!b || typeof b !== "object")
              return { id: uid(), intro: "", question: "", options: ["", "", ""] };
            const o = b as Record<string, unknown>;
            const opts = Array.isArray(o.options) ? o.options.map((x) => String(x ?? "")) : [];
            const base = opts.length ? [...opts, ""] : ["", "", ""];
            return {
              id: uid(),
              intro: typeof o.intro === "string" ? o.intro : "",
              question: typeof o.question === "string" ? o.question : "",
              options: base.slice(0, Math.max(3, base.length)),
            };
          })
        );
        setArboxLink(String(sl.arbox_link ?? ""));
        setFacebookPixelId(String(business.facebook_pixel_id ?? ""));
        setConversionsApiToken(String(business.conversions_api_token ?? ""));
        setObjections(Array.isArray(sl.objections) ? (sl.objections as Objection[]) : []);
        setFollowupAfterRegistration(
          sl.followup_after_registration != null && typeof sl.followup_after_registration === "string"
            ? sl.followup_after_registration
            : DEFAULT_FOLLOWUP_REGISTRATION
        );
        setFollowupAfterHourNoRegistration(
          sl.followup_after_hour_no_registration != null && typeof sl.followup_after_hour_no_registration === "string"
            ? sl.followup_after_hour_no_registration
            : DEFAULT_FOLLOWUP_HOUR
        );
        setFollowupDayAfterTrial(
          sl.followup_day_after_trial != null && typeof sl.followup_day_after_trial === "string"
            ? sl.followup_day_after_trial
            : DEFAULT_FOLLOWUP_TRIAL
        );

        if (Array.isArray(svcs)) {
          setServices(svcs.map((s: Record<string, unknown>) => {
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
            };
          }));
        }
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading) {
      setCanAutosave(false);
      return;
    }
    const t = window.setTimeout(() => setCanAutosave(true), AUTOSAVE_ENABLE_DELAY_MS);
    return () => clearTimeout(t);
  }, [loading]);

  // ─── Save payload (ידני + אוטומטי) ─────────────────────────────────────────

  const getSavePayload = useCallback(
    () => ({
      business: {
        slug,
        name,
        niche,
        bot_name: botName,
        welcome_message: buildWelcomeMessageForStorage(welcomeIntro, welcomeQuestion, welcomeOptions),
        facebook_pixel_id: facebookPixelId,
        conversions_api_token: conversionsApiToken,
        social_links: {
          website_url: websiteUrl,
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
          welcome_intro: welcomeIntro.trim(),
          welcome_question: welcomeQuestion.trim(),
          welcome_options: welcomeOptions.map((o) => o.trim()),
          sales_flow_blocks: salesFlowBlocks
            .map(({ intro, question, options }) => ({
              intro: intro.trim(),
              question: question.trim(),
              options: options.map((x) => x.trim()).filter(Boolean),
            }))
            .filter((b) => b.intro || b.question || b.options.length > 0),
          segmentation_questions: segQuestions,
          quick_replies: quickReplies,
          arbox_link: arboxLink,
          objections,
          followup_after_registration: followupAfterRegistration,
          followup_after_hour_no_registration: followupAfterHourNoRegistration,
          followup_day_after_trial: followupDayAfterTrial,
        },
      },
      services: services.filter((s) => s.name).map((s) => ({
        name: s.name,
        service_slug: s.service_slug || toSlug(s.name),
        price_text: s.price_text,
        location_text: s.location_text,
        location_mode: "location",
        description: JSON.stringify({ duration: s.duration, payment_link: s.payment_link }),
      })),
      faqs: [] as unknown[],
    }),
    [
      slug,
      name,
      niche,
      botName,
      welcomeIntro,
      welcomeQuestion,
      welcomeOptions,
      facebookPixelId,
      conversionsApiToken,
      websiteUrl,
      businessTagline,
      traits,
      address,
      directions,
      vibe,
      openingMediaUrl,
      openingMediaType,
      salesFlowBlocks,
      segQuestions,
      quickReplies,
      arboxLink,
      objections,
      followupAfterRegistration,
      followupAfterHourNoRegistration,
      followupDayAfterTrial,
      services,
    ]
  );

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

  // ─── Media upload ──────────────────────────────────────────────────────────

  async function uploadMedia(file: File) {
    setMediaUploadError("");
    if (file.size > MAX_OPENING_MEDIA_BYTES) {
      setMediaUploadError(
        "הקובץ גדול מדי (מקסימום 4MB). נסו לכווץ את הסרטון או להעלות תמונה."
      );
      return;
    }
    setUploadingMedia(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/dashboard/upload-logo", { method: "POST", body: fd });
      let j: { url?: string; error?: string } = {};
      try {
        j = await res.json();
      } catch {
        setMediaUploadError("תשובת שרת לא תקינה.");
        return;
      }
      if (!res.ok) {
        setMediaUploadError(j.error?.trim() || `העלאה נכשלה (${res.status}).`);
        return;
      }
      if (j.url) {
        setOpeningMediaUrl(j.url);
        setOpeningMediaType(file.type.startsWith("video") ? "video" : "image");
      } else {
        setMediaUploadError("לא התקבל קישור לקובץ — נסו שוב או קובץ קטן יותר.");
      }
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
    try {
      const res = await fetch("/api/dashboard/fetch-site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website_url: websiteUrl, business_name: name, niche }),
      });
      const j = await res.json();
      if (j.niche) setNiche(j.niche);
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
      if (j.products?.length) {
        setServices(j.products.slice(0, 8).map((p: Record<string, unknown>) => ({
          ui_id: uid(),
          name: String(p.name ?? ""),
          price_text: String(p.price_text ?? ""),
          duration: "",
          payment_link: "",
          service_slug: toSlug(String(p.name ?? "")),
          location_text:
            String(p.location_text ?? "").trim() ||
            (typeof j.address === "string" && j.address.trim() ? j.address.trim() : address),
          description: "",
        })));
      }
      setStep(1);
    } finally { setFetchingUrl(false); }
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
      if (!isPremium && n === 4) n = 5;
      return n;
    });
  }

  function prevStep() {
    setStep((s) => {
      let n = Math.max(1, s - 1);
      if (!isPremium && s === 5 && n === 4) n = 3;
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

              <div className="grid grid-cols-2 gap-4">
                <Field label="שם העסק *">
                  <Input dir="rtl" value={name} onChange={e => setName(e.target.value)} placeholder="Acro by Joe" />
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

              <Field label="הנחיות הגעה">
                <Textarea value={directions} onChange={setDirections} placeholder="חנייה בחינם מאחורי הבניין, כניסה מצד ימין..." rows={2} />
              </Field>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 block">מאפיינים שווה לציין</label>
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

              <Field label="לינק מערכת שעות / Arbox">
                <Input dir="ltr" value={arboxLink} onChange={e => setArboxLink(e.target.value)} placeholder="https://..." />
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

        {/* ════════════════════ STEP 2 — שירותים ════════════════════ */}
        {step === 2 && (
          <Card>
            <CardHeader><CardTitle><StepHeader n={2} title="שירותים" desc="גרור לשינוי סדר עדיפויות" /></CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {services.map((s, i) => (
                <div
                  key={s.ui_id}
                  draggable
                  onDragStart={() => onDragStart(i)}
                  onDragOver={e => onDragOver(e, i)}
                  onDragEnd={onDragEnd}
                  className="border border-[rgba(113,51,218,0.1)] rounded-2xl p-4 space-y-3 bg-white hover:border-[rgba(113,51,218,0.25)] transition-colors"
                >
                  <div className="flex gap-2 items-center">
                    <GripVertical className="h-4 w-4 text-zinc-300 cursor-grab shrink-0" />
                    <Input
                      dir="rtl"
                      value={s.name}
                      onChange={e => {
                        const arr = [...services];
                        arr[i] = { ...s, name: e.target.value, service_slug: toSlug(e.target.value) };
                        setServices(arr);
                      }}
                      placeholder="שם השירות *"
                      className="flex-1 font-medium"
                    />
                    <button onClick={() => setServices(sv => sv.filter((_, j) => j !== i))} className="p-1 text-zinc-400 hover:text-red-400">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                  <Field label="מחיר שיעור">
                    <Input dir="rtl" value={s.price_text} onChange={e => { const arr = [...services]; arr[i] = { ...s, price_text: e.target.value }; setServices(arr); }} placeholder="₪ 80 לשיעור ניסיון" />
                    </Field>
                  <Field label="משך שיעור">
                      <Input dir="rtl" value={s.duration} onChange={e => { const arr = [...services]; arr[i] = { ...s, duration: e.target.value }; setServices(arr); }} placeholder="60 דקות" />
                    </Field>
                  </div>

                  <Field label="לינק סליקה">
                    <div className="flex gap-2 items-center">
                      <Link className="h-4 w-4 text-zinc-400 shrink-0" />
                      <Input dir="ltr" value={s.payment_link} onChange={e => { const arr = [...services]; arr[i] = { ...s, payment_link: e.target.value }; setServices(arr); }} placeholder="https://payment.link/..." />
                    </div>
                  </Field>

                  <Field label="מיקום">
                    <Input dir="rtl" value={s.location_text} onChange={e => { const arr = [...services]; arr[i] = { ...s, location_text: e.target.value }; setServices(arr); }} placeholder="תל אביב / אונליין" />
                  </Field>
                </div>
              ))}

              <Button
                variant="outline"
                onClick={() => setServices(sv => [...sv, { ui_id: uid(), name: "", price_text: "", duration: "", payment_link: "", service_slug: "", location_text: address, description: "" }])}
                className="w-full gap-2"
              >
                <Plus className="h-4 w-4" /> הוסף שירות
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ════════════════════ STEP 3 — מסלול מכירה ════════════════════ */}
        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle>
                <StepHeader
                  n={3}
                  title="מסלול מכירה"
                  desc="מדיה וטקסט פתיחה לווטסאפ, ואז שלבים נוספים באקורדיון — זואי תשתמש בזה בשיחה"
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
                        <p className="text-xs text-zinc-400">עד 4MB (מגבלת שרת). JPG, PNG, GIF, MP4</p>
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

              <div className="border-t border-dashed border-zinc-200 pt-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-zinc-800">שלב ראשון במסלול (פתיחה)</p>
                  <Button type="button" variant="outline" className="shrink-0 gap-1 text-xs py-1.5 px-3 h-auto" onClick={applyWelcomeTemplate}>
                    <Sparkles className="h-3.5 w-3.5" />
                    יישום טמפלייט
                  </Button>
                </div>
                <Field label="טקסט לפני השאלה (ברכה, כתובת…)">
                  <Textarea
                    value={welcomeIntro}
                    onChange={setWelcomeIntro}
                    placeholder={`היי! כאן ${botName || "זואי"} מ־${name || slug}…`}
                    rows={5}
                  />
                </Field>
                <Field label="השאלה">
                  <Input
                    dir="rtl"
                    value={welcomeQuestion}
                    onChange={(e) => setWelcomeQuestion(e.target.value)}
                    placeholder="אשמח להבין ראשית מה מעניין אותך?"
                  />
                </Field>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-700 block">כפתורי תשובה</label>
                  <div className="space-y-2">
                    {welcomeOptions.map((opt, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <span className="text-xs text-zinc-400 w-5 shrink-0">{i + 1}</span>
                        <Input
                          dir="rtl"
                          value={opt}
                          onChange={(e) =>
                            setWelcomeOptions((prev) => {
                              const next = [...prev];
                              next[i] = e.target.value;
                              return next;
                            })
                          }
                          placeholder={`כפתור ${i + 1}`}
                          className="flex-1"
                        />
                        {welcomeOptions.length > 1 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setWelcomeOptions((prev) => prev.filter((_, j) => j !== i))
                            }
                            className="p-1 text-zinc-400 hover:text-red-500 shrink-0"
                            aria-label="הסר כפתור"
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
                    className="w-full gap-1 text-sm"
                    onClick={() => setWelcomeOptions((prev) => [...prev, ""])}
                  >
                    <Plus className="h-4 w-4" />
                    הוסף כפתור
                  </Button>
                </div>
                <p className="text-[11px] text-zinc-500">
                  ברירת המחדל נוצרת לפי שם הבוט, שם העסק, הכתובת והשירותים (שלב 2) — ניתן לערוך הכל. סגנון הדיבור בשלב 1 משפיע על ניסוח השיחה בזואי.
                </p>
              </div>

              <div className="border-t border-dashed border-zinc-200 pt-5 space-y-3">
                <p className="text-sm font-medium text-zinc-800">המשך מסלול (אחרי תשובת הלקוח לפתיחה)</p>
                <p className="text-xs text-zinc-500">כל שלב: טקסט לפני שאלה, שאלה וכפתורים — יפתח בלחיצה.</p>
                {salesFlowBlocks.map((b, bi) => {
                  const open = expandedFlowBlockId === b.id;
                  return (
                    <div key={b.id} className="border border-zinc-200 rounded-2xl overflow-hidden bg-white">
                      <button
                        type="button"
                        onClick={() => setExpandedFlowBlockId(open ? null : b.id)}
                        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-right bg-zinc-50 hover:bg-zinc-100/80 transition-colors"
                      >
                        <span className="text-sm font-medium text-zinc-800">
                          שלב {bi + 2} במסלול
                          {(b.question.trim() || b.intro.trim()) && (
                            <span className="font-normal text-zinc-500 mr-2">
                              — {b.question.trim() || b.intro.trim().slice(0, 36)}
                              {(b.question.trim() || b.intro.trim()).length > 36 ? "…" : ""}
                            </span>
                          )}
                        </span>
                        <ChevronDown className={`h-4 w-4 text-zinc-500 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                      </button>
                      {open ? (
                        <div className="p-4 space-y-4 border-t border-zinc-100">
                          <Field label="טקסט לפני השאלה">
                            <Textarea
                              value={b.intro}
                              onChange={(v) =>
                                setSalesFlowBlocks((prev) =>
                                  prev.map((x) => (x.id === b.id ? { ...x, intro: v } : x))
                                )
                              }
                              rows={3}
                              placeholder="קצר לפני השאלה…"
                            />
                          </Field>
                          <Field label="השאלה">
                            <Input
                              dir="rtl"
                              value={b.question}
                              onChange={(e) =>
                                setSalesFlowBlocks((prev) =>
                                  prev.map((x) => (x.id === b.id ? { ...x, question: e.target.value } : x))
                                )
                              }
                              placeholder="מה תרצו לעשות הלאה?"
                            />
                          </Field>
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-zinc-700 block">כפתורים</label>
                            {b.options.map((opt, oi) => (
                              <div key={oi} className="flex gap-2 items-center">
                                <span className="text-xs text-zinc-400 w-5 shrink-0">{oi + 1}</span>
                                <Input
                                  dir="rtl"
                                  value={opt}
                                  onChange={(e) =>
                                    setSalesFlowBlocks((prev) =>
                                      prev.map((x) => {
                                        if (x.id !== b.id) return x;
                                        const opts = [...x.options];
                                        opts[oi] = e.target.value;
                                        return { ...x, options: opts };
                                      })
                                    )
                                  }
                                  className="flex-1"
                                />
                                {b.options.length > 1 ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSalesFlowBlocks((prev) =>
                                        prev.map((x) =>
                                          x.id === b.id
                                            ? { ...x, options: x.options.filter((_, j) => j !== oi) }
                                            : x
                                        )
                                      )
                                    }
                                    className="p-1 text-zinc-400 hover:text-red-500 shrink-0"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                ) : (
                                  <span className="w-8 shrink-0" />
                                )}
                              </div>
                            ))}
                            <Button
                              type="button"
                              variant="outline"
                              className="gap-1 text-sm py-1.5 h-auto"
                              onClick={() =>
                                setSalesFlowBlocks((prev) =>
                                  prev.map((x) =>
                                    x.id === b.id ? { ...x, options: [...x.options, ""] } : x
                                  )
                                )
                              }
                            >
                              <Plus className="h-3 w-3" />
                              הוסף כפתור
                            </Button>
                          </div>
                          <div className="flex justify-end pt-2">
                            <Button
                              type="button"
                              variant="ghost"
                              className="text-red-600 hover:text-red-700 gap-1"
                              onClick={() => {
                                setSalesFlowBlocks((prev) => prev.filter((x) => x.id !== b.id));
                                setExpandedFlowBlockId((cur) => (cur === b.id ? null : cur));
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                              מחק שלב
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => {
                    const id = uid();
                    setSalesFlowBlocks((prev) => [
                      ...prev,
                      { id, intro: "", question: "", options: ["", "", ""] },
                    ]);
                    setExpandedFlowBlockId(id);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  הוסף שלב במסלול
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ════════════════════ STEP 4 — פייסבוק ════════════════════ */}
        {step === 4 && isPremium ? (
          <Card>
            <CardHeader><CardTitle><StepHeader n={4} title="חיבור פייסבוק" desc="חבילה בסיסית + Pixel (פרימיום)" /></CardTitle></CardHeader>
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

        {/* ════════════════════ STEP 5 — פולואפ ════════════════════ */}
        {step === 5 && (
          <Card>
            <CardHeader>
              <CardTitle>
                <StepHeader n={5} title="פולואפ" desc="הודעות אוטומטיות לפי זמן/אירוע" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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
            step={step as 1 | 2 | 3 | 4 | 5}
            botName={botName}
            businessName={name}
            openingMediaUrl={openingMediaUrl}
            openingMediaType={openingMediaType}
            welcomeIntro={welcomeIntro}
            welcomeQuestion={welcomeQuestion}
            welcomeOptions={welcomeOptions}
            salesFlowBlocks={salesFlowBlocks.map((b) => ({
              intro: b.intro,
              question: b.question,
              options: b.options,
            }))}
            services={services.map((s) => ({ name: s.name, price_text: s.price_text }))}
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
            <Button onClick={() => void saveAll()} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {saving ? "שומר..." : "שמור הכל"}
            </Button>
          ) : (
            <Button
              disabled={saving}
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
      </div>
    </div>
  );
}
