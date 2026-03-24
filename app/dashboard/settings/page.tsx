"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
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

export default function DashboardSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const [business, setBusiness] = useState({
    slug: "",
    name: "",
    niche: "",
    bot_name: "זואי",
    logo_url: "",
    social_links_text: "",
    primary_color: "#ff85cf",
    secondary_color: "#bc74e9",
    welcome_message: "שלום, כאן זואי. איך אפשר לעזור?",
    cta_text: "",
    cta_link: "",
  });
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [faqs, setFaqs] = useState<FaqItem[]>([]);

  const gradientStyle = useMemo(
    () => ({ backgroundImage: `linear-gradient(105deg, ${business.primary_color} 0%, ${business.secondary_color} 100%)` }),
    [business.primary_color, business.secondary_color]
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
            bot_name: data.business.bot_name ?? "זואי",
            logo_url: data.business.logo_url ?? "",
            social_links_text: Array.isArray(data.business.social_links) ? data.business.social_links.join(", ") : "",
            primary_color: data.business.primary_color ?? "#ff85cf",
            secondary_color: data.business.secondary_color ?? "#bc74e9",
            welcome_message: data.business.welcome_message ?? "שלום, כאן זואי. איך אפשר לעזור?",
            cta_text: data.business.cta_text ?? "",
            cta_link: data.business.cta_link ?? "",
          });
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

  async function saveAll() {
    setSaving(true);
    setStatus("");
    const payload = {
      business: {
        ...business,
        social_links: business.social_links_text.split(",").map((x) => x.trim()).filter(Boolean),
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
    setStatus(res.ok ? "Saved successfully." : `Save failed: ${j.error ?? "unknown error"}`);
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
      body: JSON.stringify({ mode: "welcome", business_name: business.name, niche: business.niche }),
    });
    const j = await res.json();
    if (j.welcome_message) setBusiness((b) => ({ ...b, welcome_message: j.welcome_message }));
  }

  async function generateFaqForService(service: ServiceItem) {
    const res = await fetch("/api/dashboard/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "faq", business_name: business.name, niche: business.niche, service_name: service.name }),
    });
    const j = await res.json();
    const items = Array.isArray(j.items) ? j.items : [];
    const mapped = items.slice(0, 4).map((x: Record<string, unknown>) => ({
      service_slug: service.service_slug,
      question: String(x.question ?? ""),
      answer: String(x.answer ?? ""),
    })).filter((x: FaqItem) => x.question && x.answer);
    setFaqs((prev) => [...prev.filter((f) => f.service_slug !== service.service_slug), ...mapped]);
  }

  if (loading) return <main className="p-8">Loading settings...</main>;

  return (
    <main className="min-h-screen bg-zinc-50 p-4 md:p-8">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>General Info</CardTitle><CardDescription>Business identity and branding</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Business Slug" value={business.slug} onChange={(e) => setBusiness({ ...business, slug: e.target.value.toLowerCase() })} />
              <Input placeholder="Business Name" value={business.name} onChange={(e) => setBusiness({ ...business, name: e.target.value })} />
              <Input placeholder="Niche (e.g. Wellness)" list="niche-suggestions" value={business.niche} onChange={(e) => setBusiness({ ...business, niche: e.target.value })} />
              <datalist id="niche-suggestions">{NICHE_SUGGESTIONS.map((n) => <option key={n} value={n} />)}</datalist>
              <Input placeholder="Bot Name" value={business.bot_name} onChange={(e) => setBusiness({ ...business, bot_name: e.target.value })} />
              <Input placeholder="Logo URL (or uploaded URL)" value={business.logo_url} onChange={(e) => setBusiness({ ...business, logo_url: e.target.value })} />
              <Input type="file" accept="image/*" onChange={(e) => void uploadLogo(e.target.files?.[0] ?? null)} />
              <Input placeholder="Social links (comma separated)" value={business.social_links_text} onChange={(e) => setBusiness({ ...business, social_links_text: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm">Primary <Input type="color" value={business.primary_color} onChange={(e) => setBusiness({ ...business, primary_color: e.target.value })} /></label>
                <label className="text-sm">Secondary <Input type="color" value={business.secondary_color} onChange={(e) => setBusiness({ ...business, secondary_color: e.target.value })} /></label>
              </div>
              <Input placeholder="CTA Text" value={business.cta_text} onChange={(e) => setBusiness({ ...business, cta_text: e.target.value })} />
              <Input placeholder="CTA Link" value={business.cta_link} onChange={(e) => setBusiness({ ...business, cta_link: e.target.value })} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Smart Welcome Message</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <textarea className="w-full rounded-xl border border-zinc-300 p-3 text-sm" rows={3} value={business.welcome_message} onChange={(e) => setBusiness({ ...business, welcome_message: e.target.value })} />
              <Button variant="outline" onClick={generateWelcome}><Sparkles className="h-4 w-4" /> Generate Draft</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Services Management (Accordion)</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {services.map((s, i) => (
                <details key={`${s.service_slug}-${i}`} className="rounded-xl border border-zinc-200 p-3">
                  <summary className="cursor-pointer text-sm font-medium">{s.name || `Service ${i + 1}`}</summary>
                  <div className="mt-3 space-y-2">
                    <Input placeholder="Service Name" value={s.name} onChange={(e) => setServices((prev) => prev.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} />
                    <Input placeholder="Service Slug" value={s.service_slug} onChange={(e) => setServices((prev) => prev.map((x, idx) => idx === i ? { ...x, service_slug: e.target.value.toLowerCase() } : x))} />
                    <textarea className="w-full rounded-xl border border-zinc-300 p-3 text-sm" rows={2} placeholder="Description" value={s.description} onChange={(e) => setServices((prev) => prev.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))} />
                    <Input placeholder="Location / Online text" value={s.location_text} onChange={(e) => setServices((prev) => prev.map((x, idx) => idx === i ? { ...x, location_text: e.target.value } : x))} />
                    <Input placeholder="Price" value={s.price_text} onChange={(e) => setServices((prev) => prev.map((x, idx) => idx === i ? { ...x, price_text: e.target.value } : x))} />
                    <Button variant="outline" onClick={() => generateFaqForService(s)}><Sparkles className="h-4 w-4" /> Generate AI Suggestions</Button>
                  </div>
                </details>
              ))}
              <Button variant="outline" onClick={() => setServices((prev) => [...prev, { name: "", description: "", location_mode: "online", location_text: "", price_text: "", service_slug: "" }])}>+ Add Service</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>FAQ Manager (per service)</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {faqs.map((f, i) => (
                <div key={`${f.service_slug}-${i}`} className="rounded-xl border border-zinc-200 p-3 space-y-2">
                  <Input placeholder="Service Slug" value={f.service_slug} onChange={(e) => setFaqs((prev) => prev.map((x, idx) => idx === i ? { ...x, service_slug: e.target.value } : x))} />
                  <Input placeholder="Question" value={f.question} onChange={(e) => setFaqs((prev) => prev.map((x, idx) => idx === i ? { ...x, question: e.target.value } : x))} />
                  <textarea className="w-full rounded-xl border border-zinc-300 p-3 text-sm" rows={2} placeholder="Answer" value={f.answer} onChange={(e) => setFaqs((prev) => prev.map((x, idx) => idx === i ? { ...x, answer: e.target.value } : x))} />
                </div>
              ))}
              <Button variant="outline" onClick={() => setFaqs((prev) => [...prev, { service_slug: "", question: "", answer: "" }])}>+ Add FAQ</Button>
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button onClick={saveAll} disabled={saving}>{saving ? "Saving..." : "Save Settings"}</Button>
            {status ? <p className="text-sm text-zinc-500">{status}</p> : null}
          </div>
        </div>

        <div>
          <Card className="sticky top-4">
            <CardHeader><CardTitle>Live Zoe Preview</CardTitle></CardHeader>
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
    </main>
  );
}
