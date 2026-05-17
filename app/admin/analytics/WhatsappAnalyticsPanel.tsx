import type { WhatsappAnalyticsSnapshot } from "@/lib/admin-marketing-analytics";
import { MARKETING_PHONE_DISPLAY } from "@/lib/marketing-whatsapp";

function currencyIls(n: number) {
  try {
    return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${Math.round(n)} ₪`;
  }
}

export default function WhatsappAnalyticsPanel({ data }: { data: WhatsappAnalyticsSnapshot }) {
  const card = {
    background: "white",
    border: "1px solid rgba(113,51,218,0.14)",
    borderRadius: 18,
    boxShadow: "0 8px 40px rgba(113,51,218,0.10)",
    padding: "14px 16px",
    textAlign: "right" as const,
  };

  return (
    <>
      <p style={{ margin: "0 0 14px", fontSize: 13, color: "#6b5b9a", textAlign: "right", lineHeight: 1.6 }}>
        קו שיווקי: {MARKETING_PHONE_DISPLAY} · לידים חדשים = מספרים שהתחילו פלואו בטווח · המרות מדף = אירועי tracking ב־lp-leads
      </p>

      <section style={{ marginBottom: 18 }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 500, color: "#1a0a3c", textAlign: "right" }}>
          אינויטים
        </h2>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          <div style={card}>
            <div style={{ fontSize: 12, color: "#6b5b9a" }}>ליד חדש</div>
            <p style={{ margin: "4px 0 8px", fontSize: 12, color: "#6b5b9a" }}>שיחה שהתחילה ממספר חדש בפלואו</p>
            <div style={{ fontSize: 28, fontWeight: 300, color: "#1a0a3c" }}>{data.newLeads}</div>
          </div>
          <div style={card}>
            <div style={{ fontSize: 12, color: "#6b5b9a" }}>הפסיקו לענות (ללא CTA)</div>
            <p style={{ margin: "4px 0 8px", fontSize: 12, color: "#6b5b9a" }}>
              נשלח CTA בפלואו, אין מענה 24+ שעות
            </p>
            <div style={{ fontSize: 28, fontWeight: 300, color: "#c81e5b" }}>{data.droppedNoCta}</div>
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 18 }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 500, color: "#1a0a3c", textAlign: "right" }}>
          המרות (דף נחיתה)
        </h2>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          <div style={card}>
            <div style={{ fontSize: 12, color: "#6b5b9a" }}>לחיצה על תמחור</div>
            <p style={{ margin: "4px 0 8px", fontSize: 12, color: "#6b5b9a" }}>lp-leads#pricing — צפייה / ניווט לסקשן</p>
            <div style={{ fontSize: 28, fontWeight: 300, color: "#1a0a3c" }}>{data.pricingViews}</div>
          </div>
          <div style={card}>
            <div style={{ fontSize: 12, color: "#6b5b9a" }}>מעבר לשיחה בוואטסאפ</div>
            <p style={{ margin: "4px 0 8px", fontSize: 12, color: "#6b5b9a" }}>קליק על wa.me/972508318162</p>
            <div style={{ fontSize: 28, fontWeight: 300, color: "#1a0a3c" }}>{data.waLpClicks}</div>
          </div>
        </div>
      </section>

      <section
        style={{
          background: "white",
          border: "1px solid rgba(113,51,218,0.14)",
          borderRadius: 18,
          padding: 16,
          textAlign: "right",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500, color: "#1a0a3c" }}>
          המרות רכישה מלידי וואטסאפ (דף נחיתה)
        </h2>
        <p style={{ margin: "6px 0 14px", fontSize: 13, color: "#6b5b9a", lineHeight: 1.6 }}>
          <code style={{ fontSize: 12 }}>wa_lp</code> — קליק וואטסאפ בדף והמשך ברכישה בדפדפן ·{" "}
          <code style={{ fontSize: 12 }}>wa_marketing</code> — רכישה אחרי פלואו שיווקי (התאמה לפי טלפון ב־iCount IPN)
        </p>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <div>
            <div style={{ fontSize: 12, color: "#6b5b9a" }}>checkout_start</div>
            <div style={{ fontSize: 22, color: "#1a0a3c" }}>{data.waAttributedCheckout}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#6b5b9a" }}>purchase</div>
            <div style={{ fontSize: 22, color: "#1a0a3c" }}>{data.waAttributedPurchase}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#6b5b9a" }}>הכנסה</div>
            <div style={{ fontSize: 22, color: "#1a0a3c" }}>{currencyIls(data.waAttributedRevenue)}</div>
          </div>
        </div>
      </section>

      {data.droppedPhonesSample.length > 0 ? (
        <section
          style={{
            marginTop: 16,
            background: "rgba(255,255,255,0.85)",
            border: "1px solid rgba(113,51,218,0.12)",
            borderRadius: 14,
            padding: 14,
            textAlign: "right",
          }}
        >
          <div style={{ fontSize: 12, color: "#6b5b9a", marginBottom: 8 }}>דוגמאות לידים שלא לחצו CTA (מסוך)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-start" }}>
            {data.droppedPhonesSample.map((p) => (
              <span
                key={p}
                style={{
                  fontSize: 12,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "rgba(200,30,91,0.08)",
                  color: "#8b3058",
                }}
              >
                {p}
              </span>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
