import type { LandingAnalyticsSnapshot } from "@/lib/admin-landing-analytics";

function currencyIls(n: number) {
  try {
    return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${Math.round(n)} ₪`;
  }
}

export default function LandingAnalyticsPanel({
  data,
  range,
  sourceMode,
}: {
  data: LandingAnalyticsSnapshot;
  range: string;
  sourceMode: "all" | "purchases";
}) {
  const pill =
    "rounded-full px-3 py-1.5 text-xs font-normal transition border border-[rgba(113,51,218,0.18)]";

  return (
    <>
      <section style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
        {[
          { label: "צפיות בדף", value: String(data.pageviews) },
          { label: "רכישות", value: String(data.purchases) },
          { label: "הכנסה מרכישות", value: currencyIls(data.purchaseRevenue) },
          { label: "זמן ממוצע עד רכישה", value: `${data.avgDaysToPurchase.toFixed(1)} ימים` },
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

      {(data.waLpCheckout > 0 || data.waLpPurchases > 0) && (
        <section
          style={{
            marginTop: 16,
            background: "white",
            border: "1px solid rgba(113,51,218,0.14)",
            borderRadius: 18,
            padding: 16,
            textAlign: "right",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 400, color: "#1a0a3c" }}>המרות מוואטסאפ (דף נחיתה)</h2>
          <p style={{ margin: "6px 0 12px", fontSize: 13, color: "#6b5b9a" }}>
            checkout / purchase עם מקור wa_lp — לידים שלחצו קישור וואטסאפ בדף ואז המשיכו לרכישה (תוך 7 ימים)
          </p>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <div>
              <div style={{ fontSize: 12, color: "#6b5b9a" }}>checkout_start</div>
              <div style={{ fontSize: 22, color: "#1a0a3c" }}>{data.waLpCheckout}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#6b5b9a" }}>purchase</div>
              <div style={{ fontSize: 22, color: "#1a0a3c" }}>{data.waLpPurchases}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#6b5b9a" }}>הכנסה</div>
              <div style={{ fontSize: 22, color: "#1a0a3c" }}>{currencyIls(data.waLpRevenue)}</div>
            </div>
          </div>
        </section>
      )}

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
          {data.funnelSteps.map((step, i) => {
            const c = data.funnelCounts[i] ?? 0;
            const pct = data.funnelBase ? Math.round((c / data.funnelBase) * 100) : 0;
            const w = data.funnelBase ? Math.max(2, Math.round((c / data.funnelBase) * 100)) : 0;
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
                    {data.ctaLabelsSorted.length ? (
                      <div style={{ display: "grid", gap: 6 }}>
                        {data.ctaLabelsSorted.map(([lbl, n]) => (
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
          {data.sourcesSorted.length ? (
            <div style={{ display: "grid", gap: 10 }}>
              {data.sourcesSorted.map(([src, c]) => {
                const w = data.sourcesMax ? Math.max(3, Math.round((c / data.sourcesMax) * 100)) : 0;
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
          <p style={{ margin: "6px 0 12px", fontSize: 13, color: "#6b5b9a" }}>checkout_start מול purchase</p>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ fontWeight: 400, color: "#1a0a3c" }}>checkout_start</span>
              <span style={{ color: "#6b5b9a" }}>{data.checkoutStarts}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ fontWeight: 400, color: "#1a0a3c" }}>purchase</span>
              <span style={{ color: "#6b5b9a" }}>{data.purchases}</span>
            </div>
            <div style={{ height: 1, background: "rgba(113,51,218,0.10)" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ fontWeight: 400, color: "#c81e5b" }}>נטשו</span>
              <span style={{ color: "#c81e5b", fontWeight: 400 }}>
                {data.abandoned} ({data.abandonmentRate}%)
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
    </>
  );
}
