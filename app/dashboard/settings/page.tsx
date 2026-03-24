"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Upload } from "lucide-react";
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
};
type FaqItem = { service_slug: string; question: string; answer: string };

const NICHE_SUGGESTIONS = ["Fitness", "Wellness", "Clinic", "Beauty", "Education", "Studio"];

function slugify(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9\u0590-\u05ff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
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
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const [business, setBusiness] = useState({
    slug: "",
    name: "",
    niche: "",
    website_url: "",
    business_description: "",
    bot_name: "זואי",
    logo_url: "",
    instagram: "",
    tiktok: "",
    facebook: "",
    youtube: "",
    whatsapp: "",
    primary_color: "#ff85cf",
    secondary_color: "#bc74e9",
    welcome_message: "שלום, כאן זואי. איך אפשר לעזור?",
    cta_text: "",
    cta_link: "",
  });
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [faqs, setFaqs] = useState<FaqItem[]>([]);

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
            bot_name: data.business.bot_name ?? "זואי",
            logo_url: data.business.logo_url ?? "",
            instagram: data.business.instagram ?? "",
            tiktok: data.business.tiktok ?? "",
            facebook: data.business.facebook ?? "",
            youtube: data.business.youtube ?? "",
            whatsapp: data.business.whatsapp ?? "",
            primary_color: data.business.primary_color ?? "#ff85cf",
            secondary_color: data.business.secondary_color ?? "#bc74e9",
            welcome_message: data.business.welcome_message ?? "שלום, כאן זואי. איך אפשר לעזור?",
            cta_text: data.business.cta_text ?? "",
            cta_link: data.business.cta_link ?? "",
          });
          setEnableGradient((data.business.secondary_color ?? "#bc74e9") !== (data.business.primary_color ?? "#ff85cf"));
        }
        setServices((data.services ?? []).map((s: Record<string, unknown>) => ({
          name: String(s.name ?? ""),
          description: String(s.description ?? ""),
          location_mode: String(s.location_mode ?? "online") as "online" | "location",
          location_text: String(s.location_text ?? ""),
          price_text: String(s.price_text ?? ""),
          service_slug: String(s.service_slug ?? ""),
        })));
        setFaqs((data.faqs ?? []).map((f: Record<string, unknown>) => ({
          service_slug: String(f.service_slug ?? ""),
          question: String(f.question ?? ""),
          answer: String(f.answer ?? ""),
        })));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (manualSlugEdit) return;
    const auto = slugify(business.name);
    setBusiness((prev) => ({ ...prev, slug: auto }));
  }, [business.name, manualSlugEdit]);

  useEffect(() => {
    const slug = slugify(business.slug);
    if (!slug) {
      setIsSlugAvailable(false);
      setSlugMessage("הסלאג ריק");
      return;
    }
    const t = window.setTimeout(() => {
      void fetch(
        `/api/dashboard/slug-check?slug=${encodeURIComponent(slug)}&current=${encodeURIComponent(business.slug)}`
      )
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

  const requiredBusinessNameMissing = business.name.trim().length === 0;
  const requiredSlugMissing = business.slug.trim().length === 0;
  const requiredWebsiteMissing = business.website_url.trim().length === 0;
  const hasOneValidService = services.some(
    (s) => s.name.trim().length > 0 && s.price_text.trim().length > 0
  );
  const requiredServiceMissing = !hasOneValidService;
  const canSaveForm =
    isSlugAvailable &&
    !requiredBusinessNameMissing &&
    !requiredSlugMissing &&
    !requiredWebsiteMissing &&
    !requiredServiceMissing;

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
      }),
    });
    const j = await res.json();
    if (j.welcome_message) setBusiness((b) => ({ ...b, welcome_message: j.welcome_message }));
  }

  async function generateFaqForService(service: ServiceItem) {
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
    const mapped = items.slice(0, 3).map((x: Record<string, unknown>) => ({
      service_slug: service.service_slug,
      question: String(x.question ?? ""),
      answer: String(x.answer ?? ""),
    })).filter((x: FaqItem) => x.question && x.answer);
    setFaqs((prev) => [...prev.filter((f) => f.service_slug !== service.service_slug), ...mapped]);
  }

  if (loading) return <main className="p-8">טוען הגדרות...</main>;

  return (
    <main className="min-h-screen bg-zinc-50 p-4 md:p-8">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>הגדרות עסק</CardTitle>
              <CardDescription>מלאו את כל שדות החובה המסומנים בכוכבית אדומה.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="text-sm font-medium">Business Name <span className="text-red-500">*</span></label>
              <Input
                className={triedSave && requiredBusinessNameMissing ? "border-red-500 focus-visible:ring-red-400" : ""}
                placeholder="הכנס שם עסק..."
                value={business.name}
                onChange={(e) => setBusiness({ ...business, name: e.target.value })}
              />

              <label className="text-sm font-medium">Business Slug <span className="text-red-500">*</span></label>
              <Input
                className={triedSave && requiredSlugMissing ? "border-red-500 focus-visible:ring-red-400" : ""}
                placeholder="הכנס סלאג עסק..."
                value={business.slug}
                onChange={(e) => {
                  setManualSlugEdit(true);
                  setBusiness({ ...business, slug: slugify(e.target.value) });
                }}
              />
              <p className={`text-xs ${isSlugAvailable ? "text-emerald-600" : "text-amber-600"}`}>{slugMessage}</p>

              <label className="text-sm font-medium">Website URL <span className="text-red-500">*</span></label>
              <Input
                className={triedSave && requiredWebsiteMissing ? "border-red-500 focus-visible:ring-red-400" : ""}
                placeholder="קישור לאתר..."
                value={business.website_url}
                onChange={(e) => setBusiness({ ...business, website_url: e.target.value })}
              />

              <Input placeholder="בחר נישה..." list="niche-suggestions" value={business.niche} onChange={(e) => setBusiness({ ...business, niche: e.target.value })} />
              <datalist id="niche-suggestions">{NICHE_SUGGESTIONS.map((n) => <option key={n} value={n} />)}</datalist>
              <Input placeholder="שם הבוט..." value={business.bot_name} onChange={(e) => setBusiness({ ...business, bot_name: e.target.value })} />
              <textarea className="w-full rounded-xl border border-zinc-300 p-3 text-sm" rows={3} placeholder="תיאור העסק..." value={business.business_description} onChange={(e) => setBusiness({ ...business, business_description: e.target.value })} />

              <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void uploadLogo(e.target.files?.[0] ?? null)} />
              <Button type="button" variant="outline" className="w-full border-dashed py-6" onClick={() => logoInputRef.current?.click()}>
                <Upload className="h-4 w-4" /> העלאת לוגו
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Visuals & Appearance</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <label className="text-sm font-medium">HEX צבע ראשי</label>
              <Input placeholder="#ff85cf" value={business.primary_color} onChange={(e) => setBusiness({ ...business, primary_color: e.target.value })} />
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={enableGradient} onChange={(e) => setEnableGradient(e.target.checked)} />
                Enable Gradient
              </label>
              {enableGradient && (
                <>
                  <label className="text-sm font-medium">HEX צבע משני</label>
                  <Input placeholder="#bc74e9" value={business.secondary_color} onChange={(e) => setBusiness({ ...business, secondary_color: e.target.value })} />
                </>
              )}
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <Input placeholder="טקסט CTA..." value={business.cta_text} onChange={(e) => setBusiness({ ...business, cta_text: e.target.value })} />
                <Input placeholder="קישור CTA..." value={business.cta_link} onChange={(e) => setBusiness({ ...business, cta_link: e.target.value })} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>הודעת פתיחה חכמה</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <textarea className="w-full rounded-xl border border-zinc-300 p-3 text-sm" rows={3} value={business.welcome_message} onChange={(e) => setBusiness({ ...business, welcome_message: e.target.value })} placeholder="הכנס הודעת פתיחה..." />
              <Button variant="outline" onClick={generateWelcome}><Sparkles className="h-4 w-4" /> יצירה חכמה</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>שירותים ומוצרים</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {services.map((s, i) => {
                const serviceFaqs = faqs.filter((f) => f.service_slug === s.service_slug);
                return (
                  <details key={`${s.service_slug}-${i}`} className="rounded-xl border border-zinc-200 p-3">
                    <summary className="cursor-pointer text-sm font-medium">{s.name || `מוצר ${i + 1}`}</summary>
                    <div className="mt-3 space-y-2">
                      <label className="text-sm font-medium">Product Name <span className="text-red-500">*</span></label>
                      <Input
                        className={triedSave && s.name.trim().length === 0 ? "border-red-500 focus-visible:ring-red-400" : ""}
                        placeholder="הכנס שם מוצר..."
                        value={s.name}
                        onChange={(e) => setServices((prev) => prev.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))}
                      />
                      <Input placeholder="הכנס סלאג מוצר..." value={s.service_slug} onChange={(e) => setServices((prev) => prev.map((x, idx) => idx === i ? { ...x, service_slug: slugify(e.target.value) } : x))} />
                      <textarea className="w-full rounded-xl border border-zinc-300 p-3 text-sm" rows={2} placeholder="תיאור המוצר..." value={s.description} onChange={(e) => setServices((prev) => prev.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))} />
                      <Input placeholder="מיקום / אונליין..." value={s.location_text} onChange={(e) => setServices((prev) => prev.map((x, idx) => idx === i ? { ...x, location_text: e.target.value } : x))} />
                      <label className="text-sm font-medium">Product Price <span className="text-red-500">*</span></label>
                      <Input
                        className={triedSave && s.price_text.trim().length === 0 ? "border-red-500 focus-visible:ring-red-400" : ""}
                        placeholder="הכנס מחיר מוצר..."
                        value={s.price_text}
                        onChange={(e) => setServices((prev) => prev.map((x, idx) => idx === i ? { ...x, price_text: e.target.value } : x))}
                      />
                      <Button variant="outline" onClick={() => generateFaqForService(s)}><Sparkles className="h-4 w-4" /> Generate Questions</Button>

                      <div className="rounded-xl border border-zinc-200 p-3 space-y-2">
                        <p className="text-sm font-medium">FAQ Manager</p>
                        {serviceFaqs.map((f, fIdx) => (
                          <div key={`${f.service_slug}-${fIdx}`} className="rounded-lg border border-zinc-200 p-2 space-y-2">
                            <Input
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
                              className="w-full rounded-xl border border-zinc-300 p-3 text-sm"
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
              <Button variant="outline" onClick={() => setServices((prev) => [...prev, { name: "", description: "", location_mode: "online", location_text: "", price_text: "", service_slug: "" }])}>
                + הוספת מוצר
              </Button>
              {triedSave && requiredServiceMissing ? (
                <p className="text-xs text-red-600">
                  חובה לפחות מוצר אחד עם שם ומחיר.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Social Media</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Input placeholder="Instagram URL..." value={business.instagram} onChange={(e) => setBusiness({ ...business, instagram: e.target.value })} />
              <Input placeholder="TikTok URL..." value={business.tiktok} onChange={(e) => setBusiness({ ...business, tiktok: e.target.value })} />
              <Input placeholder="Facebook URL..." value={business.facebook} onChange={(e) => setBusiness({ ...business, facebook: e.target.value })} />
              <Input placeholder="YouTube URL..." value={business.youtube} onChange={(e) => setBusiness({ ...business, youtube: e.target.value })} />
              <Input placeholder="WhatsApp URL..." value={business.whatsapp} onChange={(e) => setBusiness({ ...business, whatsapp: e.target.value })} />
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button onClick={saveAll} disabled={saving || !canSaveForm}>
              {saving ? "שומר..." : "שמירת הגדרות"}
            </Button>
            {status ? <p className="text-sm text-zinc-500">{status}</p> : null}
          </div>
        </div>

        <div>
          <Card className="sticky top-4">
            <CardHeader><CardTitle>תצוגה חיה של Zoe</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-2xl border border-zinc-200 bg-[#120c18] p-4 text-white">
                <div className="h-1 rounded-full" style={gradientStyle} />
                <p className="mt-3 text-sm text-white/90">{business.welcome_message || "שלום! איך אפשר לעזור?"}</p>
                <button className="mt-4 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white" style={gradientStyle}>
                  {business.cta_text || "הרשמה לשיעור ניסיון"}
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
