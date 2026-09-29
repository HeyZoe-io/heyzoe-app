import { Suspense } from "react";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import Link from "next/link";
import { AdminNav } from "@/app/admin/AdminNav";
import MarketingDashboardClient from "./MarketingDashboardClient";
import type { ZoeBusinessOption } from "@/app/admin/zoe/ZoeConversationsTab";
import type { ZoeAdminSessionSummary } from "@/lib/zoe-admin-conversations";
import { resolveAdminPackage, type AdminPackageKind } from "@/lib/admin-package";
import { getIsraelMonthStartUtc } from "@/lib/israel-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  searchParams:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

function firstSearchParam(v: string | string[] | undefined): string {
  if (v == null) return "";
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" ? x.trim() : "";
}

function isoDateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

type BizRow = {
  id: number;
  slug: string | null;
  name: string | null;
  plan: string | null;
  plan_price: number | string | null;
  is_active: boolean | null;
  updated_at: string | null;
  cancellation_effective_at: string | null;
  intro_period_ends_at?: string | null;
  intro_full_price_at?: string | null;
};

type InquiryRow = {
  id: number;
  business_id: number | null;
  message: string;
  created_at: string;
  is_read: boolean;
};

const OPENED_PAGE = 1000;
/** 40k שורות = תקרת בטיחות. מעבר לזה הדשבורד מסמן שהספירה נחתכה. */
const OPENED_MAX_PAGES = 40;

/** שיחות שנפתחו = אנשי קשר שזואי דיברה איתם (last_zoe_reply_at), לא שורות הודעות. */
async function loadOpenedReplyRows(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  sinceIso: string
): Promise<{ rows: Array<{ businessId: number; at: string }>; truncated: boolean }> {
  const rows: Array<{ businessId: number; at: string }> = [];
  for (let page = 0; page < OPENED_MAX_PAGES; page++) {
    const from = page * OPENED_PAGE;
    const { data, error } = await admin
      .from("contacts")
      .select("id, business_id, last_zoe_reply_at")
      .gte("last_zoe_reply_at", sinceIso)
      .order("last_zoe_reply_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + OPENED_PAGE - 1);
    if (error) {
      console.error(
        "[admin/dashboard] opened conversations failed — if the column is missing run supabase/contacts_last_zoe_reply_at.sql:",
        error.message
      );
      return { rows, truncated: false };
    }
    const batch = data ?? [];
    for (const r of batch) {
      const businessId = Number((r as { business_id?: unknown }).business_id);
      const at = String((r as { last_zoe_reply_at?: unknown }).last_zoe_reply_at ?? "");
      if (!Number.isFinite(businessId) || !at) continue;
      rows.push({ businessId, at });
    }
    if (batch.length < OPENED_PAGE) return { rows, truncated: false };
  }
  console.error("[admin/dashboard] opened conversations truncated at", OPENED_MAX_PAGES * OPENED_PAGE);
  return { rows, truncated: true };
}

function countByBusiness(
  rows: Array<{ businessId: number; at: string }>,
  include: (at: string) => boolean
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const row of rows) {
    if (!include(row.at)) continue;
    counts.set(row.businessId, (counts.get(row.businessId) ?? 0) + 1);
  }
  return counts;
}

