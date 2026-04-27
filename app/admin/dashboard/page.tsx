import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveAdminAllowedEmail } from "@/lib/server-env";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function isoDateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export default async function AdminDashboardPage({ searchParams }: Props) {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  const allowedEmail = resolveAdminAllowedEmail();
  const email = user.user?.email?.trim().toLowerCase() ?? "";
  if (!email || email !== allowedEmail) redirect("/admin/login");

  const sp = await searchParams;
  const fromRaw = typeof sp.from === "string" ? sp.from : Array.isArray(sp.from) ? sp.from[0] : "";
  const toRaw = typeof sp.to === "string" ? sp.to : Array.isArray(sp.to) ? sp.to[0] : "";
  const fromDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : isoDateOnly(daysAgo(30));
  const toDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : isoDateOnly(new Date());
  const fromTs = `${fromDateOnly}T00:00:00.000Z`;
  const toTs = `${toDateOnly}T23:59:59.999Z`;

  const admin = createSupabaseAdminClient();

  const [{ data: bizRows }, { data: msgRows }, { data: inquiries }, { data: waChannels }, { data: msgWeek }] = await Promise.all([
    admin
      .from("businesses")
      .select("id, slug, name, plan, plan_price, is_active, updated_at, cancellation_effective_at")
      .order("created_at", { ascending: true })
      .limit(5000),
    admin
      .from("messages")
      .select("business_slug, created_at")
      .gte("created_at", fromTs)
      .lte("created_at", toTs)
      .order("created_at", { ascending: false })
      .limit(120000),
    admin
      .from("business_inquiries")
      .select("id, business_id, message, created_at, is_read")
      .order("created_at", { ascending: false })
      .limit(3),
    admin.from("whatsapp_channels").select("business_slug, phone_display, is_active").eq("is_active", true).limit(200),
    admin
      .from("messages")
      .select("business_slug, session_id, created_at, role")
      .gte("created_at", fromTs)
      .lte("created_at", toTs)
      .order("created_at", { ascending: true })
      .limit(80000),
  ]);

  const businesses = (bizRows ?? []) as any[];
  const activeBusinesses = businesses.filter((b) => Boolean((b as any).is_active));
  const activeCustomers = activeBusinesses.length;
  const mrr = activeBusinesses.reduce((sum, b) => {
    const v = (b as any).plan_price;
    const n = typeof v === "number" ? v : v != null ? Number(v) : 0;
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
  const mrrDisplay = mrr;

  // Churn: businesses that became inactive in selected range (best-effort).
  const churn = businesses.filter((b) => {
    const inactive = !Boolean((b as any).is_active);
    if (!inactive) return false;
    const eff = (b as any).cancellation_effective_at ? new Date(String((b as any).cancellation_effective_at)) : null;
    const upd = (b as any).updated_at ? new Date(String((b as any).updated_at)) : null;
    const at = eff && !Number.isNaN(eff.getTime()) ? eff : upd && !Number.isNaN(upd.getTime()) ? upd : null;
    if (!at) return false;
    const ms = at.getTime();
    return ms >= new Date(fromTs).getTime() && ms <= new Date(toTs).getTime();
  }).length;

  const bySlug = new Map<string, number>();
  for (const r of msgRows ?? []) {
    const slug = String((r as any).business_slug ?? "").trim().toLowerCase();
    if (!slug) continue;
    bySlug.set(slug, (bySlug.get(slug) ?? 0) + 1);
  }
  const leadingBusiness = [...bySlug.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  const incomingSessionsBySlug = new Map<string, Set<string>>();
  for (const m of msgWeek ?? []) {
    const slug = String((m as any).business_slug ?? "").trim().toLowerCase();
    const sid = String((m as any).session_id ?? "").trim() || "";
    const role = String((m as any).role ?? "");
    if (!slug || !sid) continue;
    if (role !== "user") continue;
    const set = incomingSessionsBySlug.get(slug) ?? new Set<string>();
    set.add(sid);
    incomingSessionsBySlug.set(slug, set);
  }

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
      inquiries={(inquiries ?? []) as any[]}
      waNumbers={(waChannels ?? []).map((c: any) => ({
        phone: String(c.phone_display ?? "") || "—",
        business_slug: String(c.business_slug ?? "").trim().toLowerCase(),
        incoming_7d: incomingSessionsBySlug.get(String(c.business_slug ?? "").trim().toLowerCase())?.size ?? 0,
      }))}
      businessOverview={businesses.map((b) => ({
        slug: String((b as any).slug ?? ""),
        name: String((b as any).name ?? ""),
        plan: (String((b as any).plan ?? "basic") === "premium" ? "premium" : "basic") as "basic" | "premium",
        active: Boolean((b as any).is_active),
        conversations_total: bySlug.get(String((b as any).slug ?? "").trim().toLowerCase()) ?? 0,
        conversations_week: incomingSessionsBySlug.get(String((b as any).slug ?? "").trim().toLowerCase())?.size ?? 0,
      }))}
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
  from: string;
  to: string;
  activeCustomers: number;
  mrr: number;
  churn: number;
  leadingBusiness: string;
  inquiries: Array<{ id: number; business_id: number | null; message: string; created_at: string; is_read: boolean }>;
  waNumbers: Array<{ phone: string; business_slug: string; incoming_7d: number }>;
  businessOverview: Array<{
    slug: string;
    name: string;
    plan: "basic" | "premium";
    active: boolean;
    conversations_total: number;
    conversations_week: number;
  }>;
  health: Array<{ key: string; label: string; status: "ok" | "warn" | "bad"; detail: string }>;
}) {
  const pillBase =
    "display:inline-block;padding:8px 12px;border-radius:999px;font-size:12px;font-weight:600;text-decoration:none;border:1px solid rgba(113,51,218,0.18)";

  return (
    <main
      dir="rtl"
      style={{
        minHeight: "100vh",
        background: "#f5f3ff",
        fontFamily: "Fredoka, Heebo, system-ui, sans-serif",
        padding: "28px 18px 48px",
        color: "#1a0a3c",
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          <div style={{ textAlign: "right" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600 }}>דשבורד סופר אדמין</h1>
            <p style={{ margin: "6px 0 0", fontSize: 14, color: "#6b5b9a" }}>סקירה מערכתית + עסקים + התראות</p>
          </div>
          <nav style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-start" }}>
            <Link href="/admin/dashboard" prefetch style={{ cssText: pillBase, background: "#7133da", color: "white" } as any}>
              ראשי
            </Link>
            <Link href="/admin/analytics" prefetch style={{ cssText: pillBase, background: "white", color: "#7133da" } as any}>
              analytics
            </Link>
            <Link href="/admin/dashboard#businesses" prefetch style={{ cssText: pillBase, background: "white", color: "#7133da" } as any}>
              עסקים
            </Link>
            <Link href="/admin/requests" prefetch style={{ cssText: pillBase, background: "white", color: "#7133da" } as any}>
              פניות מבעלי עסקים
            </Link>
          </nav>
        </header>

        <section
          style={{
            marginTop: 16,
            background: "rgba(255,255,255,0.72)",
            border: "1px solid rgba(113,51,218,0.14)",
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
                  border: "1px solid rgba(113,51,218,0.18)",
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
                  border: "1px solid rgba(113,51,218,0.18)",
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
                border: "1px solid rgba(113,51,218,0.18)",
                background: "linear-gradient(135deg,#7133da,#ff92ff)",
                color: "white",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              עדכן
            </button>
          </form>
          <div style={{ fontSize: 12, color: "#6b5b9a" }}>ברירת מחדל: חודש אחרון</div>
        </section>

        <section style={{ marginTop: 14, display: "grid", gap: 12, gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
          {[
            { label: "לקוחות פעילים", value: String(props.activeCustomers) },
            { label: "הכנסה (MRR)", value: moneyIls(props.mrr) },
            { label: "ביטולים החודש (Churn)", value: String(props.churn) },
            { label: "עסק מוביל", value: props.leadingBusiness },
          ].map((m) => (
            <div
              key={m.label}
              style={{
                background: "white",
                border: "1px solid rgba(113,51,218,0.14)",
                borderRadius: 18,
                boxShadow: "0 8px 40px rgba(113,51,218,0.10)",
                padding: "14px 14px 16px",
                textAlign: "right",
              }}
            >
              <div style={{ fontSize: 12, color: "#6b5b9a", fontWeight: 500 }}>{m.label}</div>
              <div style={{ marginTop: 8, fontSize: 26, fontWeight: 600, color: "#1a0a3c" }}>{m.value}</div>
            </div>
          ))}
        </section>

        <section style={{ marginTop: 14, display: "grid", gap: 12, gridTemplateColumns: "1.1fr 0.9fr" }}>
          <div
            style={{
              background: "white",
              border: "1px solid rgba(113,51,218,0.14)",
              borderRadius: 18,
              boxShadow: "0 8px 40px rgba(113,51,218,0.08)",
              padding: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>פניות מבעלי עסקים</h2>
              <Link href="/admin/contacts" prefetch style={{ color: "#7133da", fontWeight: 500, textDecoration: "none", fontSize: 12 }}>
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
                      background: "rgba(245,243,255,0.65)",
                      display: "block",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div style={{ fontSize: 12, color: "#6b5b9a" }}>{formatRelTime(i.created_at)}</div>
                      {!i.is_read ? (
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
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
              border: "1px solid rgba(113,51,218,0.14)",
              borderRadius: 18,
              boxShadow: "0 8px 40px rgba(113,51,218,0.08)",
              padding: 16,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>מספרי WhatsApp פעילים</h2>
            <p style={{ margin: "6px 0 12px", fontSize: 13, color: "#6b5b9a" }}>מקור: whatsapp_channels · שיחות נכנסות (7 ימים)</p>
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 10 }}>
              <details>
                <summary style={{ cursor: "pointer", color: "#7133da", fontWeight: 600, fontSize: 12 }}>הוסף מספר +</summary>
                <div style={{ marginTop: 8, fontSize: 13, color: "#6b5b9a", lineHeight: 1.6 }}>
                  לרכישת מספר חדש פנה ל־Twilio Console ואז הגדר אותו ב־Supabase
                </div>
              </details>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {props.waNumbers.length ? (
                props.waNumbers.slice(0, 10).map((n, idx) => (
                  <div key={idx} style={{ border: "1px solid rgba(113,51,218,0.12)", borderRadius: 16, padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                      <span style={{ fontWeight: 500 }}>{n.phone}</span>
                      <span style={{ color: "#6b5b9a" }}>{n.incoming_7d} נכנסות</span>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, color: "#6b5b9a" }}>{n.business_slug}</div>
                  </div>
                ))
              ) : (
                <div style={{ color: "#6b5b9a", fontSize: 13, textAlign: "center", padding: 10 }}>אין מספרים פעילים.</div>
              )}
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
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Business Overview</h2>
          <p style={{ margin: "6px 0 12px", fontSize: 13, color: "#6b5b9a" }}>לחיצה על שורה → /admin/businesses/[slug]</p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr style={{ textAlign: "right", fontSize: 12, color: "#6b5b9a" }}>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(113,51,218,0.10)" }}>עסק</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(113,51,218,0.10)" }}>חבילה</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(113,51,218,0.10)" }}>שיחות כלל</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(113,51,218,0.10)" }}>שיחות שבוע</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(113,51,218,0.10)" }}>סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {props.businessOverview
                  .sort((a, b) => Number(b.active) - Number(a.active) || b.conversations_total - a.conversations_total)
                  .slice(0, 200)
                  .map((b) => (
                    <tr key={b.slug} style={{ borderBottom: "1px solid rgba(113,51,218,0.08)" }}>
                      <td style={{ padding: "10px 8px" }}>
                        <Link
                          href={`/admin/businesses/${encodeURIComponent(b.slug)}`}
                          prefetch
                          style={{ color: "#1a0a3c", fontWeight: 600, textDecoration: "none" }}
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
                            background: "rgba(113,51,218,0.10)",
                            color: "#7133da",
                            fontSize: 12,
                            fontWeight: 600,
                            border: "1px solid rgba(113,51,218,0.18)",
                          }}
                        >
                          {b.plan === "premium" ? "premium" : "basic"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 8px", fontWeight: 500 }}>{b.conversations_total}</td>
                      <td style={{ padding: "10px 8px", fontWeight: 500 }}>{b.conversations_week}</td>
                      <td style={{ padding: "10px 8px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "4px 10px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 600,
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
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>System Health</h2>
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {props.health.map((h) => (
              <div key={h.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: dotColor(h.status) }} />
                  <span style={{ fontWeight: 500 }}>{h.label}</span>
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
