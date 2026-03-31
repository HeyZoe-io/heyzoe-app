"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp,
  GripVertical, Link, Loader2, Plus, Sparkles, Trash2, Upload, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import ZoeLoader from "@/components/ZoeLoader";

// ─── Types ────────────────────────────────────────────────────────────────────

type SegAnswer  = { id: string; text: string; service_slug: string };
type SegQuestion = { id: string; question: string; answers: SegAnswer[] };
type QuickReply  = { id: string; label: string; reply: string };
type Objection   = { id: string; question: string; answer: string };
type AutoMsgs    = { before_class: string; no_registration: string; business_hours: string };
type ServiceItem = {
  ui_id: string; name: string; price_text: string;
  duration: string; payment_link: string;
  service_slug: string; location_text: string; description: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = [
  "ייבוא מהאתר", "פרטי עסק", "מדיה לפתיחה", "הודעת פתיחה",
  "שאלות ותפריט", "שירותים", "Arbox",
  "התנגדויות", "הודעות אוטומטיות", "הרשמה",
];

const VIBES = ["חברי", "מקצועי", "מצחיק", "רוחני", "יוקרתי", "ישיר", "אמפתי", "סמכותי"];

function uid() { return Math.random().toString(36).slice(2, 9); }
function toSlug(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-");
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepHeader({ n, title, desc }: { n: number; title: string; desc?: string }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-1">
        <span className="w-8 h-8 rounded-full bg-fuchsia-100 text-fuchsia-700 text-sm font-bold flex items-center justify-center shrink-0">{n}</span>
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
      className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-400 resize-none"
    />
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SlugSettingsPage() {
  const { slug } = useParams() as { slug: string };

  const [step, setStep]     = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [fetchingUrl, setFetchingUrl]         = useState(false);
  const [generatingWelcome, setGeneratingWelcome] = useState(false);

  // ── Step 1: Website import
  const [websiteUrl, setWebsiteUrl] = useState("");

  // ── Step 2: Business details
  const [name, setName]         = useState("");
  const [botName, setBotName]   = useState("זואי");
  const [niche, setNiche]       = useState("");
  const [logoUrl, setLogoUrl]   = useState("");
  const [address, setAddress]   = useState("");
  const [directions, setDirections] = useState("");
  const [description, setDescription] = useState("");
  const [vibe, setVibe]         = useState<string[]>([]);
  const [primaryColor, setPrimaryColor]     = useState("#ff85cf");
  const [secondaryColor, setSecondaryColor] = useState("#bc74e9");
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // ── Step 3: Opening media
  const [openingMediaUrl, setOpeningMediaUrl]   = useState("");
  const [openingMediaType, setOpeningMediaType] = useState<"image" | "video" | "">("");
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  // ── Step 4: Opening message
  const [welcomeMessage, setWelcomeMessage] = useState("");

  // ── Step 5: Segmentation
  const [segQuestions, setSegQuestions] = useState<SegQuestion[]>([]);

  // ── Step 6: Quick replies
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [newReplyLabel, setNewReplyLabel] = useState("");
  const [newReplyText, setNewReplyText] = useState("");

  // ── Step 7: Services + drag & drop
  const [services, setServices]   = useState<ServiceItem[]>([]);
  const dragIdx = useRef<number | null>(null);

  // ── Step 8: Arbox
  const [arboxLink, setArboxLink] = useState("");

  // ── Step 9: Objections
  const [objections, setObjections] = useState<Objection[]>([]);

  // ── Step 10: Automated messages
  const [autoMsgs, setAutoMsgs] = useState<AutoMsgs>({
    before_class: "", no_registration: "", business_hours: "",
  });

  // ── Step 11: Post-registration
  const [postRegMsg, setPostRegMsg] = useState("");

  // ─── Load data ─────────────────────────────────────────────────────────────

  useEffect(() => {
    fetch("/api/dashboard/settings")
      .then(r => r.json())
      .then(({ business, services: svcs }) => {
        if (!business) return;
        const sl = (business.social_links && typeof business.social_links === "object"
          ? business.social_links : {}) as Record<string, unknown>;

        setWebsiteUrl(String(sl.website_url ?? business.website_url ?? ""));
        setName(String(business.name ?? ""));
        setBotName(String(business.bot_name ?? "זואי"));
        setNiche(String(business.niche ?? ""));
        setLogoUrl(String(business.logo_url ?? ""));
        setPrimaryColor(String(business.primary_color ?? "#ff85cf"));
        setSecondaryColor(String(business.secondary_color ?? "#bc74e9"));
        setAddress(String(sl.address ?? ""));
        setDirections(String(sl.directions ?? ""));
        setDescription(String(sl.business_description ?? business.business_description ?? ""));
        setVibe(Array.isArray(sl.vibe) ? (sl.vibe as string[]) : []);
        setOpeningMediaUrl(String(sl.opening_media_url ?? ""));
        setOpeningMediaType((sl.opening_media_type as "image" | "video" | "") ?? "");
        setWelcomeMessage(String(business.welcome_message ?? ""));
        setSegQuestions(Array.isArray(sl.segmentation_questions) ? (sl.segmentation_questions as SegQuestion[]) : []);
        setQuickReplies(
          Array.isArray(sl.quick_replies)
            ? (sl.quick_replies as QuickReply[]).map(r =>
                typeof r === "string"
                  ? { id: uid(), label: r, reply: "" }   // migrate old string format
                  : { id: r.id ?? uid(), label: String(r.label ?? ""), reply: String(r.reply ?? "") }
              )
            : []
        );
        setArboxLink(String(sl.arbox_link ?? ""));
        setObjections(Array.isArray(sl.objections) ? (sl.objections as Objection[]) : []);
        const am = (sl.automated_messages ?? {}) as Partial<AutoMsgs>;
        setAutoMsgs({ before_class: String(am.before_class ?? ""), no_registration: String(am.no_registration ?? ""), business_hours: String(am.business_hours ?? "") });
        setPostRegMsg(String(sl.post_registration_message ?? ""));

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

  // ─── Save ──────────────────────────────────────────────────────────────────

  const saveAll = useCallback(async () => {
    setSaving(true); setSaveErr("");
    try {
      const res = await fetch("/api/dashboard/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business: {
            slug,
            name,
            niche,
            bot_name: botName,
            logo_url: logoUrl,
            primary_color: primaryColor,
            secondary_color: secondaryColor,
            welcome_message: welcomeMessage,
            social_links: {
              website_url: websiteUrl,
              business_description: description,
              address,
              directions,
              vibe,
              opening_media_url: openingMediaUrl,
              opening_media_type: openingMediaType,
              segmentation_questions: segQuestions,
              quick_replies: quickReplies,
              arbox_link: arboxLink,
              objections,
              automated_messages: autoMsgs,
              post_registration_message: postRegMsg,
            },
          },
          services: services.filter(s => s.name).map(s => ({
            name: s.name,
            service_slug: s.service_slug || toSlug(s.name),
            price_text: s.price_text,
            location_text: s.location_text,
            location_mode: "location",
            description: JSON.stringify({ duration: s.duration, payment_link: s.payment_link }),
          })),
          faqs: [],
        }),
      });
      if (!res.ok) throw new Error("שגיאה בשמירה");
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  }, [slug, name, niche, botName, logoUrl, primaryColor, secondaryColor, welcomeMessage,
      websiteUrl, description, address, directions, vibe, openingMediaUrl, openingMediaType,
      segQuestions, quickReplies, arboxLink, objections, autoMsgs, postRegMsg, services]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Logo upload ───────────────────────────────────────────────────────────

  async function uploadLogo(file: File) {
    setUploadingLogo(true);
    const fd = new FormData(); fd.append("file", file);
    try {
      const res = await fetch("/api/dashboard/upload-logo", { method: "POST", body: fd });
      const j = await res.json();
      if (j.url) setLogoUrl(j.url);
    } finally { setUploadingLogo(false); }
  }

  // ─── Media upload ──────────────────────────────────────────────────────────

  async function uploadMedia(file: File) {
    setUploadingMedia(true);
    const fd = new FormData(); fd.append("file", file);
    try {
      const res = await fetch("/api/dashboard/upload-logo", { method: "POST", body: fd });
      const j = await res.json();
      if (j.url) {
        setOpeningMediaUrl(j.url);
        setOpeningMediaType(file.type.startsWith("video") ? "video" : "image");
      }
    } finally { setUploadingMedia(false); }
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
      if (j.business_description) setDescription(j.business_description);
      if (j.logo_url) setLogoUrl(j.logo_url);
      if (j.products?.length) {
        setServices(j.products.slice(0, 8).map((p: Record<string, unknown>) => ({
          ui_id: uid(),
          name: String(p.name ?? ""),
          price_text: String(p.price_text ?? ""),
          duration: "",
          payment_link: "",
          service_slug: toSlug(String(p.name ?? "")),
          location_text: String(p.location_text ?? ""),
          description: "",
        })));
      }
      setStep(2);
    } finally { setFetchingUrl(false); }
  }

  // ─── Generate welcome ──────────────────────────────────────────────────────

  async function generateWelcome() {
    setGeneratingWelcome(true);
    try {
      const res = await fetch("/api/dashboard/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "welcome", business_name: name, niche, vibe, website_url: websiteUrl, business_description: description }),
      });
      const j = await res.json();
      if (j.welcome_message) setWelcomeMessage(j.welcome_message);
    } finally { setGeneratingWelcome(false); }
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

  // ─── Segmentation helpers ──────────────────────────────────────────────────

  function addSegQuestion() {
    setSegQuestions(q => [...q, { id: uid(), question: "", answers: [] }]);
  }
  function updateSegQuestion(id: string, question: string) {
    setSegQuestions(q => q.map(x => x.id === id ? { ...x, question } : x));
  }
  function removeSegQuestion(id: string) {
    setSegQuestions(q => q.filter(x => x.id !== id));
  }
  function addSegAnswer(qid: string) {
    setSegQuestions(q => q.map(x => x.id === qid
      ? { ...x, answers: [...x.answers, { id: uid(), text: "", service_slug: "" }] }
      : x));
  }
  function updateSegAnswer(qid: string, aid: string, patch: Partial<SegAnswer>) {
    setSegQuestions(q => q.map(x => x.id === qid
      ? { ...x, answers: x.answers.map(a => a.id === aid ? { ...a, ...patch } : a) }
      : x));
  }
  function removeSegAnswer(qid: string, aid: string) {
    setSegQuestions(q => q.map(x => x.id === qid
      ? { ...x, answers: x.answers.filter(a => a.id !== aid) }
      : x));
  }

  // ─── Objection helpers ────────────────────────────────────────────────────

  function addObjection() {
    setObjections(o => [...o, { id: uid(), question: "", answer: "" }]);
  }
  function updateObjection(id: string, patch: Partial<Omit<Objection, "id">>) {
    setObjections(o => o.map(x => x.id === id ? { ...x, ...patch } : x));
  }
  function removeObjection(id: string) {
    setObjections(o => o.filter(x => x.id !== id));
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="min-h-screen flex items-center justify-center"><ZoeLoader /></div>;

  const isFirst = step === 1;
  const isLast  = step === STEPS.length;

  return (
    <div className="min-h-screen bg-zinc-50" dir="rtl">

      {/* ── Top bar ── */}
      <div className="sticky top-0 z-40 bg-white border-b border-zinc-200 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
            <span className="text-fuchsia-500">HeyZoe</span>
            <span className="text-zinc-300">/</span>
            <span>{slug}</span>
          </div>
          <Button
            variant="outline"
            onClick={saveAll}
            disabled={saving}
            className="gap-2 text-xs"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : savedOk ? <Check className="h-3 w-3 text-green-500" /> : null}
            {saving ? "שומר..." : savedOk ? "נשמר!" : "שמור"}
          </Button>
        </div>

        {/* Step indicator */}
        <div className="max-w-2xl mx-auto px-4 pb-3 overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {STEPS.map((label, i) => {
              const n = i + 1;
              const active  = step === n;
              const done    = step > n;
              return (
                <button
                  key={n}
                  onClick={() => setStep(n)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    active  ? "bg-fuchsia-500 text-white shadow-sm" :
                    done    ? "bg-fuchsia-100 text-fuchsia-700" :
                              "bg-zinc-100 text-zinc-400 hover:bg-zinc-200"
                  }`}
                >
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    active ? "bg-white/30" : done ? "bg-fuchsia-200" : "bg-zinc-200"
                  }`}>{done ? "✓" : n}</span>
                  <span className="hidden sm:inline">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Step content ── */}
      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* ════════════════════ STEP 1 ════════════════════ */}
        {step === 1 && (
          <Card>
            <CardHeader><CardTitle><StepHeader n={1} title="ייבוא מהאתר" desc="הזן את כתובת האתר שלך ונמשוך ממנו פרטים אוטומטית" /></CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Field label="כתובת האתר">
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
                <p className="text-sm text-fuchsia-600 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  מנתח את האתר — זה לוקח כמה שניות...
                </p>
              )}
              <p className="text-xs text-zinc-400">
                אפשר גם לדלג ולמלא הכל ידנית בשלבים הבאים.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ════════════════════ STEP 2 ════════════════════ */}
        {step === 2 && (
          <Card>
            <CardHeader><CardTitle><StepHeader n={2} title="פרטי העסק" /></CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <Field label="שם העסק *">
                  <Input dir="rtl" value={name} onChange={e => setName(e.target.value)} placeholder="Acro by Joe" />
                </Field>
                <Field label="שם הבוט">
                  <Input dir="rtl" value={botName} onChange={e => setBotName(e.target.value)} placeholder="זואי" />
                </Field>
              </div>

              <Field label="כתובת">
                <Input dir="rtl" value={address} onChange={e => setAddress(e.target.value)} placeholder="רחוב הרצל 5, תל אביב" />
              </Field>

              <Field label="הנחיות הגעה">
                <Textarea value={directions} onChange={setDirections} placeholder="חנייה בחינם מאחורי הבניין, כניסה מצד ימין..." rows={2} />
              </Field>

              <Field label="תיאור העסק">
                <Textarea value={description} onChange={setDescription} placeholder="ספר על העסק שלך..." rows={4} />
              </Field>

              <Field label="סגנון דיבור">
                <div className="flex flex-wrap gap-2">
                  {VIBES.map(v => (
                    <button
                      key={v}
                      onClick={() => setVibe(curr => curr.includes(v) ? curr.filter(x => x !== v) : [...curr, v])}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-all ${
                        vibe.includes(v)
                          ? "bg-fuchsia-500 text-white border-fuchsia-500 shadow-sm"
                          : "bg-white text-zinc-600 border-zinc-300 hover:border-fuchsia-300"
                      }`}
                    >{v}</button>
                  ))}
                </div>
              </Field>

              {/* Logo */}
              <Field label="לוגו">
                <div className="flex items-center gap-3">
                  {logoUrl && <img src={logoUrl} alt="logo" className="h-12 w-12 rounded-xl object-contain border border-zinc-200" />}
                  <Button variant="outline" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo} className="gap-2 text-sm py-1.5 px-3">
                    {uploadingLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {uploadingLogo ? "מעלה..." : "העלה לוגו"}
                  </Button>
                  <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} />
                </div>
              </Field>

              {/* Colors */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="צבע ראשי">
                  <div className="flex gap-2 items-center">
                    <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className="h-9 w-9 rounded-lg border border-zinc-300 cursor-pointer p-0.5" />
                    <Input dir="ltr" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className="font-mono text-sm" />
                  </div>
                </Field>
                <Field label="צבע משני">
                  <div className="flex gap-2 items-center">
                    <input type="color" value={secondaryColor} onChange={e => setSecondaryColor(e.target.value)} className="h-9 w-9 rounded-lg border border-zinc-300 cursor-pointer p-0.5" />
                    <Input dir="ltr" value={secondaryColor} onChange={e => setSecondaryColor(e.target.value)} className="font-mono text-sm" />
                  </div>
                </Field>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ════════════════════ STEP 3 ════════════════════ */}
        {step === 3 && (
          <Card>
            <CardHeader><CardTitle><StepHeader n={3} title="מדיה לפתיחה" desc="תמונה או סרטון שיוצגו מעל הודעת הפתיחה" /></CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div
                onClick={() => mediaInputRef.current?.click()}
                className="border-2 border-dashed border-zinc-300 rounded-2xl p-10 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-fuchsia-400 hover:bg-fuchsia-50 transition-all"
              >
                {uploadingMedia ? (
                  <Loader2 className="h-8 w-8 animate-spin text-fuchsia-400" />
                ) : openingMediaUrl ? (
                  openingMediaType === "video"
                    ? <video src={openingMediaUrl} className="max-h-48 rounded-xl" controls />
                    : <img src={openingMediaUrl} alt="media" className="max-h-48 rounded-xl object-contain" />
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-zinc-400" />
                    <p className="text-sm text-zinc-500">לחץ להעלאת תמונה או סרטון</p>
                    <p className="text-xs text-zinc-400">JPG, PNG, GIF, MP4 — עד 20MB</p>
                  </>
                )}
              </div>
              <input
                ref={mediaInputRef} type="file" accept="image/*,video/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadMedia(f); }}
              />
              {openingMediaUrl && (
                <div className="flex gap-2 items-center">
                  <Input dir="ltr" value={openingMediaUrl} onChange={e => setOpeningMediaUrl(e.target.value)} placeholder="או הדבק URL ישירות" />
                  <Button variant="ghost" onClick={() => { setOpeningMediaUrl(""); setOpeningMediaType(""); }} className="px-2 py-1.5">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
              {!openingMediaUrl && (
                <Field label="או הדבק URL">
                  <Input dir="ltr" value={openingMediaUrl} onChange={e => { setOpeningMediaUrl(e.target.value); if (e.target.value.match(/\.(mp4|mov|webm)/i)) setOpeningMediaType("video"); else setOpeningMediaType("image"); }} placeholder="https://..." />
                </Field>
              )}
            </CardContent>
          </Card>
        )}

        {/* ════════════════════ STEP 4 ════════════════════ */}
        {step === 4 && (
          <Card>
            <CardHeader><CardTitle><StepHeader n={4} title="הודעת פתיחה" desc="ההודעה הראשונה שזואי תשלח לכל לקוח חדש" /></CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Textarea value={welcomeMessage} onChange={setWelcomeMessage} placeholder="שלום! אני זואי מ..." rows={5} />
              <Button variant="outline" onClick={generateWelcome} disabled={generatingWelcome || !name} className="gap-2 w-full">
                {generatingWelcome ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-fuchsia-500" />}
                {generatingWelcome ? "מייצר..." : "ייצר עם AI"}
              </Button>
              {!name && <p className="text-xs text-zinc-400 text-center">מלא שם עסק בשלב 2 לפני הייצור</p>}
            </CardContent>
          </Card>
        )}

        {/* ════════════════════ STEP 5 ════════════════════ */}
        {step === 5 && (
          <Card>
            <CardHeader>
              <CardTitle>
                <StepHeader
                  n={5}
                  title="שאלות ותפריט"
                  desc="שאלות סגמנטציה לניתוב לשירות הנכון + כפתורי תשובה מהירה כללית"
                />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-8">
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-zinc-900 text-right">
                  שאלות סגמנטציה
                </h3>
              {segQuestions.map((q, qi) => (
                <div key={q.id} className="border border-zinc-200 rounded-2xl p-4 space-y-4">
                  <div className="flex gap-2 items-center">
                    <span className="text-xs text-zinc-400 shrink-0">שאלה {qi + 1}</span>
                    <Input dir="rtl" value={q.question} onChange={e => updateSegQuestion(q.id, e.target.value)} placeholder="לאיזה שיעור את/ה מחפש/ת?" className="flex-1" />
                    <button onClick={() => removeSegQuestion(q.id)} className="p-1 text-zinc-400 hover:text-red-400 transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="space-y-2 pr-4">
                    {q.answers.map(a => (
                      <div key={a.id} className="flex gap-2 items-center">
                        <Input dir="rtl" value={a.text} onChange={e => updateSegAnswer(q.id, a.id, { text: e.target.value })} placeholder="תשובה..." className="flex-1" />
                        <select
                          value={a.service_slug}
                          onChange={e => updateSegAnswer(q.id, a.id, { service_slug: e.target.value })}
                          className="text-sm border border-zinc-300 rounded-xl px-2 py-2 text-zinc-700 focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                        >
                          <option value="">ניתוב...</option>
                          <option value="general">כללי</option>
                          {services.filter(s => s.name).map(s => (
                            <option key={s.ui_id} value={s.service_slug || toSlug(s.name)}>{s.name}</option>
                          ))}
                        </select>
                        <button onClick={() => removeSegAnswer(q.id, a.id)} className="p-1 text-zinc-400 hover:text-red-400">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    <Button variant="ghost" onClick={() => addSegAnswer(q.id)} className="gap-1 text-xs text-fuchsia-600 py-1.5 px-2">
                      <Plus className="h-3 w-3" /> הוסף תשובה
                    </Button>
                  </div>
                </div>
              ))}

              <Button variant="outline" onClick={addSegQuestion} className="w-full gap-2">
                <Plus className="h-4 w-4" /> הוסף שאלה
              </Button>
              </div>

              <div className="space-y-3 border-t border-dashed border-zinc-200 pt-4">
                <h3 className="text-sm font-semibold text-zinc-900 text-right">
                  כפתורי תשובה מהירה
                </h3>
                {quickReplies.map((r, i) => (
                  <div key={r.id} className="border border-zinc-200 rounded-xl p-3 space-y-2">
                    <div className="flex gap-2 items-center">
                      <span className="text-xs text-zinc-400 w-5 shrink-0 font-medium">{i + 1}.</span>
                      <Input
                        dir="rtl"
                        value={r.label}
                        onChange={e => setQuickReplies(q => q.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                        placeholder="טקסט הכפתור (מה המשתמש לוחץ)..."
                        className="text-sm font-medium"
                      />
                      <button onClick={() => setQuickReplies(q => q.filter((_, j) => j !== i))} className="p-1 text-zinc-400 hover:text-red-400 shrink-0">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex gap-2 items-start pr-7">
                      <textarea
                        dir="rtl"
                        value={r.reply}
                        onChange={e => setQuickReplies(q => q.map((x, j) => j === i ? { ...x, reply: e.target.value } : x))}
                        placeholder="התשובה הסטטית שתישלח אוטומטית..."
                        rows={2}
                        className="flex-1 resize-none rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                      />
                    </div>
                  </div>
                ))}

                {/* Auto "other question" indicator */}
                <div className="flex gap-2 items-center opacity-40">
                  <span className="text-xs text-zinc-400 w-5 shrink-0">{quickReplies.length + 1}.</span>
                  <div className="flex-1 border border-dashed border-zinc-300 rounded-xl px-3 py-2 text-sm text-zinc-400">
                    שאלה אחרת ✨ (אוטומטי) → Claude
                  </div>
                </div>
              </div>

              {/* Add new quick reply */}
              <div className="border border-fuchsia-100 rounded-xl p-3 space-y-2 bg-fuchsia-50/40">
                <p className="text-xs font-medium text-fuchsia-700">הוסף כפתור חדש</p>
                <Input
                  dir="rtl"
                  value={newReplyLabel}
                  onChange={e => setNewReplyLabel(e.target.value)}
                  placeholder="טקסט הכפתור..."
                  className="text-sm"
                />
                <textarea
                  dir="rtl"
                  value={newReplyText}
                  onChange={e => setNewReplyText(e.target.value)}
                  placeholder="תשובה סטטית..."
                  rows={2}
                  className="w-full resize-none rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                />
                <Button
                  onClick={() => {
                    if (newReplyLabel.trim()) {
                      setQuickReplies(q => [...q, { id: uid(), label: newReplyLabel.trim(), reply: newReplyText.trim() }]);
                      setNewReplyLabel("");
                      setNewReplyText("");
                    }
                  }}
                  disabled={!newReplyLabel.trim()}
                  className="gap-1 w-full"
                >
                  <Plus className="h-4 w-4" /> הוסף כפתור
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ════════════════════ STEP 6 (שירותים) ════════════════════ */}
        {step === 6 && (
          <Card>
            <CardHeader><CardTitle><StepHeader n={7} title="שירותים" desc="גרור לשינוי סדר עדיפויות" /></CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {services.map((s, i) => (
                <div
                  key={s.ui_id}
                  draggable
                  onDragStart={() => onDragStart(i)}
                  onDragOver={e => onDragOver(e, i)}
                  onDragEnd={onDragEnd}
                  className="border border-zinc-200 rounded-2xl p-4 space-y-3 bg-white hover:border-fuchsia-200 transition-colors"
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
                onClick={() => setServices(sv => [...sv, { ui_id: uid(), name: "", price_text: "", duration: "", payment_link: "", service_slug: "", location_text: "", description: "" }])}
                className="w-full gap-2"
              >
                <Plus className="h-4 w-4" /> הוסף שירות
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ════════════════════ STEP 8 ════════════════════ */}
        {step === 8 && (
          <Card>
            <CardHeader><CardTitle><StepHeader n={8} title="חיבור Arbox" desc="קישור מערכת ניהול השיעורים שלך" /></CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <Field label="לינק Arbox">
                <div className="flex gap-2 items-center">
                  <Link className="h-4 w-4 text-zinc-400 shrink-0" />
                  <Input
                    dir="ltr"
                    value={arboxLink}
                    onChange={e => setArboxLink(e.target.value)}
                    placeholder="https://app.arbox.me/..."
                  />
                </div>
              </Field>
              <div className="bg-fuchsia-50 rounded-2xl p-4 text-sm text-fuchsia-800">
                <p className="font-medium mb-1">כיצד לקבל את הלינק?</p>
                <ol className="list-decimal list-inside space-y-1 text-fuchsia-700">
                  <li>היכנס ל-Arbox</li>
                  <li>לך ל-Settings → Online Registration</li>
                  <li>העתק את ה-Registration Link</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ════════════════════ STEP 9 ════════════════════ */}
        {step === 9 && (
          <Card>
            <CardHeader><CardTitle><StepHeader n={9} title="טיפול בהתנגדויות" desc="שאלות נפוצות שלקוחות מעלים ותשובות מוצעות" /></CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {objections.map((o, i) => (
                <div key={o.id} className="border border-zinc-200 rounded-2xl p-4 space-y-3">
                  <div className="flex gap-2 items-start">
                    <span className="text-xs font-medium text-zinc-400 mt-2 shrink-0">ש:</span>
                    <Input dir="rtl" value={o.question} onChange={e => updateObjection(o.id, { question: e.target.value })} placeholder="זה לא יקר מדי?" className="flex-1" />
                    <button onClick={() => removeObjection(o.id)} className="p-1 text-zinc-400 hover:text-red-400 mt-1">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex gap-2 items-start">
                    <span className="text-xs font-medium text-zinc-400 mt-2 shrink-0">ת:</span>
                    <Textarea value={o.answer} onChange={v => updateObjection(o.id, { answer: v })} placeholder="ההשקעה בשיעור שלנו מחזירה את עצמה..." rows={2} />
                  </div>
                </div>
              ))}

              <Button variant="outline" onClick={addObjection} className="w-full gap-2">
                <Plus className="h-4 w-4" /> הוסף התנגדות
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ════════════════════ STEP 10 ════════════════════ */}
        {step === 10 && (
          <Card>
            <CardHeader><CardTitle><StepHeader n={10} title="הודעות אוטומטיות" /></CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <Field label="פולואפ לפני שיעור">
                <Textarea
                  value={autoMsgs.before_class}
                  onChange={v => setAutoMsgs(m => ({ ...m, before_class: v }))}
                  placeholder="היי {שם}, מחר יש לנו שיעור ב-{שעה}. מחכים לך! 🙌"
                  rows={3}
                />
              </Field>
              <Field label="פולואפ אם לא נרשמו">
                <Textarea
                  value={autoMsgs.no_registration}
                  onChange={v => setAutoMsgs(m => ({ ...m, no_registration: v }))}
                  placeholder="היי {שם}, שמנו לב שעוד לא נרשמת לשיעור הבא. רוצה שנשמור לך מקום?"
                  rows={3}
                />
              </Field>
              <Field label="שעות פעילות (לתשובות אוטומטיות)">
                <Textarea
                  value={autoMsgs.business_hours}
                  onChange={v => setAutoMsgs(m => ({ ...m, business_hours: v }))}
                  placeholder={"ראשון–חמישי: 7:00–21:00\nשישי: 7:00–14:00\nשבת: סגור"}
                  rows={4}
                />
              </Field>
              <p className="text-xs text-zinc-400">
                השתמשו ב-&#123;שם&#125;, &#123;שעה&#125;, &#123;תאריך&#125; לפרסונליזציה.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ════════════════════ STEP 11 ════════════════════ */}
        {step === 11 && (
          <Card>
            <CardHeader><CardTitle><StepHeader n={11} title="הודעה לאחר הרשמה" desc="הודעה שתישלח אוטומטית לאחר שלקוח נרשם לשירות" /></CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={postRegMsg}
                onChange={setPostRegMsg}
                placeholder={"כל הכבוד {שם}! נרשמת בהצלחה 🎉\n\nמה לצפות מהשיעור הראשון:\n• הגיעו 10 דקות לפני\n• לבשו בגדים נוחים\n• שתו מים לפני השיעור\n\nמחכים לכם!"}
                rows={8}
              />
              <p className="text-xs text-zinc-400">
                השתמשו ב-&#123;שם&#125; לפרסונליזציה.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── Error ── */}
        {saveErr && <p className="text-sm text-red-500 text-center mt-4">{saveErr}</p>}

        {/* ── Navigation ── */}
        <div className="flex items-center justify-between mt-8 pt-4 border-t border-zinc-200">
          <Button
            variant="outline"
            onClick={() => setStep(s => Math.max(1, s - 1))}
            disabled={isFirst}
            className="gap-2"
          >
            <ArrowRight className="h-4 w-4" />
            הקודם
          </Button>

          <span className="text-sm text-zinc-400">{step} / {STEPS.length}</span>

          {isLast ? (
            <Button onClick={saveAll} disabled={saving} className="gap-2 bg-fuchsia-500 hover:bg-fuchsia-600 text-white">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {saving ? "שומר..." : "שמור הכל"}
            </Button>
          ) : (
            <Button onClick={() => { saveAll(); setStep(s => Math.min(STEPS.length, s + 1)); }} className="gap-2">
              הבא
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
        </div>

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
