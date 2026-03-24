"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  CirclePlay,
  MessageCircle,
  Music,
  Sparkles,
  Upload,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ServiceItem = {
  name: string;
  description: string;
  location_mode: "online" | "location";
  location_text: string;
  price_text: string;
  service_slug: string;
  cta_text: string;
  cta_link: string;
};

type FaqItem = { service_slug: string; question: string; answer: string };

const NICHE_SUGGESTIONS = ["Fitness", "Wellness", "Clinic", "Beauty", "Education", "Studio"];
const VIBE_OPTIONS = ["חברי", "מקצועי", "מצחיק", "רוחני", "יוקרתי", "ישיר", "אמפתי", "סמכותי"];

const PRODUCT_SLUG_MAP: Array<[RegExp, string]> = [
  [/שיעור\s*יוגה/g, "yoga-class"],
  [/יוגה/g, "yoga"],
  [/פילאטיס/g, "pilates"],
  [/אימון/g, "training"],
  [/טיפול/g, "therapy"],
  [/סדנה/g, "workshop"],
  [/ייעוץ/g, "consulting"],
];

function slugify(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9\u0590-\u05ff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function toProductSlug(raw: string) {
  let text = raw.toLowerCase().trim();
  for (const [re, to] of PRODUCT_SLUG_MAP) text = text.replace(re, ` ${to} `);
  text = text
    .replace(/[א]/g, "a")
    .replace(/[ב]/g, "b")
    .replace(/[ג]/g, "g")
    .replace(/[ד]/g, "d")
    .replace(/[ה]/g, "h")
    .replace(/[ו]/g, "v")
    .replace(/[ז]/g, "z")
    .replace(/[ח]/g, "ch")
    .replace(/[ט]/g, "t")
    .replace(/[י]/g, "y")
    .replace(/[כך]/g, "k")
    .replace(/[ל]/g, "l")
    .replace(/[מם]/g, "m")
    .replace(/[נן]/g, "n")
    .replace(/[ס]/g, "s")
    .replace(/[ע]/g, "a")
    .replace(/[פף]/g, "p")
    .replace(/[צץ]/g, "tz")
    .replace(/[קר]/g, "k")
    .replace(/[ר]/g, "r")
    .replace(/[ש]/g, "sh")
    .replace(/[ת]/g, "t");
  return slugify(text);
}

function SocialInput({
  value,
  onChange,
  placeholder,
  icon,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        dir="rtl"
        className="text-right placeholder:text-right"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="text-zinc-500">{icon}</div>
    </div>
  );
}

function TagInput({
  title,
  tags,
  onChange,
  suggestions,
}: {
  title: string;
  tags: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
}) {
  const [input, setInput] = useState("");

  function addTag(raw: string) {
    const t = raw.trim();
    if (!t || tags.includes(t)) return;
    onChange([...tags, t]);
    setInput("");
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{title}</label>
      <Input
        dir="rtl"
        className="text-right placeholder:text-right"
        placeholder="הקלד ערך ולחץ Enter..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addTag(input);
          }
        }}
      />
      <div className="flex flex-wrap gap-2 justify-end">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-zinc-50 px-3 py-1 text-xs">
            <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))}>
              <X className="h-3 w-3" />
            </button>
            {t}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 justify-end">
        {suggestions.filter((s) => !tags.includes(s)).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => addTag(s)}
            className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-3 py-1 text-xs text-fuchsia-700"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function DashboardSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [slugMessage, setSlugMessage] = useState("");
  const [isSlugAvailable, setIsSlugAvailable] = useState(true);
  const [manualSlugEdit, setManualSlugEdit] = useState(false);
  const [enableGradient, setEnableGradient] = useState(true);
  const [triedSave, setTriedSave] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [fetchingSite, setFetchingSite] = useState(false);
  const [faqLoadingServiceSlug, setFaqLoadingServiceSlug] = useState<string | null>(null);
  const [addressSuggestions, setAddressSuggestions] = useState<Record<number, string[]>>({});

  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const [business, setBusiness] = useState({
    slug: "",
    name: "",
    niche: "",
    website_url: "",
    business_description: "",
    bot_name: "",
    logo_url: "",
    instagram: "",
    tiktok: "",
    facebook: "",
    youtube: "",
    whatsapp: "",
    target_audience: [] as string[],
    benefits: [] as string[],
    vibe: [] as string[],
    schedule_text: "",
    primary_color: "#ff85cf",
    secondary_color: "#bc74e9",
    welcome_message: "נעים להכיר, אני זואי כאן ללוות אותך בדרך שלך.",
  });

  const [services, setServices] = useState<ServiceItem[]>([]);
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [smartTagSuggestions, setSmartTagSuggestions] = useState<{
    target_audience: string[];
    benefits: string[];
    vibe: string[];
  }>({ target_audience: [], benefits: [], vibe: VIBE_OPTIONS });

  const gradientStyle = useMemo(
    () =>
      enableGradient
        ? { backgroundImage: `linear-gradient(105deg, ${business.primary_color} 0%, ${business.secondary_color} 100%)` }
        : { backgroundColor: business.primary_color },
    [business.primary_color, business.secondary_color, enableGradient]
  );

  useEffect(() => {
    void fetch("/api/dashboard/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.business) {
          setBusiness({
            slug: data.business.slug ?? "",
            name: data.business.name ?? "",
            niche: data.business.niche ?? "",
            website_url: data.business.website_url ?? "",
            business_description: data.business.business_description ?? "",
            bot_name: data.business.bot_name ?? "",
            logo_url: data.business.logo_url ?? "",
            instagram: data.business.instagram ?? "",
            tiktok: data.business.tiktok ?? "",
            facebook: data.business.facebook ?? "",
            youtube: data.business.youtube ?? "",
            whatsapp: data.business.whatsapp ?? "",
            target_audience: Array.isArray(data.business.target_audience) ? data.business.target_audience : [],
            benefits: Array.isArray(data.business.benefits) ? data.business.benefits : [],
            vibe: Array.isArray(data.business.vibe) ? data.business.vibe : [],
            schedule_text: data.business.schedule_text ?? "",
            primary_color: data.business.primary_color ?? "#ff85cf",
            secondary_color: data.business.secondary_color ?? "#bc74e9",
            welcome_message: data.business.welcome_message ?? "נעים להכיר, אני זואי כאן ללוות אותך בדרך שלך.",
          });
          setEnableGradient((data.business.secondary_color ?? "#bc74e9") !== (data.business.primary_color ?? "#ff85cf"));
        }

        setServices(
          (data.services ?? []).map((s: Record<string, unknown>) => ({
            name: String(s.name ?? ""),
            description: String(s.description ?? ""),
            location_mode: String(s.location_mode ?? "online") as "online" | "location",
            location_text: String(s.location_text ?? ""),
            price_text: String(s.price_text ?? ""),
            service_slug: String(s.service_slug ?? ""),
            cta_text: "",
            cta_link: "",
          }))
        );
        setFaqs(
          (data.faqs ?? []).map((f: Record<string, unknown>) => ({
            service_slug: String(f.service_slug ?? ""),
            question: String(f.question ?? ""),
            answer: String(f.answer ?? ""),
          }))
        );
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (manualSlugEdit) return;
    setBusiness((prev) => ({ ...prev, slug: slugify(business.name) }));
  }, [business.name, manualSlugEdit]);

  useEffect(() => {
    const slug = slugify(business.slug);
    if (!slug) {
      setIsSlugAvailable(false);
      setSlugMessage("הסלאג ריק");
      return;
    }
    const t = window.setTimeout(() => {
      void fetch(`/api/dashboard/slug-check?slug=${encodeURIComponent(slug)}&current=${encodeURIComponent(business.slug)}`)
        .then((r) => r.json())
        .then((j) => {
          if (typeof j.slug === "string" && j.slug && j.slug !== business.slug) {
            setBusiness((prev) => ({ ...prev, slug: j.slug }));
          }
          setIsSlugAvailable(Boolean(j.slug));
          setSlugMessage(String(j.message ?? ""));
        })
        .catch(() => {
          setIsSlugAvailable(false);
          setSlugMessage("שגיאה בבדיקת זמינות סלאג");
        });
    }, 300);
    return () => clearTimeout(t);
  }, [business.slug]);

  useEffect(() => {
    if (!business.name.trim() || !business.niche.trim()) return;
    const t = window.setTimeout(() => {
      void fetch("/api/dashboard/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "tags", business_name: business.name, niche: business.niche }),
      })
        .then((r) => r.json())
        .then((j) =>
          setSmartTagSuggestions({
            target_audience: Array.isArray(j.target_audience) ? j.target_audience : [],
            benefits: Array.isArray(j.benefits) ? j.benefits : [],
            vibe: Array.isArray(j.vibe) ? j.vibe : VIBE_OPTIONS,
          })
        )
        .catch(() => void 0);
    }, 500);
    return () => clearTimeout(t);
  }, [business.name, business.niche]);

  const requiredBusinessNameMissing = business.name.trim().length === 0;
  const requiredSlugMissing = business.slug.trim().length === 0;
  const requiredServiceMissing = !services.some((s) => s.name.trim().length > 0 && s.price_text.trim().length > 0);
  const canSaveForm = isSlugAvailable && !requiredBusinessNameMissing && !requiredSlugMissing && !requiredServiceMissing;

  async function saveAll() {
    setTriedSave(true);
    if (!canSaveForm) {
      setStatus("יש למלא את כל שדות החובה לפני שמירה.");
      return;
    }
    setSaving(true);
    setStatus("");

    const payload = {
      business: {
        ...business,
        secondary_color: enableGradient ? business.secondary_color : business.primary_color,
        social_links: {
          website_url: business.website_url.trim(),
          business_description: business.business_description.trim(),
          instagram: business.instagram.trim(),
          tiktok: business.tiktok.trim(),
          facebook: business.facebook.trim(),
          youtube: business.youtube.trim(),
          whatsapp: business.whatsapp.trim(),
          target_audience: business.target_audience,
          benefits: business.benefits,
          vibe: business.vibe,
          schedule_text: business.schedule_text,
        },
      },
      services,
      faqs,
    };

    const res = await fetch("/api/dashboard/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) {
      setStatus("Saved successfully.");
      setShowSuccessToast(true);
      window.setTimeout(() => setShowSuccessToast(false), 2600);
    } else {
      setStatus(`Save failed: ${j.error ?? "unknown error"}`);
    }
    setSaving(false);
  }

  async function uploadLogo(file: File | null) {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/dashboard/upload-logo", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.url) {
      setBusiness((b) => ({ ...b, logo_url: j.url }));
      setStatus("Logo uploaded.");
    } else {
      setStatus(`Logo upload failed: ${j.error ?? "unknown"}`);
    }
  }

  async function fetchFromWebsite() {
    if (!business.website_url.trim()) {
      setStatus("יש להזין כתובת אתר קודם.");
      return;
    }
    setFetchingSite(true);
    const res = await fetch("/api/dashboard/fetch-site", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        website_url: business.website_url,
        business_name: business.name,
        niche: business.niche,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) {
      setBusiness((prev) => ({
        ...prev,
        business_description:
          typeof j.business_description === "string" && j.business_description.trim()
            ? j.business_description
            : prev.business_description,
        target_audience: Array.isArray(j.target_audience) ? j.target_audience : prev.target_audience,
        benefits: Array.isArray(j.benefits) ? j.benefits : prev.benefits,
      }));
      setStatus("המידע נמשך מהאתר בהצלחה.");
    } else {
      setStatus(`משיכה מהאתר נכשלה: ${j.error ?? "unknown"}`);
    }
    setFetchingSite(false);
  }

  async function parseScheduleFromFile(file: File | null) {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/dashboard/parse-schedule", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.schedule_text) {
      setBusiness((b) => ({ ...b, schedule_text: String(j.schedule_text) }));
      setStatus("שעות הפעילות זוהו מהקובץ.");
    } else {
      setStatus("לא הצלחנו לקרוא את הקובץ, אנא הזן שעות ידנית");
    }
  }

  async function generateWelcome() {
    const res = await fetch("/api/dashboard/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "welcome",
        business_name: business.name,
        niche: business.niche,
        website_url: business.website_url,
        business_description: business.business_description,
        target_audience: business.target_audience,
        benefits: business.benefits,
        vibe: business.vibe,
        schedule_text: business.schedule_text,
      }),
    });
    const j = await res.json();
    if (j.welcome_message) setBusiness((b) => ({ ...b, welcome_message: j.welcome_message }));
  }

  async function generateFaqForService(service: ServiceItem) {
    setFaqLoadingServiceSlug(service.service_slug || "__new__");
    const res = await fetch("/api/dashboard/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "faq",
        business_name: business.name,
        niche: business.niche,
        service_name: service.name,
        service_description: service.description,
      }),
    });
    const j = await res.json();
    const items = Array.isArray(j.items) ? j.items : [];
    const mapped = items
      .slice(0, 3)
      .map((x: Record<string, unknown>) => ({
        service_slug: service.service_slug,
        question: String(x.question ?? ""),
        answer: String(x.answer ?? ""),
      }))
      .filter((x: FaqItem) => x.question && x.answer);
    setFaqs((prev) => [...prev.filter((f) => f.service_slug !== service.service_slug), ...mapped]);
    setFaqLoadingServiceSlug(null);
  }

  async function lookupAddress(index: number, query: string) {
    const q = query.trim();
    if (q.length < 3) {
      setAddressSuggestions((prev) => ({ ...prev, [index]: [] }));
      return;
    }
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&accept-language=he&q=${encodeURIComponent(q)}`
      );
      const rows = (await res.json()) as Array<{ display_name?: string }>;
      setAddressSuggestions((prev) => ({
        ...prev,
        [index]: rows
          .map((r) => r.display_name ?? "")
          .filter(Boolean)
          .slice(0, 5),
      }));
    } catch {
      setAddressSuggestions((prev) => ({ ...prev, [index]: [] }));
    }
  }

  if (loading) return <main className="p-8">טוען הגדרות...</main>;

  return (
    <main dir="rtl" className="min-h-screen bg-zinc-50 p-4 md:p-8 text-right">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>הגדרות עסק</CardTitle>
              <CardDescription>מלאו את כל שדות החובה המסומנים בכוכבית אדומה.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="text-sm font-medium">שם העסק <span className="text-red-500">*</span></label>
              <Input
                dir="rtl"
                className={`${triedSave && requiredBusinessNameMissing ? "border-red-500 focus-visible:ring-red-400" : ""} text-right placeholder:text-right`}
                placeholder="הכנס שם עסק..."
                value={business.name}
                onChange={(e) => setBusiness({ ...business, name: e.target.value })}
              />

              <label className="text-sm font-medium">סלאג העסק <span className="text-red-500">*</span></label>
              <Input
                dir="rtl"
                className={`${triedSave && requiredSlugMissing ? "border-red-500 focus-visible:ring-red-400" : ""} text-right placeholder:text-right`}
                placeholder="הכנס סלאג עסק..."
                value={business.slug}
                onChange={(e) => {
                  setManualSlugEdit(true);
                  setBusiness({ ...business, slug: slugify(e.target.value) });
                }}
              />
              <p className={`text-xs ${isSlugAvailable ? "text-emerald-600" : "text-amber-600"}`}>{slugMessage}</p>

              <label className="text-sm font-medium">כתובת אתר (אופציונלי)</label>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={fetchFromWebsite} disabled={fetchingSite}>
                  {fetchingSite ? "מושך..." : "משוך מידע מהאתר"}
                </Button>
                <Input
                  dir="rtl"
                  className="text-right placeholder:text-right"
                  placeholder="קישור לאתר..."
                  value={business.website_url}
                  onChange={(e) => setBusiness({ ...business, website_url: e.target.value })}
                />
              </div>

              <Input dir="rtl" className="text-right placeholder:text-right" placeholder="בחר נישה..." list="niche-suggestions" value={business.niche} onChange={(e) => setBusiness({ ...business, niche: e.target.value })} />
              <datalist id="niche-suggestions">{NICHE_SUGGESTIONS.map((n) => <option key={n} value={n} />)}</datalist>
              <Input dir="rtl" className="text-right placeholder:text-right" placeholder="בחר שם לבוט (ברירת מחדל: זואי)" value={business.bot_name} onChange={(e) => setBusiness({ ...business, bot_name: e.target.value })} />
              <textarea className="w-full rounded-xl border border-zinc-300 p-3 text-sm text-right placeholder:text-right" rows={3} placeholder="תיאור העסק..." value={business.business_description} onChange={(e) => setBusiness({ ...business, business_description: e.target.value })} />

              <TagInput title="קהל יעד" tags={business.target_audience} suggestions={smartTagSuggestions.target_audience} onChange={(next) => setBusiness((prev) => ({ ...prev, target_audience: next }))} />
              <TagInput title="מה משיגים מהשירות שלך?" tags={business.benefits} suggestions={smartTagSuggestions.benefits} onChange={(next) => setBusiness((prev) => ({ ...prev, benefits: next }))} />
              <div className="space-y-2">
                <label className="text-sm font-medium">סגנון דיבור</label>
                <div className="flex flex-wrap justify-end gap-2">
                  {[...new Set([...VIBE_OPTIONS, ...smartTagSuggestions.vibe])].map((v) => {
                    const active = business.vibe.includes(v);
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() =>
                          setBusiness((prev) => ({
                            ...prev,
                            vibe: active ? prev.vibe.filter((x) => x !== v) : [...prev.vibe, v],
                          }))
                        }
                        className={`rounded-full border px-3 py-1 text-xs transition ${
                          active
                            ? "border-fuchsia-500 bg-fuchsia-500 text-white"
                            : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                        }`}
                      >
                        {v}
                      </button>
                    );
                  })}
                </div>
              </div>

              <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void uploadLogo(e.target.files?.[0] ?? null)} />
              <Button type="button" variant="outline" className="w-full border-dashed py-6" onClick={() => logoInputRef.current?.click()}>
                <Upload className="h-4 w-4" /> העלאת לוגו
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>שירותים ומוצרים</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {services.map((s, i) => {
                const serviceFaqs = faqs.filter((f) => f.service_slug === s.service_slug);
                return (
                  <details key={`${s.service_slug}-${i}`} className="rounded-xl border border-zinc-200 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-right">{s.name || `מוצר ${i + 1}`}</summary>
                    <div className="mt-3 space-y-2">
                      <label className="text-sm font-medium">שם מוצר <span className="text-red-500">*</span></label>
                      <Input
                        dir="rtl"
                        className={`text-right placeholder:text-right ${triedSave && s.name.trim().length === 0 ? "border-red-500 focus-visible:ring-red-400" : ""}`}
                        placeholder="הכנס שם מוצר..."
                        value={s.name}
                        onChange={(e) =>
                          setServices((prev) =>
                            prev.map((x, idx) =>
                              idx === i
                                ? {
                                    ...x,
                                    name: e.target.value,
                                    service_slug: x.service_slug || toProductSlug(e.target.value),
                                  }
                                : x
                            )
                          )
                        }
                      />
                      <Input dir="rtl" className="text-right placeholder:text-right" placeholder="סלאג מוצר (לטיני)..." value={s.service_slug} onChange={(e) => setServices((prev) => prev.map((x, idx) => idx === i ? { ...x, service_slug: toProductSlug(e.target.value) } : x))} />
                      <textarea className="w-full rounded-xl border border-zinc-300 p-3 text-sm text-right placeholder:text-right" rows={2} placeholder="תיאור המוצר..." value={s.description} onChange={(e) => setServices((prev) => prev.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))} />
                      <Input
                        dir="rtl"
                        className="text-right placeholder:text-right"
                        placeholder="כתובת או מיקום..."
                        value={s.location_text}
                        onChange={(e) => {
                          const value = e.target.value;
                          setServices((prev) => prev.map((x, idx) => idx === i ? { ...x, location_text: value } : x));
                          void lookupAddress(i, value);
                        }}
                      />
                      {(addressSuggestions[i] ?? []).length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {addressSuggestions[i].map((addr) => (
                            <button
                              key={addr}
                              type="button"
                              className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-right hover:bg-zinc-100"
                              onClick={() => {
                                setServices((prev) => prev.map((x, idx) => idx === i ? { ...x, location_text: addr } : x));
                                setAddressSuggestions((prev) => ({ ...prev, [i]: [] }));
                              }}
                            >
                              {addr}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <label className="text-sm font-medium">מחיר מוצר <span className="text-red-500">*</span></label>
                      <Input
                        dir="rtl"
                        className={`text-right placeholder:text-right ${triedSave && s.price_text.trim().length === 0 ? "border-red-500 focus-visible:ring-red-400" : ""}`}
                        placeholder="הכנס מחיר מוצר..."
                        value={s.price_text}
                        onChange={(e) => setServices((prev) => prev.map((x, idx) => idx === i ? { ...x, price_text: e.target.value } : x))}
                      />
                      <label className="text-sm font-medium">הנעה לפעולה</label>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <Input dir="rtl" className="text-right placeholder:text-right" placeholder="טקסט הנעה לפעולה..." value={s.cta_text} onChange={(e) => setServices((prev) => prev.map((x, idx) => idx === i ? { ...x, cta_text: e.target.value } : x))} />
                        <Input dir="rtl" className="text-right placeholder:text-right" placeholder="קישור הנעה לפעולה..." value={s.cta_link} onChange={(e) => setServices((prev) => prev.map((x, idx) => idx === i ? { ...x, cta_link: e.target.value } : x))} />
                      </div>
                      <Button variant="outline" onClick={() => generateFaqForService(s)}>
                        <Sparkles className="h-4 w-4" /> יצירת שאלות חכמות
                      </Button>

                      <div className="rounded-xl border border-zinc-200 p-3 space-y-2">
                        <p className="text-sm font-medium">מנהל שאלות נפוצות</p>
                        {serviceFaqs.map((f, fIdx) => (
                          <div key={`${f.service_slug}-${fIdx}`} className="rounded-lg border border-zinc-200 p-2 space-y-2">
                            <Input
                              dir="rtl"
                              className="text-right placeholder:text-right"
                              placeholder="הכנס שאלה..."
                              value={f.question}
                              onChange={(e) =>
                                setFaqs((prev) => {
                                  const target = prev.findIndex((x) => x.service_slug === s.service_slug && x.question === f.question && x.answer === f.answer);
                                  if (target < 0) return prev;
                                  return prev.map((x, idx) => (idx === target ? { ...x, question: e.target.value } : x));
                                })
                              }
                            />
                            <textarea
                              className="w-full rounded-xl border border-zinc-300 p-3 text-sm text-right placeholder:text-right"
                              rows={2}
                              placeholder="הכנס תשובה..."
                              value={f.answer}
                              onChange={(e) =>
                                setFaqs((prev) => {
                                  const target = prev.findIndex((x) => x.service_slug === s.service_slug && x.question === f.question && x.answer === f.answer);
                                  if (target < 0) return prev;
                                  return prev.map((x, idx) => (idx === target ? { ...x, answer: e.target.value } : x));
                                })
                              }
                            />
                          </div>
                        ))}
                        <Button variant="outline" onClick={() => setFaqs((prev) => [...prev, { service_slug: s.service_slug, question: "", answer: "" }])}>
                          + הוספת שאלה
                        </Button>
                      </div>
                    </div>
                  </details>
                );
              })}
              <Button variant="outline" onClick={() => setServices((prev) => [...prev, { name: "", description: "", location_mode: "online", location_text: "", price_text: "", service_slug: "", cta_text: "", cta_link: "" }])}>
                + הוספת מוצר
              </Button>
              {triedSave && requiredServiceMissing ? <p className="text-xs text-red-600">חובה לפחות מוצר אחד עם שם ומחיר.</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>עיצוב ונראות</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <label className="text-sm font-medium">HEX צבע ראשי</label>
              <div className="flex items-center justify-end gap-2">
                <button type="button" className="h-9 w-9 rounded-md border border-zinc-300" style={{ backgroundColor: business.primary_color }} onClick={() => (document.getElementById("primary-picker") as HTMLInputElement | null)?.click()} />
                <Input dir="rtl" className="text-right placeholder:text-right" placeholder="#ff85cf" value={business.primary_color} onChange={(e) => setBusiness({ ...business, primary_color: e.target.value })} />
                <input id="primary-picker" type="color" className="hidden" value={business.primary_color} onChange={(e) => setBusiness({ ...business, primary_color: e.target.value })} />
              </div>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={enableGradient} onChange={(e) => setEnableGradient(e.target.checked)} />
                הפעל גרדיאנט
              </label>
              {enableGradient && (
                <div className="flex items-center justify-end gap-2">
                  <button type="button" className="h-9 w-9 rounded-md border border-zinc-300" style={{ backgroundColor: business.secondary_color }} onClick={() => (document.getElementById("secondary-picker") as HTMLInputElement | null)?.click()} />
                  <Input dir="rtl" className="text-right placeholder:text-right" placeholder="#bc74e9" value={business.secondary_color} onChange={(e) => setBusiness({ ...business, secondary_color: e.target.value })} />
                  <input id="secondary-picker" type="color" className="hidden" value={business.secondary_color} onChange={(e) => setBusiness({ ...business, secondary_color: e.target.value })} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>הודעת פתיחה חכמה</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <textarea className="w-full rounded-xl border border-zinc-300 p-3 text-sm text-right placeholder:text-right" rows={3} value={business.welcome_message} onChange={(e) => setBusiness({ ...business, welcome_message: e.target.value })} placeholder="הכנס הודעת פתיחה..." />
              <Button variant="outline" onClick={generateWelcome}><Sparkles className="h-4 w-4" /> יצירת פתיח חכם</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>שעות פעילות</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-end">
                <label className="cursor-pointer rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm hover:bg-zinc-50">
                  העלאת קובץ שעות
                  <input type="file" className="hidden" accept="image/*,.pdf,.txt" onChange={(e) => void parseScheduleFromFile(e.target.files?.[0] ?? null)} />
                </label>
              </div>
              <textarea className="w-full rounded-xl border border-zinc-300 p-3 text-sm text-right placeholder:text-right" rows={6} placeholder={`יום שני: ...\nיום שלישי: ...\nיום רביעי: ...\nיום חמישי: ...\nיום שישי: ...\nשבת: ...\nראשון: ...`} value={business.schedule_text} onChange={(e) => setBusiness({ ...business, schedule_text: e.target.value })} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>רשתות חברתיות</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <SocialInput placeholder="קישור לאינסטגרם..." value={business.instagram} onChange={(v) => setBusiness({ ...business, instagram: v })} icon={<AtSign className="h-4 w-4" />} />
              <SocialInput placeholder="קישור לטיקטוק..." value={business.tiktok} onChange={(v) => setBusiness({ ...business, tiktok: v })} icon={<Music className="h-4 w-4" />} />
              <SocialInput placeholder="קישור לפייסבוק..." value={business.facebook} onChange={(v) => setBusiness({ ...business, facebook: v })} icon={<Users className="h-4 w-4" />} />
              <SocialInput placeholder="קישור ליוטיוב..." value={business.youtube} onChange={(v) => setBusiness({ ...business, youtube: v })} icon={<CirclePlay className="h-4 w-4" />} />
              <SocialInput placeholder="קישור לוואטסאפ..." value={business.whatsapp} onChange={(v) => setBusiness({ ...business, whatsapp: v })} icon={<MessageCircle className="h-4 w-4" />} />
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button onClick={saveAll} disabled={saving || !canSaveForm}>{saving ? "שומר..." : "שמירת הגדרות"}</Button>
            {status ? <p className="text-sm text-zinc-500">{status}</p> : null}
          </div>
        </div>

        <div>
          <Card className="sticky top-4">
            <CardHeader><CardTitle>תצוגה חיה של Zoe</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-2xl border border-zinc-200 bg-[#120c18] p-4 text-white">
                {faqLoadingServiceSlug ? (
                  <div className="mb-2 text-xs text-white/70">מעדכן שאלות חכמות...</div>
                ) : null}
                <div className="h-1 rounded-full" style={gradientStyle} />
                <p className="mt-3 text-sm text-white/90 text-right">
                  {business.welcome_message || `נעים להכיר, אני ${business.bot_name || "זואי"} כאן ללוות אותך.`}
                </p>
                <button className="mt-4 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white" style={gradientStyle}>
                  {services.find((s) => s.cta_text.trim())?.cta_text || "הרשמה לשיעור ניסיון"}
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      {showSuccessToast ? (
        <div className="fixed bottom-4 right-4 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
          ההגדרות נשמרו בהצלחה
        </div>
      ) : null}
    </main>
  );
}
