import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RangeKey = "7" | "30" | "90";
type SourceMode = "all" | "purchases";

function resolveRangeKey(raw: unknown): RangeKey {
  const r = String(raw ?? "").trim();
  if (r === "30" || r === "90") return r;
  return "7";
}

function resolveSourceMode(raw: unknown): SourceMode {
  const r = String(raw ?? "").trim();
  return r === "purchases" ? "purchases" : "all";
}

function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function currencyIls(n: number) {
  try {
    return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${Math.round(n)} ₪`;
  }
}

type EventRow = {
  event_type: string;
  value: number | null;
  source: string | null;
  label: string | null;
  session_id: string;
  created_at: string;
};

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  const email = user.user?.email?.trim().toLowerCase() ?? "";
  if (!email || !isAdminAllowedEmail(email)) redirect("/admin/login");

  const sp = await searchParams;
  const range = resolveRangeKey(typeof sp.range === "string" ? sp.range : Array.isArray(sp.range) ? sp.range[0] : "");
  const sourceMode = resolveSourceMode(
    typeof sp.source === "string" ? sp.source : Array.isArray(sp.source) ? sp.source[0] : ""
  );
  const days = range === "90" ? 90 : range === "30" ? 30 : 7;
  const since = daysAgoIso(days);

  const admin = createSupabaseAdminClient();
  const { data: eventsRaw, error } = await admin
    .from("analytics_events")
    .select("event_type, value, source, label, session_id, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200_000);

  const events = ((eventsRaw ?? []) as any as EventRow[]).filter((e) => e && e.session_id);

  const countByType = new Map<string, number>();
  const firstPageviewAtBySession = new Map<string, number>();
  const firstPurchaseAtBySession = new Map<string, number>();
  const purchasesBySession = new Map<string, number>(); // value sum
  const sessionsByType = new Map<string, Set<string>>();
  const sourceCounts = new Map<string, number>();
  const purchaserSessionsBySource = new Map<string, Set<string>>();
  const ctaClicksByLabel = new Map<string, number>();
  let purchaseRevenue = 0;

  for (const e of events) {
    const t = String(e.event_type ?? "").trim();
    const sid = String(e.session_id ?? "").trim();
    if (!t || !sid) continue;

    countByType.set(t, (countByType.get(t) ?? 0) + 1);
    const set = sessionsByType.get(t) ?? new Set<string>();
    set.add(sid);
    sessionsByType.set(t, set);

    const atMs = new Date(e.created_at).getTime();
    if (Number.isFinite(atMs)) {
      if (t === "pageview") {
        const prev = firstPageviewAtBySession.get(sid);
        if (!prev || atMs < prev) firstPageviewAtBySession.set(sid, atMs);
      }
      if (t === "purchase") {
        const prev = firstPurchaseAtBySession.get(sid);
        if (!prev || atMs < prev) firstPurchaseAtBySession.set(sid, atMs);
      }
    }

    if (t === "purchase") {
      const v = typeof e.value === "number" ? e.value : e.value != null ? Number(e.value) : NaN;
      if (Number.isFinite(v) && v > 0) {
        purchaseRevenue += v;
        purchasesBySession.set(sid, (purchasesBySession.get(sid) ?? 0) + v);
      }
    }

    if (t === "cta_click") {
      const lbl = (e.label ?? "").trim() || "לא מזוהה";
      ctaClicksByLabel.set(lbl, (ctaClicksByLabel.get(lbl) ?? 0) + 1);
    }

    const src = (e.source ?? "").trim() || "direct";
    sourceCounts.set(src, (sourceCounts.get(src) ?? 0) + 1);
    if (t === "purchase") {
      const set = purchaserSessionsBySource.get(src) ?? new Set<string>();
      set.add(sid);
      purchaserSessionsBySource.set(src, set);
    }
  }

  const pageviews = countByType.get("pageview") ?? 0;
  const purchases = countByType.get("purchase") ?? 0;

  // avg days from first pageview to first purchase per session
  const deltasDays: number[] = [];
  for (const [sid, pvMs] of firstPageviewAtBySession.entries()) {
    const prMs = firstPurchaseAtBySession.get(sid);
    if (!prMs) continue;
    const d = (prMs - pvMs) / (1000 * 60 * 60 * 24);
    if (Number.isFinite(d) && d >= 0) deltasDays.push(d);
  }
  const avgDaysToPurchase =
    deltasDays.length ? deltasDays.reduce((a, b) => a + b, 0) / deltasDays.length : 0;

  const funnelSteps = [
    "pageview", // צפייה בעמוד
    "lp_10s",
    "lp_30s",
    "lp_60s",
    "lp_scroll_50",
    "lp_scroll_75",
    "cta_click", // כפתורים
    "chat_open",
    "checkout_start",
    "purchase",
  ] as const;
  const funnelCounts = funnelSteps.map((s) => countByType.get(s) ?? 0);
  const funnelBase = funnelCounts[0] || 0;

  const checkoutStarts = countByType.get("checkout_start") ?? 0;
  const abandoned = Math.max(0, checkoutStarts - purchases);
  const abandonmentRate = checkoutStarts ? Math.round((abandoned / checkoutStarts) * 100) : 0;

  const sourcesAllSorted = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const sourcesPurchSorted = [...purchaserSessionsBySource.entries()]
    .map(([src, set]) => [src, set.size] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const sourcesSorted = sourceMode === "purchases" ? sourcesPurchSorted : sourcesAllSorted;
  const sourcesMax = sourcesSorted[0]?.[1] ?? 1;
  const ctaLabelsSorted = [...ctaClicksByLabel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);

  const pill =
    "rounded-full px-3 py-1.5 text-xs font-normal transition border border-[rgba(113,51,218,0.18)]";

  return (
    <main
      dir="rtl"
      style={{
        minHeight: "100vh",
        background: "#f5f3ff",
        fontFamily: "Fredoka, Heebo, system-ui, sans-serif",
        padding: "28px 18px 48px",
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <header style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "end", justifyContent: "space-between" }}>
          <div style={{ textAlign: "right" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 400, color: "#1a0a3c" }}>אנליטיקס — דף נחיתה</h1>
            <p style={{ margin: "6px 0 0", fontSize: 14, color: "#6b5b9a" }}>
              סקירה של אירועי tracking שנשמרו ב־Supabase
            </p>
            {error ? (
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "#c81e5b" }}>שגיאת טעינה: {error.message}</p>
            ) : null}
          </div>

          <nav style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-start" }}>
            <a className={pill} href="/admin/dashboard" style={{ background: "white", color: "#7133da", textDecoration: "none" }}>
              ראשי
            </a>
            <a className={pill} href="/admin/analytics" style={{ background: "#7133da", color: "white", textDecoration: "none" }}>
              analytics
            </a>
            <a className={pill} href="/admin/businesses" style={{ background: "white", color: "#7133da", textDecoration: "none" }}>
              עסקים
            </a>
            <a className={pill} href="/admin/requests" style={{ background: "white", color: "#7133da", textDecoration: "none" }}>
              פניות מבעלי עסקים
            </a>
          </nav>
        </header>

        <section
          style={{
            marginTop: 18,
            background: "rgba(255,255,255,0.65)",
            border: "1px solid rgba(113,51,218,0.14)",
            borderRadius: 18,
            padding: 12,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["7", "30", "90"] as const).map((k) => (
              <a
                key={k}
                href={`/admin/analytics?range=${k}`}
                className={pill}
                style={{
                  background: range === k ? "linear-gradient(135deg,#7133da,#ff92ff)" : "white",
                  color: range === k ? "white" : "#3a2a6c",
                  textDecoration: "none",
                }}
              >
                {k === "7" ? "7 ימים" : k === "30" ? "30 ימים" : "90 ימים"}
              </a>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "#6b5b9a" }}>טווח: {days} ימים אחרונים</div>
        </section>

        <section style={{ marginTop: 16, display: "grid", gap: 12, gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
          {[
            { label: "צפיות בדף", value: String(pageviews) },
            { label: "רכישות", value: String(purchases) },
            { label: "הכנסה מרכישות", value: currencyIls(purchaseRevenue) },
            { label: "זמן ממוצע עד רכישה", value: `${avgDaysToPurchase.toFixed(1)} ימים` },
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
              <div style={{ fontSize: 12, color: "#6b5b9a", fontWeight: 400 }}>{m.label}</div>
              <div style={{ marginTop: 8, fontSize: 26, fontWeight: 300, color: "#1a0a3c" }}>{m.value}</div>
            </div>
          ))}
        </section>

        <section
          style={{
            marginTop: 16,
            background: "white",
            border: "1px solid rgba(113,51,218,0.14)",
            borderRadius: 18,
            boxShadow: "0 8px 40px rgba(113,51,218,0.08)",
            padding: 16,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 400, color: "#1a0a3c" }}>Funnel</h2>
          <p style={{ margin: "6px 0 12px", fontSize: 13, color: "#6b5b9a" }}>
            pageview → cta_click → chat_open → checkout_start → purchase (אחוזים מתוך pageview)
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            {funnelSteps.map((step, i) => {
              const c = funnelCounts[i] ?? 0;
              const pct = funnelBase ? Math.round((c / funnelBase) * 100) : 0;
              const w = funnelBase ? Math.max(2, Math.round((c / funnelBase) * 100)) : 0;
              return (
                <div key={step} style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                    <span style={{ color: "#1a0a3c", fontWeight: 400 }}>{step}</span>
                    <span style={{ color: "#6b5b9a" }}>
                      {c} ({pct}%)
                    </span>
                  </div>
                  <div style={{ height: 10, background: "#f5f3ff", borderRadius: 999 }}>
                    <div
                      style={{
                        width: `${w}%`,
                        height: "100%",
                        borderRadius: 999,
                        background: "linear-gradient(135deg,#7133da,#ff92ff)",
                      }}
                    />
                  </div>
                  {step === "cta_click" ? (
                    <div
                      style={{
                        marginTop: 6,
                        padding: "10px 12px",
                        borderRadius: 14,
                        border: "1px solid rgba(113,51,218,0.12)",
                        background: "rgba(245,243,255,0.65)",
                      }}
                    >
                      <div style={{ fontSize: 12, color: "#6b5b9a", marginBottom: 6 }}>כפתורים שנלחצו</div>
                      {ctaLabelsSorted.length ? (
                        <div style={{ display: "grid", gap: 6 }}>
                          {ctaLabelsSorted.map(([lbl, n]) => (
                            <div key={lbl} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                              <span style={{ color: "#1a0a3c" }}>{lbl}</span>
                              <span style={{ color: "#6b5b9a" }}>{n}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, color: "#6b5b9a" }}>אין קליקים עדיין.</div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <section
          style={{
            marginTop: 16,
            display: "grid",
            gap: 12,
            gridTemplateColumns: "1.2fr 0.8fr",
          }}
        >
          <div
            style={{
              background: "white",
              border: "1px solid rgba(113,51,218,0.14)",
              borderRadius: 18,
              boxShadow: "0 8px 40px rgba(113,51,218,0.08)",
              padding: 16,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 400, color: "#1a0a3c" }}>מקור תנועה</h2>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <p style={{ margin: "6px 0 12px", fontSize: 13, color: "#6b5b9a" }}>
                קיבוץ לפי utm_source · {sourceMode === "purchases" ? "רוכשים (unique sessions)" : "כל האירועים"}
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <a
                  href={`/admin/analytics?range=${range}&source=all`}
                  className={pill}
                  style={{
                    background: sourceMode === "all" ? "linear-gradient(135deg,#7133da,#ff92ff)" : "white",
                    color: sourceMode === "all" ? "white" : "#3a2a6c",
                    textDecoration: "none",
                  }}
                >
                  כולם
                </a>
                <a
                  href={`/admin/analytics?range=${range}&source=purchases`}
                  className={pill}
                  style={{
                    background: sourceMode === "purchases" ? "linear-gradient(135deg,#7133da,#ff92ff)" : "white",
                    color: sourceMode === "purchases" ? "white" : "#3a2a6c",
                    textDecoration: "none",
                  }}
                >
                  רכישות
                </a>
              </div>
            </div>
            {sourcesSorted.length ? (
              <div style={{ display: "grid", gap: 10 }}>
                {sourcesSorted.map(([src, c]) => {
                  const w = sourcesMax ? Math.max(3, Math.round((c / sourcesMax) * 100)) : 0;
                  return (
                    <div key={src} style={{ display: "grid", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                        <span style={{ color: "#1a0a3c", fontWeight: 400 }}>{src}</span>
                        <span style={{ color: "#6b5b9a" }}>{c}</span>
                      </div>
                      <div style={{ height: 10, background: "#f5f3ff", borderRadius: 999 }}>
                        <div style={{ width: `${w}%`, height: "100%", borderRadius: 999, background: "#7133da" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: "#6b5b9a" }}>אין נתונים עדיין.</p>
            )}
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
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 400, color: "#1a0a3c" }}>נטישת צ׳קאאוט</h2>
            <p style={{ margin: "6px 0 12px", fontSize: 13, color: "#6b5b9a" }}>
              checkout_start מול purchase
            </p>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ fontWeight: 400, color: "#1a0a3c" }}>checkout_start</span>
                <span style={{ color: "#6b5b9a" }}>{checkoutStarts}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ fontWeight: 400, color: "#1a0a3c" }}>purchase</span>
                <span style={{ color: "#6b5b9a" }}>{purchases}</span>
              </div>
              <div style={{ height: 1, background: "rgba(113,51,218,0.10)" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ fontWeight: 400, color: "#c81e5b" }}>נטשו</span>
                <span style={{ color: "#c81e5b", fontWeight: 400 }}>
                  {abandoned} ({abandonmentRate}%)
                </span>
              </div>
            </div>
          </div>
        </section>

        <section
          style={{
            marginTop: 16,
            background: "white",
            border: "1px solid rgba(113,51,218,0.14)",
            borderRadius: 18,
            boxShadow: "0 8px 40px rgba(113,51,218,0.08)",
            padding: 16,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 400, color: "#1a0a3c" }}>הקלטות מבקרים — דף הנחיתה</h2>
          <p style={{ margin: "6px 0 12px", fontSize: 13, color: "#6b5b9a", lineHeight: 1.6 }}>
            צפה בהקלטות אמיתיות של מה שמבקרים עשו בדף — איפה לחצו, איפה נתקעו, מתי עזבו
          </p>
          <a
            href="https://app.posthog.com"
            target="_blank"
            rel="noreferrer"
            className={pill}
            style={{
              display: "inline-block",
              background: "linear-gradient(135deg,#7133da,#ff92ff)",
              color: "white",
              textDecoration: "none",
            }}
          >
            פתח PostHog
          </a>
        </section>
      </div>
    </main>
  );
}

