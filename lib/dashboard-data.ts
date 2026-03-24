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

  const [messagesRes, conversionsRes] = await Promise.all([
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
  ]);

  const messages = (messagesRes.data ?? []) as MessageRow[];
  const conversions = (conversionsRes.data ?? []) as ConversionRow[];

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

  const businessOverview = [...sessionsByBusiness.entries()]
    .map(([slug, data]) => {
      const now = Date.now();
      const seniorityDays = Math.max(
        1,
        Math.floor((now - data.firstAt.getTime()) / (1000 * 60 * 60 * 24))
      );
      const active = now - data.lastAt.getTime() < 1000 * 60 * 60 * 24 * 7;
      return {
        slug,
        active,
        seniorityDays,
        firstAt: data.firstAt.toISOString(),
        lastAt: data.lastAt.toISOString(),
        sessions: data.sessionIds.size,
      };
    })
    .sort((a, b) => b.sessions - a.sessions);

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
    funnel: {
      visitors: visitors.size,
      engaged: engaged.size,
      clickedCta: clicked.size,
      conversionRate: visitors.size ? Math.round((clicked.size / visitors.size) * 100) : 0,
    },
    businessOverview,
    dropoffByMessageNumber: Object.entries(dropoffByMessageNumber).map(([step, count]) => ({
      step,
      count,
    })),
    dropoffByIntent: [...intentDropoff.entries()].map(([intent, count]) => ({ intent, count })),
    errorLogs: errorLogs.slice(0, 10),
    modelUsageDistribution,
  };
}