export default async function AdminDashboardPage({ searchParams }: Props) {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  const email = user.user?.email?.trim().toLowerCase() ?? "";
  if (!email || !isAdminAllowedEmail(email)) redirect("/admin/login");

  const sp = (await Promise.resolve(searchParams)) ?? {};
  const marketingTab = firstSearchParam(sp.tab).toLowerCase() === "marketing";
  const fromRaw = typeof sp.from === "string" ? sp.from : Array.isArray(sp.from) ? sp.from[0] : "";
  const toRaw = typeof sp.to === "string" ? sp.to : Array.isArray(sp.to) ? sp.to[0] : "";
  const fromDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : isoDateOnly(daysAgo(30));
  const toDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : isoDateOnly(new Date());
  const fromTs = `${fromDateOnly}T00:00:00.000Z`;
  const toTs = `${toDateOnly}T23:59:59.999Z`;
  const admin = createSupabaseAdminClient();

  if (marketingTab) {
    // Marketing sub-dashboard shows only the זואי שיווק line (ZoeConversationsTab marketingOnly),
    // so there's no need to preload the (slow, truncation-prone) all-businesses conversation list here.
    return (
      <DashboardV2
        marketingTab
        from={fromDateOnly}
        to={toDateOnly}
        activeCustomers={0}
        mrr={0}
        churn={0}
        leadingBusiness="—"
        inquiries={[]}
        businessOverview={[]}
        health={[]}
        marketingBusinesses={[]}
        marketingInitialAllSessions={[]}
      />
    );
  }

  const bizSelectWithIntro =
    "id, slug, name, plan, plan_price, is_active, updated_at, cancellation_effective_at, intro_period_ends_at, intro_full_price_at";
  const monthStartIso = getIsraelMonthStartUtc(new Date()).toISOString();
  const openedSinceIso = fromTs < monthStartIso ? fromTs : monthStartIso;

  const [bizQuery, inquiriesQuery, opened] = await Promise.all([
    admin.from("businesses").select(bizSelectWithIntro).order("created_at", { ascending: true }).limit(5000),
    admin
      .from("business_inquiries")
      .select("id, business_id, message, created_at, is_read")
      .order("created_at", { ascending: false })
      .limit(3),
    loadOpenedReplyRows(admin, openedSinceIso),
  ]);

  let bizRows = (bizQuery.data ?? null) as BizRow[] | null;
  if (bizQuery.error) {
    console.error(
      "[admin/dashboard] intro columns unavailable — run supabase/businesses_intro_period.sql:",
      bizQuery.error.message
    );
    const fallback = await admin
      .from("businesses")
      .select("id, slug, name, plan, plan_price, is_active, updated_at, cancellation_effective_at")
      .order("created_at", { ascending: true })
      .limit(5000);
    bizRows = (fallback.data ?? null) as BizRow[] | null;
    if (fallback.error) console.error("[admin/dashboard] businesses query failed:", fallback.error.message);
  }
  const inquiries = inquiriesQuery.data;

  const businesses = bizRows ?? [];
  const fromMs = new Date(fromTs).getTime();
  const toMs = new Date(toTs).getTime();
  const monthMs = new Date(monthStartIso).getTime();
  const monthCounts = countByBusiness(opened.rows, (at) => {
    const ms = new Date(at).getTime();
    return Number.isFinite(ms) && ms >= monthMs;
  });
  const rangeCounts = countByBusiness(opened.rows, (at) => {
    const ms = new Date(at).getTime();
    return Number.isFinite(ms) && ms >= fromMs && ms <= toMs;
  });

  const businessOverview = businesses.map((b) => {
    const id = Number(b.id);
    const pkg = resolveAdminPackage({
      plan: b.plan,
      planPrice: b.plan_price,
      introPeriodEndsAt: b.intro_period_ends_at,
      introFullPriceAt: b.intro_full_price_at,
    });
    return {
      slug: String(b.slug ?? ""),
      name: String(b.name ?? ""),
      packageKind: pkg.kind,
      packageLabel: pkg.label,
      packageDetail: pkg.detail,
      billedIls: pkg.billedIls,
      conversationLimit: pkg.conversationLimit,
      active: Boolean(b.is_active),
      conversations_month: Number.isFinite(id) ? (monthCounts.get(id) ?? 0) : 0,
      conversations_range: Number.isFinite(id) ? (rangeCounts.get(id) ?? 0) : 0,
    };
  });

  const activeOverview = businessOverview.filter((b) => b.active);
  const activeCustomers = activeOverview.length;
  const mrrDisplay = activeOverview.reduce((sum, b) => sum + b.billedIls, 0);
  const leading = [...businessOverview].sort((a, b) => b.conversations_range - a.conversations_range)[0];
  const leadingBusiness = leading && leading.conversations_range > 0 ? leading.name || leading.slug : "—";

  // Churn: businesses that became inactive in selected range (best-effort).
  const churn = businesses.filter((b) => {
    const inactive = !Boolean(b.is_active);
    if (!inactive) return false;
    const eff = b.cancellation_effective_at ? new Date(String(b.cancellation_effective_at)) : null;
    const upd = b.updated_at ? new Date(String(b.updated_at)) : null;
    const at = eff && !Number.isNaN(eff.getTime()) ? eff : upd && !Number.isNaN(upd.getTime()) ? upd : null;
    if (!at) return false;
    const ms = at.getTime();
    return ms >= new Date(fromTs).getTime() && ms <= new Date(toTs).getTime();
  }).length;

  const health = (
    await Promise.all([
      (async () => {
        try {
          const sid = process.env.TWILIO_ACCOUNT_SID?.trim() || "";
          const tok = process.env.TWILIO_AUTH_TOKEN?.trim() || "";
          if (!sid || !tok) return { key: "twilio", label: "Twilio", status: "warn" as const, detail: "חסרים credentials" };
          const auth = Buffer.from(`${sid}:${tok}`).toString("base64");
          const r = await fetch("https://api.twilio.com/2010-04-01/Accounts.json", { headers: { Authorization: `Basic ${auth}` }, cache: "no-store" });
          return { key: "twilio", label: "Twilio", status: (r.ok ? "ok" : "bad") as "ok" | "bad", detail: r.ok ? "פעיל" : `שגיאה (${r.status})` };
        } catch {
          return { key: "twilio", label: "Twilio", status: "bad" as const, detail: "שגיאת בדיקה" };
        }
      })(),
      (async () => {
        try {
          const key = process.env.ANTHROPIC_API_KEY?.trim() || "";
          if (!key) return { key: "claude", label: "Claude API", status: "warn" as const, detail: "חסר ANTHROPIC_API_KEY" };
          const r = await fetch("https://api.anthropic.com/v1/models", {
            method: "GET",
            headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
            cache: "no-store",
          });
          return { key: "claude", label: "Claude API", status: (r.ok ? "ok" : "bad") as "ok" | "bad", detail: r.ok ? "תקין" : `שגיאה (${r.status})` };
        } catch {
          return { key: "claude", label: "Claude API", status: "bad" as const, detail: "שגיאת בדיקה" };
        }
      })(),
      (async () => {
        try {
          const { count, error } = await admin.from("conversations").select("id", { count: "exact", head: true });
          if (error) throw error;
          return { key: "db_conversations", label: "Supabase DB (conversations)", status: "ok" as const, detail: `${count ?? 0} שורות` };
        } catch {
          const { count } = await admin.from("messages").select("id", { count: "exact", head: true });
          return { key: "db_conversations", label: "Supabase DB (messages)", status: "warn" as const, detail: `${count ?? 0} שורות` };
        }
      })(),
      (async () => {
        try {
          const dayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const { count, error } = await admin.from("webhook_logs").select("id", { count: "exact", head: true }).eq("status", "error").gte("created_at", dayIso);
          if (error) throw error;
          return { key: "webhook_errors", label: "שגיאות webhook (24 שעות)", status: ((count ?? 0) > 0 ? "warn" : "ok") as "warn" | "ok", detail: `${count ?? 0}` };
        } catch {
          return { key: "webhook_errors", label: "שגיאות webhook (24 שעות)", status: "warn" as const, detail: "N/A" };
        }
      })(),
      (async () => {
        try {
          const dayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const { count, error } = await admin.from("conversations").select("id", { count: "exact", head: true }).eq("fallback", true).gte("created_at", dayIso);
          if (error) throw error;
          return { key: "fallback_24h", label: "Fallback זואי (24 שעות)", status: ((count ?? 0) > 10 ? "warn" : "ok") as "warn" | "ok", detail: `${count ?? 0}` };
        } catch {
          return { key: "fallback_24h", label: "Fallback זואי (24 שעות)", status: "warn" as const, detail: "N/A" };
        }
      })(),
    ])
  ) as Array<{ key: string; label: string; status: "ok" | "warn" | "bad"; detail: string }>;

  return (
    <DashboardV2
      from={fromDateOnly}
      to={toDateOnly}
      activeCustomers={activeCustomers}
      mrr={mrrDisplay}
      churn={churn}
      leadingBusiness={leadingBusiness}
      countsTruncated={opened.truncated}
      inquiries={(inquiries ?? []) as InquiryRow[]}
      businessOverview={businessOverview}
      health={health}
    />
  );
}

