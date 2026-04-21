import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getBusinessKnowledgePack } from "@/lib/business-context";
import AnalyticsClient from "./AnalyticsClient";

type RangeKey = "month" | "week" | "all";
type Props = { params: Promise<{ slug: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function resolveRangeKey(raw: unknown): RangeKey {
  const r = String(Array.isArray(raw) ? raw[0] : raw ?? "").trim().toLowerCase();
  if (r === "week" || r === "all") return r;
  return "month";
}

function rangeStartIso(range: RangeKey): string | null {
  if (range === "week") return isoDaysAgo(7);
  if (range === "month") return isoDaysAgo(31);
  return null;
}

function pickSuggestions(input: {
  businessDescription: string;
  directionsText: string;
  promotionsText: string;
  ageRangeText: string;
  servicesText: string;
}): string[] {
  const text = `${input.businessDescription}\n${input.directionsText}\n${input.promotionsText}\n${input.servicesText}`.toLowerCase();
  const missing: { key: string; msg: string; test: () => boolean }[] = [
    {
      key: "age",
      msg: "הוסיפו גילאים / קהל יעד כדי שזואי תדע למי זה מתאים.",
      test: () => !input.ageRangeText.trim() && !/(גיל|ילדים|נוער|מבוגרים|נשים|גברים)/u.test(text),
    },
    {
      key: "levels",
      msg: "אם יש חלוקה לרמות — ציינו מתחילים/מתקדמים לכל אימון ניסיון.",
      test: () => !/(רמות:|מתחילים|מתקדמים)/u.test(text),
    },
    {
      key: "parking",
      msg: "הוסיפו מידע על חניה / איך מגיעים כדי שתשובות כתובת יהיו שלמות.",
      test: () => !/(חניה|חנייה|חניון|parking)/u.test(text),
    },
    {
      key: "showers",
      msg: "ציינו אם יש מקלחות וחדרי הלבשה.",
      test: () => !/(מקלחות|מקלחת|חדרי הלבשה|החלפה|לוקר|locker)/u.test(text),
    },
    {
      key: "cancel",
      msg: "הוסיפו מדיניות ביטול/הקפאה כדי למנוע שאלות פתוחות ללא תשובה.",
      test: () => !/(מדיניות ביטול|ביטול|הקפאה|דמי ביטול|החזר)/u.test(text),
    },
    {
      key: "promos",
      msg: "אם יש מבצע — כתבו אותו ב״הנחות ומבצעים״ כדי שזואי תשלב אותו בזמן הנכון.",
      test: () => !input.promotionsText.trim() && /(מבצע|הנחה|%|מתנה)/u.test(text),
    },
  ];
  return missing.filter((m) => m.test()).map((m) => m.msg).slice(0, 3);
}

export default async function AnalyticsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const range = resolveRangeKey(sp.range);
  const startIso = rangeStartIso(range);

  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect("/dashboard/login");

  const admin = createSupabaseAdminClient();
  const { data: biz } = await admin
    .from("businesses")
    .select("id, slug, user_id")
    .eq("slug", slug)
    .maybeSingle();

  if (!biz) notFound();

  const isOwner = String(biz.user_id) === user.user.id;
  if (!isOwner) {
    const { data: bu } = await admin
      .from("business_users")
      .select("role")
      .eq("business_id", biz.id)
      .eq("user_id", user.user.id)
      .maybeSingle();
    const allowed = bu?.role === "admin";
    if (!allowed) redirect(`/${slug}/conversations`);
  }

  const msgQuery = admin
    .from("messages")
    .select("session_id, created_at")
    .eq("business_slug", slug);
  const { data: messages } = startIso ? await msgQuery.gte("created_at", startIso) : await msgQuery;

  // Chats (per phone): session_id is `wa_<to>_<from>` so it is unique per phone.
  const seenSessions = new Set<string>();
  const firstMessageAtBySession = new Map<string, string>();
  for (const m of messages ?? []) {
    const sid = (m as any).session_id ? String((m as any).session_id) : "";
    const at = (m as any).created_at ? String((m as any).created_at) : "";
    if (!sid) continue;
    seenSessions.add(sid);
    const prev = firstMessageAtBySession.get(sid);
    if (!prev || (at && at < prev)) firstMessageAtBySession.set(sid, at);
  }
  const totalChats = seenSessions.size;
  // "New leads" = sessions whose first-ever message is inside the selected range.
  const newLeads =
    startIso
      ? Array.from(firstMessageAtBySession.values()).filter((at) => at && at >= startIso).length
      : totalChats;

  // Conversions = contacts that confirmed "נרשמתי" (trial_registered=true), unique per phone.
  const convQuery = admin
    .from("contacts")
    .select("phone, trial_registered_at")
    .eq("business_id", biz.id)
    .eq("trial_registered", true);
  const { data: convRows } = startIso ? await convQuery.gte("trial_registered_at", startIso) : await convQuery;
  const convertedPhones = new Set<string>();
  for (const r of convRows ?? []) {
    const p = String((r as any).phone ?? "").trim();
    if (p) convertedPhones.add(p);
  }
  const converted = convertedPhones.size;
  const conversionRate = totalChats ? Math.round((converted / totalChats) * 100) : 0;

  const knowledge = await getBusinessKnowledgePack(slug);
  const suggestions = pickSuggestions({
    businessDescription: knowledge?.businessDescription ?? "",
    directionsText: knowledge?.directionsText ?? "",
    promotionsText: knowledge?.promotionsText ?? "",
    ageRangeText: knowledge?.ageRangeText ?? "",
    servicesText: knowledge?.servicesText ?? "",
  });

  return (
    <AnalyticsClient
      slug={slug}
      initialRange={range}
      initial={{
        range,
        newLeads,
        converted,
        conversionRate,
        totalChats,
        suggestions,
      }}
    />
  );
}

