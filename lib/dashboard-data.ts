import { createSupabaseAdminClient } from "@/lib/supabase-admin";

type DateRange = { from: string; to: string };

type MessageRow = {
  business_slug: string;
  role: string;
  content: string | null;
  model_used: string | null;
  session_id: string | null;
  error_code: string | null;
  created_at: string;
};

type ConversionRow = {
  business_slug: string;
  session_id: string | null;
  type: string;
  created_at: string;
};

type BusinessRow = {
  id: number;
  slug: string;
  name: string;
  plan: "basic" | "premium";
  // Optional fields that may exist in some deployments
  onboarding_step?: number | null;
  is_active?: boolean | null;
};

function isoDateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function safeSessionId(v: string | null) {
  return v?.trim() || "anon";
}

export function resolveDateRange(searchParams?: Record<string, string | string[] | undefined>): DateRange {
  const fromRaw = typeof searchParams?.from === "string" ? searchParams.from : "";
  const toRaw = typeof searchParams?.to === "string" ? searchParams.to : "";

  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : isoDateOnly(daysAgo(30));
  const to = /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : isoDateOnly(new Date());
  return { from, to };
}

export async function getDashboardData(range: DateRange) {
  const supabase = createSupabaseAdminClient();
  const fromTs = `${range.from}T00:00:00.000Z`;
  const toTs = `${range.to}T23:59:59.999Z`;

  const [messagesRes, conversionsRes, businessesRes, pausedRes] = await Promise.all([
    supabase
      .from("messages")
      .select("business_slug, role, content, model_used, session_id, error_code, created_at")
      .gte("created_at", fromTs)
      .lte("created_at", toTs)
      .order("created_at", { ascending: false }),
    supabase
      .from("conversions")
      .select("business_slug, session_id, type, created_at")
      .gte("created_at", fromTs)
      .lte("created_at", toTs)
      .order("created_at", { ascending: false }),
    // businesses: try to select optional columns; fall back gracefully if missing
    (async () => {
      const baseSel = "id, slug, name, plan";
      try {
        const r = await supabase.from("businesses").select(`${baseSel}, onboarding_step, is_active`).order("created_at", {
          ascending: true,
        });
        if (r.error && /column/i.test(r.error.message ?? "")) {
          return await supabase.from("businesses").select(baseSel).order("created_at", { ascending: true });
        }
        return r;
      } catch {
        return await supabase.from("businesses").select(baseSel).order("created_at", { ascending: true });
      }
    })(),
    supabase
      .from("paused_sessions")
      .select("business_slug, paused_until")
      .gt("paused_until", new Date().toISOString()),
  ]);

  const messages = (messagesRes.data ?? []) as MessageRow[];
  const conversions = (conversionsRes.data ?? []) as ConversionRow[];
  const businesses = (businessesRes.data ?? []) as any as BusinessRow[];
  const pausedBySlug = new Map<string, boolean>();
  for (const p of pausedRes.data ?? []) {
    const slug = String((p as any).business_slug ?? "").trim().toLowerCase();
    if (slug) pausedBySlug.set(slug, true);
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const yearStart = new Date(new Date().getFullYear(), 0, 1);

  const sessionsDaily = new Set<string>();
  const sessionsMonthly = new Set<string>();
  const sessionsYearly = new Set<string>();

  const sessionsByBusiness = new Map<
    string,
    { firstAt: Date; lastAt: Date; sessionIds: Set<string> }
  >();
  const sessionUserCount = new Map<string, number>();
  const sessionLastUserIndex = new Map<string, number>();
  const modelUsage = new Map<string, number>();
  const errorLogs: Array<{ at: string; slug: string; code: string; content: string }> = [];
  const intentDropoff = new Map<string, number>();

  for (const msg of messages) {
    const at = new Date(msg.created_at);
    const sid = safeSessionId(msg.session_id);
    const slug = msg.business_slug || "unknown";

    if (at >= todayStart) sessionsDaily.add(sid);
    if (at >= monthStart) sessionsMonthly.add(sid);
    if (at >= yearStart) sessionsYearly.add(sid);

    const biz = sessionsByBusiness.get(slug);
    if (!biz) {
      sessionsByBusiness.set(slug, { firstAt: at, lastAt: at, sessionIds: new Set([sid]) });
    } else {
      if (at < biz.firstAt) biz.firstAt = at;
      if (at > biz.lastAt) biz.lastAt = at;
      biz.sessionIds.add(sid);
    }

    if (msg.role === "assistant" && msg.model_used) {
      modelUsage.set(msg.model_used, (modelUsage.get(msg.model_used) ?? 0) + 1);
    }

    if (msg.error_code === "429" || msg.error_code === "503") {
      errorLogs.push({
        at: msg.created_at,
        slug,
        code: msg.error_code,
        content: (msg.content ?? "").slice(0, 120),
      });
    }

    if (msg.role === "user") {
      const nextCount = (sessionUserCount.get(sid) ?? 0) + 1;
      sessionUserCount.set(sid, nextCount);
      sessionLastUserIndex.set(sid, nextCount);

      const text = (msg.content ?? "").toLowerCase();
      if (/price|pricing|מחיר|עלות|כמה זה עולה/.test(text)) {
        intentDropoff.set("pricing", (intentDropoff.get("pricing") ?? 0) + 1);
      } else if (/מיקום|כתובת|איפה|location|address/.test(text)) {
        intentDropoff.set("location", (intentDropoff.get("location") ?? 0) + 1);
      } else if (/trial|שיעור ניסיון|נסיון/.test(text)) {
        intentDropoff.set("trial", (intentDropoff.get("trial") ?? 0) + 1);
      } else {
        intentDropoff.set("general", (intentDropoff.get("general") ?? 0) + 1);
      }
    }
  }

  const visitors = new Set(messages.map((m) => safeSessionId(m.session_id)));
  const engaged = new Set(
    [...sessionUserCount.entries()].filter(([, c]) => c > 2).map(([sid]) => sid)
  );
  const clicked = new Set(
    conversions.map((c) => safeSessionId(c.session_id)).filter(Boolean)
  );

  const weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: messagesWeek } = await supabase
    .from("messages")
    .select("business_slug, session_id, created_at, role")
    .gte("created_at", weekAgoIso)
    .order("created_at", { ascending: true })
    .limit(80_000);

  const sessionsWeekBySlug = new Map<string, Set<string>>();
  for (const m of messagesWeek ?? []) {
    const slug = String((m as any).business_slug ?? "").trim().toLowerCase();
    const sid = safeSessionId((m as any).session_id ?? null);
    if (!slug || !sid) continue;
    const set = sessionsWeekBySlug.get(slug) ?? new Set<string>();
    set.add(sid);
    sessionsWeekBySlug.set(slug, set);
  }

  const businessBySlug = new Map<string, BusinessRow>(businesses.map((b) => [String(b.slug).trim().toLowerCase(), b]));

  const businessOverview = businesses
    .map((b) => {
      const slug = String(b.slug).trim().toLowerCase();
      const name = String(b.name ?? "").trim() || slug;
      const plan = (b.plan === "premium" ? "premium" : "basic") as "basic" | "premium";
      const sess = sessionsByBusiness.get(slug);
      const now = Date.now();
      const lastAt = sess?.lastAt ? sess.lastAt : new Date(0);
      const firstAt = sess?.firstAt ? sess.firstAt : new Date(0);
      const computedActive = now - lastAt.getTime() < 1000 * 60 * 60 * 24 * 7;
      const isActive =
        typeof b.is_active === "boolean" ? b.is_active : computedActive;
      const seniorityDays =
        firstAt.getTime() > 0
          ? Math.max(1, Math.floor((now - firstAt.getTime()) / (1000 * 60 * 60 * 24)))
          : 0;
      return {
        id: b.id,
        name,
        slug,
        plan,
        active: isActive,
        paused: pausedBySlug.get(slug) === true,
        onboardingStep: typeof b.onboarding_step === "number" ? b.onboarding_step : null,
        conversationsTotal: sess?.sessionIds.size ?? 0,
        conversationsWeek: (sessionsWeekBySlug.get(slug)?.size ?? 0) as number,
        firstAt: firstAt.getTime() ? firstAt.toISOString() : "",
        lastAt: lastAt.getTime() ? lastAt.toISOString() : "",
        seniorityDays,
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || b.conversationsTotal - a.conversationsTotal);

  const dropoffByMessageNumber = [...sessionLastUserIndex.values()].reduce<Record<string, number>>(
    (acc, n) => {
      const key = String(n);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {}
  );

  const modelTotal = [...modelUsage.values()].reduce((a, b) => a + b, 0) || 1;
  const modelUsageDistribution = [...modelUsage.entries()].map(([model, count]) => ({
    model,
    count,
    percent: Math.round((count / modelTotal) * 100),
  }));

  // Alerts
  const unansweredCutoffIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const sessionsLast = new Map<
    string,
    { slug: string; sessionId: string; lastAt: string; lastRole: string }
  >();
  for (const m of messagesWeek ?? []) {
    const slug = String((m as any).business_slug ?? "").trim().toLowerCase();
    const sid = safeSessionId((m as any).session_id ?? null);
    const at = String((m as any).created_at ?? "");
    const role = String((m as any).role ?? "");
    if (!slug || !sid || !at) continue;
    const key = `${slug}::${sid}`;
    sessionsLast.set(key, { slug, sessionId: sid, lastAt: at, lastRole: role });
  }
  const unanswered = [...sessionsLast.values()]
    .filter((s) => s.lastRole === "user" && s.lastAt < unansweredCutoffIso)
    .slice(0, 200)
    .map((s) => ({
      slug: s.slug,
      businessName: businessBySlug.get(s.slug)?.name ?? s.slug,
      session_id: s.sessionId,
      lastAt: s.lastAt,
    }));

  const fallbackNeedles = [
    "מומלץ לדבר ישירות עם הצוות שלנו",
    "טלפון שירות לקוחות",
    "לא מצאתי את המידע המדויק",
    "לא מצאתי את המידע",
  ];
  const fallbackBySession = new Map<string, number>();
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const t = String(msg.content ?? "");
    if (!t) continue;
    if (!fallbackNeedles.some((n) => t.includes(n))) continue;
    const slug = String(msg.business_slug ?? "").trim().toLowerCase();
    const sid = safeSessionId(msg.session_id);
    const key = `${slug}::${sid}`;
    fallbackBySession.set(key, (fallbackBySession.get(key) ?? 0) + 1);
  }
  const repeatedFallback = [...fallbackBySession.entries()]
    .filter(([, c]) => c > 1)
    .slice(0, 200)
    .map(([key, count]) => {
      const [slug, sid] = key.split("::");
      return {
        slug: slug ?? "",
        businessName: businessBySlug.get(slug ?? "")?.name ?? (slug ?? ""),
        session_id: sid ?? "",
        count,
      };
    });

  return {
    range,
    errors: {
      messagesError: messagesRes.error?.message ?? null,
      conversionsError: conversionsRes.error?.message ?? null,
    },
    kpis: {
      dailyActiveConversations: sessionsDaily.size,
      monthlyActiveConversations: sessionsMonthly.size,
      annualActiveConversations: sessionsYearly.size,
    },
    businessOverview,
    errorLogs: errorLogs.slice(0, 10),
    alerts: {
      unanswered,
      repeatedFallback,
    },
  };
}
