import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveAdminAllowedEmail } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function relTime(iso: string) {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.floor(hours / 24);
  return `לפני ${days} ימים`;
}

export default async function AdminContactsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  const allowedEmail = resolveAdminAllowedEmail();
  const email = user.user?.email?.trim().toLowerCase() ?? "";
  if (!email || email !== allowedEmail) redirect("/admin/login");

  const admin = createSupabaseAdminClient();
  const { data: inquiries } = await admin
    .from("business_inquiries")
    .select("id, business_id, message, created_at, is_read")
    .order("created_at", { ascending: false })
    .limit(120);

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
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: "#1a0a3c" }}>פניות מבעלי עסקים</h1>
            <p style={{ margin: "6px 0 0", fontSize: 14, color: "#6b5b9a" }}>תיבת פניות פשוטה (business_inquiries)</p>
          </div>
          <a href="/admin/dashboard" style={{ color: "#7133da", fontWeight: 700, textDecoration: "none" }}>
            חזרה לדשבורד
          </a>
        </div>

        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          {(inquiries ?? []).length ? (
            inquiries!.map((x: any) => (
              <div
                key={x.id}
                style={{
                  background: "white",
                  border: "1px solid rgba(113,51,218,0.14)",
                  borderRadius: 18,
                  boxShadow: "0 8px 40px rgba(113,51,218,0.08)",
                  padding: 14,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <div style={{ fontSize: 12, color: "#6b5b9a" }}>{relTime(String(x.created_at))}</div>
                  {!x.is_read ? (
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
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
                <div style={{ marginTop: 8, fontSize: 14, color: "#1a0a3c", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                  {String(x.message ?? "").slice(0, 600)}
                </div>
              </div>
            ))
          ) : (
            <div
              style={{
                background: "white",
                border: "1px solid rgba(113,51,218,0.14)",
                borderRadius: 18,
                padding: 18,
                color: "#6b5b9a",
                textAlign: "center",
              }}
            >
              אין פניות עדיין.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