function dotColor(status: "ok" | "warn" | "bad") {
  if (status === "ok") return "#35ff70";
  if (status === "bad") return "#e24b4a";
  return "#f59e0b";
}

function formatRelTime(iso: string) {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 60) return `לפני ${mins} דק׳`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `לפני ${h} שעות`;
  const days = Math.floor(h / 24);
  return `לפני ${days} ימים`;
}

function moneyIls(n: number) {
  try {
    return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${Math.round(n)} ₪`;
  }
}

function DashboardV2(props: {
  marketingTab?: boolean;
  from: string;
  to: string;
  activeCustomers: number;
  mrr: number;
  churn: number;
  leadingBusiness: string;
  countsTruncated?: boolean;
  inquiries: Array<{ id: number; business_id: number | null; message: string; created_at: string; is_read: boolean }>;
  businessOverview: Array<{
    slug: string;
    name: string;
    packageKind: AdminPackageKind;
    packageLabel: string;
    packageDetail: string;
    billedIls: number;
    conversationLimit: number;
    active: boolean;
    conversations_month: number;
    conversations_range: number;
  }>;
  health: Array<{ key: string; label: string; status: "ok" | "warn" | "bad"; detail: string }>;
  marketingBusinesses?: ZoeBusinessOption[];
  marketingInitialAllSessions?: ZoeAdminSessionSummary[];
}) {
  const isMarketing = Boolean(props.marketingTab);

  if (isMarketing) {
    return (
      <main
        dir="rtl"
        style={{
          minHeight: "100vh",
          background: "#fafafa",
          fontFamily: "Fredoka, Heebo, system-ui, sans-serif",
          padding: "28px 18px 48px",
          color: "#1a0a3c",
        }}
      >
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: "0 0 5px", fontSize: 12, color: "#7133da", fontWeight: 600 }}>אדמין</p>
              <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em" }}>פלואו שיווקי</h1>
            </div>
            <AdminNav active="marketing" />
          </header>

          <Suspense
            fallback={
              <div
                style={{
                  marginTop: 24,
                  padding: 24,
                  textAlign: "right",
                  color: "#6b5b9a",
                  fontSize: 14,
                }}
              >
                טוען…
              </div>
            }
          >
            <MarketingDashboardClient
              businesses={props.marketingBusinesses ?? []}
              initialAllSessions={props.marketingInitialAllSessions ?? []}
            />
          </Suspense>
        </div>
      </main>
    );
  }

  return (
    <main
      dir="rtl"
      style={{
        minHeight: "100vh",
        background: "#fafafa",
        fontFamily: "Fredoka, Heebo, system-ui, sans-serif",
        padding: "28px 18px 48px",
        color: "#1a0a3c",
      }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: "0 0 5px", fontSize: 12, color: "#7133da", fontWeight: 600 }}>HeyZoe Admin</p>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em" }}>דשבורד אדמין</h1>
            <p style={{ margin: "6px 0 0", fontSize: 14, color: "#71717a" }}>סקירה נקייה של לקוחות, הכנסות, פעילות ופניות</p>
          </div>
          <AdminNav active="dashboard" />
        </header>

        <section
          style={{
            marginTop: 16,
            background: "white",
            border: "1px solid rgba(24,24,27,0.08)",
            borderRadius: 18,
            padding: 12,
            display: "flex",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
          }}
        >
          <form method="get" action="/admin/dashboard" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#6b5b9a", marginBottom: 4 }}>מ־</label>
              <input
                name="from"
                type="date"
                defaultValue={props.from}
                style={{
                  height: 38,
                  padding: "0 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(24,24,27,0.12)",
                  background: "white",
                  color: "#1a0a3c",
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#6b5b9a", marginBottom: 4 }}>עד</label>
              <input
                name="to"
                type="date"
                defaultValue={props.to}
                style={{
                  height: 38,
                  padding: "0 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(24,24,27,0.12)",
                  background: "white",
                  color: "#1a0a3c",
                }}
              />
            </div>
            <button
              type="submit"
              style={{
                height: 38,
                padding: "0 14px",
                borderRadius: 999,
                border: "1px solid #7133da",
                background: "#7133da",
                color: "white",
                fontWeight: 400,
                cursor: "pointer",
              }}
            >
              עדכן
            </button>
          </form>
          <div style={{ fontSize: 12, color: "#6b5b9a" }}>ברירת מחדל: חודש אחרון</div>
        </section>

        <section style={{ marginTop: 14, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          {[
            { label: "לקוחות פעילים", value: String(props.activeCustomers) },
            { label: "חיוב חודשי בפועל", value: moneyIls(props.mrr) },
            { label: "ביטולים בטווח", value: String(props.churn) },
            { label: "עסק מוביל בטווח", value: props.leadingBusiness },
          ].map((m) => (
            <div
              key={m.label}
              style={{
                background: "white",
                border: "1px solid rgba(24,24,27,0.08)",
                borderRadius: 18,
                boxShadow: "0 12px 34px rgba(24,24,27,0.06)",
                padding: "14px 14px 16px",
                textAlign: "right",
              }}
            >
              <div style={{ fontSize: 12, color: "#6b5b9a", fontWeight: 400 }}>{m.label}</div>
              <div style={{ marginTop: 8, fontSize: 26, fontWeight: 300, color: "#1a0a3c" }}>{m.value}</div>
            </div>
          ))}
        </section>

        <section style={{ marginTop: 14, display: "grid", gap: 12, gridTemplateColumns: "minmax(0, 1.1fr) minmax(260px, 0.9fr)" }}>
          <div
            style={{
              background: "white",
              border: "1px solid rgba(24,24,27,0.08)",
              borderRadius: 18,
              boxShadow: "0 12px 34px rgba(24,24,27,0.06)",
              padding: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 400 }}>פניות מבעלי עסקים</h2>
              <Link href="/admin/businesses?tab=requests" prefetch style={{ color: "#7133da", fontWeight: 400, textDecoration: "none", fontSize: 12 }}>
                כל הפניות
              </Link>
            </div>
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {props.inquiries.length ? (
                props.inquiries.map((i) => (
                  <Link
                    key={i.id}
                    href="/admin/contacts"
                    prefetch
                    style={{
                      textDecoration: "none",
                      color: "inherit",
                      border: "1px solid rgba(113,51,218,0.12)",
                      borderRadius: 16,
                      padding: 12,
                      background: "rgba(250,250,250,0.9)",
                      display: "block",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div style={{ fontSize: 12, color: "#6b5b9a" }}>{formatRelTime(i.created_at)}</div>
                      {!i.is_read ? (
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 400,
                            padding: "4px 10px",
                            borderRadius: 999,
                            background: "rgba(255,146,255,0.16)",
                            color: "#7133da",
                            border: "1px solid rgba(113,51,218,0.18)",
                          }}
                        >
                          חדש
                        </span>
                      ) : null}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 14, color: "#1a0a3c" }}>
                      {String(i.message ?? "").slice(0, 50)}
                      {String(i.message ?? "").length > 50 ? "…" : ""}
                    </div>
                  </Link>
                ))
              ) : (
                <div style={{ color: "#6b5b9a", fontSize: 13, textAlign: "center", padding: 10 }}>אין פניות עדיין.</div>
              )}
            </div>
          </div>

          <div
            style={{
              background: "white",
              border: "1px solid rgba(24,24,27,0.08)",
              borderRadius: 18,
              boxShadow: "0 12px 34px rgba(24,24,27,0.06)",
              padding: 16,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 400 }}>מוקדי עבודה</h2>
            <p style={{ margin: "6px 0 12px", fontSize: 13, color: "#6b5b9a" }}>
              קיצורי דרך לאזורים שעברו לעמוד עסקים.
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              {[
                { href: "/admin/businesses", label: "רשימת עסקים", desc: "סטטוס, חבילה, מספר ווטסאפ וקישורים" },
                { href: "/admin/businesses?tab=cancellations", label: "ביטולים", desc: "סיבות ביטול ופירוט" },
                { href: "/admin/businesses?tab=requests", label: "פניות מבעלי עסקים", desc: "צ׳אט עזרה ובקשות חזרה טלפונית" },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  style={{
                    display: "block",
                    border: "1px solid rgba(24,24,27,0.08)",
                    borderRadius: 16,
                    padding: 12,
                    textDecoration: "none",
                    color: "inherit",
                    background: "rgba(250,250,250,0.9)",
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 500, color: "#1a0a3c" }}>{item.label}</div>
                  <div style={{ marginTop: 3, fontSize: 12, color: "#6b5b9a" }}>{item.desc}</div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section
          id="businesses"
          style={{
            marginTop: 14,
            background: "white",
            border: "1px solid rgba(113,51,218,0.14)",
            borderRadius: 18,
            boxShadow: "0 8px 40px rgba(113,51,218,0.08)",
            padding: 16,
          }}
        >
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 400 }}>Business Overview</h2>
          <p style={{ margin: "6px 0 12px", fontSize: 13, color: "#6b5b9a" }}>
            חבילה וסכום לפי מה שנגבה בפועל, לפני מע״מ (חודש ראשון ב־₪5). שיחות החודש = מספרים שזואי דיברה איתם מתחילת החודש בישראל, מול מכסת החבילה.
          </p>
          {props.countsTruncated ? (
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "#8a1c1c" }}>
              הספירה נחתכה אחרי 40,000 אנשי קשר. יש להריץ את האינדקס ולבדוק שוב.
            </p>
          ) : null}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
              <thead>
                <tr style={{ textAlign: "right", fontSize: 12, color: "#6b5b9a" }}>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(113,51,218,0.10)" }}>עסק</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(113,51,218,0.10)" }}>חבילה</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(113,51,218,0.10)" }}>נגבה</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(113,51,218,0.10)" }}>שיחות החודש</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(113,51,218,0.10)" }}>שיחות בטווח</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(113,51,218,0.10)" }}>סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {[...props.businessOverview]
                  .sort((a, b) => Number(b.active) - Number(a.active) || b.conversations_month - a.conversations_month)
                  .slice(0, 200)
                  .map((b) => (
                    <tr key={b.slug} style={{ borderBottom: "1px solid rgba(113,51,218,0.08)" }}>
                      <td style={{ padding: "10px 8px" }}>
                        <Link
                          href={`/admin/businesses/${encodeURIComponent(b.slug)}`}
                          prefetch
                          style={{ color: "#1a0a3c", fontWeight: 400, textDecoration: "none" }}
                        >
                          {b.name || b.slug}
                        </Link>
                        <div style={{ fontSize: 12, color: "#6b5b9a" }}>{b.slug}</div>
                      </td>
                      <td style={{ padding: "10px 8px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "4px 10px",
                            borderRadius: 999,
                            background:
                              b.packageKind === "intro_ended"
                                ? "rgba(245,158,11,0.16)"
                                : "rgba(113,51,218,0.10)",
                            color: b.packageKind === "intro_ended" ? "#92400e" : "#7133da",
                            fontSize: 12,
                            fontWeight: 400,
                            border:
                              b.packageKind === "intro_ended"
                                ? "1px solid rgba(245,158,11,0.35)"
                                : "1px solid rgba(113,51,218,0.18)",
                          }}
                        >
                          {b.packageLabel}
                        </span>
                        {b.packageDetail ? (
                          <div style={{ marginTop: 4, fontSize: 11, color: "#6b5b9a" }}>{b.packageDetail}</div>
                        ) : null}
                      </td>
                      <td style={{ padding: "10px 8px", fontWeight: 500 }}>{moneyIls(b.billedIls)}</td>
                      <td style={{ padding: "10px 8px", fontWeight: 400 }}>
                        {b.conversations_month}
                        <span style={{ color: "#6b5b9a", fontWeight: 400 }}> / {b.conversationLimit}</span>
                      </td>
                      <td style={{ padding: "10px 8px", fontWeight: 400 }}>{b.conversations_range}</td>
                      <td style={{ padding: "10px 8px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "4px 10px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 400,
                            border: "1px solid rgba(0,0,0,0.06)",
                            background: b.active ? "rgba(53,255,112,0.12)" : "rgba(226,75,74,0.10)",
                            color: b.active ? "#0f5132" : "#8a1c1c",
                          }}
                        >
                          {b.active ? "פעיל" : "לא פעיל"}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        <section
          style={{
            marginTop: 14,
            background: "white",
            border: "1px solid rgba(113,51,218,0.14)",
            borderRadius: 18,
            boxShadow: "0 8px 40px rgba(113,51,218,0.08)",
            padding: 16,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 400 }}>System Health</h2>
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {props.health.map((h) => (
              <div key={h.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: dotColor(h.status) }} />
                  <span style={{ fontWeight: 400 }}>{h.label}</span>
                </div>
                <span style={{ color: "#6b5b9a", fontSize: 13 }}>{h.detail}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
