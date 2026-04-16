import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getBusinessKnowledgePack } from "@/lib/business-context";

export const runtime = "nodejs";

type RangeKey = "month" | "week" | "all";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function resolveRangeKey(raw: unknown): RangeKey {
  const r = String(raw ?? "").trim().toLowerCase();
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
  const text =
    `${input.businessDescription}\n${input.directionsText}\n${input.promotionsText}\n${input.servicesText}`.toLowerCase();
  const missing: { msg: string; test: () => boolean }[] = [
    {
      msg: "הוסיפו גילאים / קהל יעד כדי שזואי תדע למי זה מתאים.",
      test: () =>
        !input.ageRangeText.trim() && !/(גיל|ילדים|נוער|מבוגרים|נשים|גברים)/u.test(text),
    },
    {
      msg: "אם יש חלוקה לרמות - ציינו מתחילים/מתקדמים לכל אימון ניסיון.",
      test: () => !/(רמות:|מתחילים|מתקדמים)/u.test(text),
    },
    {
      msg: "הוסיפו מידע על חניה / איך מגיעים כדי שתשובות כתובת יהיו שלמות.",
      test: () => !/(חניה|חנייה|חניון|parking)/u.test(text),
    },
    {
      msg: "ציינו אם יש מקלחות וחדרי הלבשה.",
      test: () => !/(מקלחות|מקלחת|חדרי הלבשה|החלפה|לוקר|locker)/u.test(text),
    },
    {
      msg: "הוסיפו מדיניות ביטול/הקפאה כדי למנוע שאלות פתוחות ללא תשובה.",
      test: () => !/(מדיניות ביטול|ביטול|הקפאה|דמי ביטול|החזר)/u.test(text),
    },
    {
      msg: "אם יש מבצע - כתבו אותו ב״הנחות ומבצעים״ כדי שזואי תשלב אותו בזמן הנכון.",
      test: () => !input.promotionsText.trim() && /(מבצע|הנחה|%|מתנה)/u.test(text),
    },
  ];
  return missing.filter((m) => m.test()).map((m) => m.msg).slice(0, 3);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const businessSlug = url.searchParams.get("business_slug")?.trim().toLowerCase() ?? "";
  const range = resolveRangeKey(url.searchParams.get("range"));
  const startIso = rangeStartIso(range);

  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!businessSlug) return NextResponse.json({ error: "missing_business_slug" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { data: biz } = await admin
    .from("businesses")
    .select("id, slug, user_id")
    .eq("slug", businessSlug)
    .maybeSingle();

  if (!biz) return NextResponse.json({ error: "business_not_found" }, { status: 404 });

  const isOwner = String(biz.user_id) === user.user.id;
  if (!isOwner) {
    const { data: bu } = await admin
      .from("business_users")
      .select("role")
      .eq("business_id", biz.id)
      .eq("user_id", user.user.id)
      .maybeSingle();
    const allowed = bu?.role === "admin";
    if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const msgQuery = admin
    .from("messages")
    .select("session_id, created_at")
    .eq("business_slug", businessSlug);
  const { data: messages } = startIso ? await msgQuery.gte("created_at", startIso) : await msgQuery;

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
  const newLeads =
    startIso
      ? Array.from(firstMessageAtBySession.values()).filter((at) => at && at >= startIso).length
      : totalChats;

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

  const knowledge = await getBusinessKnowledgePack(businessSlug);
  const suggestions = pickSuggestions({
    businessDescription: knowledge?.businessDescription ?? "",
    directionsText: knowledge?.directionsText ?? "",
    promotionsText: knowledge?.promotionsText ?? "",
    ageRangeText: knowledge?.ageRangeText ?? "",
    servicesText: knowledge?.servicesText ?? "",
  });

  return NextResponse.json({
    ok: true,
    range,
    newLeads,
    converted,
    conversionRate,
    totalChats,
    suggestions,
  });
}

