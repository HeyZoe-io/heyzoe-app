import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { AdminNav } from "@/app/admin/AdminNav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BizRow = {
  id: number;
  slug: string;
  name: string | null;
  plan: string | null;
  is_active: boolean | null;
  whatsapp_number: string | null;
};

export default async function AdminBusinessesPage() {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  const email = user.user?.email?.trim().toLowerCase() ?? "";
  if (!email || !isAdminAllowedEmail(email)) redirect("/admin/login");

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("businesses")
    .select("id, slug, name, plan, is_active, whatsapp_number")
    .order("created_at", { ascending: false })
    .limit(2000);

  const businesses = (data ?? []) as any as BizRow[];

  function planLabel(plan: string | null): string {
    const p = String(plan ?? "").trim().toLowerCase();
    if (p === "premium" || p === "pro") return "premium";
    return "basic";
  }

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
        <header style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "end", justifyContent: "space-between" }}>
          <div style={{ textAlign: "right" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 400, color: "#1a0a3c" }}>עסקים</h1>
            <p style={{ margin: "6px 0 0", fontSize: 14, color: "#6b5b9a" }}>רשימת עסקים + סטטוס + חבילה + לינקים לדשבורד</p>
          </div>

          <AdminNav active="businesses" />
        </header>

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
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
              <thead>
                <tr style={{ textAlign: "right", fontSize: 12, color: "#6b5b9a" }}>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(113,51,218,0.10)" }}>עסק</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(113,51,218,0.10)" }}>slug</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(113,51,218,0.10)" }}>מספר ווטסאפ</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(113,51,218,0.10)" }}>חבילה</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(113,51,218,0.10)" }}>סטטוס</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(113,51,218,0.10)" }}>לינקים</th>
                </tr>
              </thead>
              <tbody>
                {businesses.map((b) => {
                  const slug = String(b.slug ?? "").trim();
                  const active = Boolean(b.is_active);
                  const plan = planLabel(b.plan);
                  const whatsappNumber = String(b.whatsapp_number ?? "").trim();
                  return (
                    <tr key={String(b.id)} style={{ borderBottom: "1px solid rgba(113,51,218,0.08)" }}>
                      <td style={{ padding: "10px 8px", fontWeight: 400, color: "#1a0a3c" }}>{b.name || slug}</td>
                      <td style={{ padding: "10px 8px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, color: "#6b5b9a" }}>
                        {slug}
                      </td>
                      <td style={{ padding: "10px 8px", fontSize: 12, color: whatsappNumber ? "#1a0a3c" : "#9b8dbf" }}>
                        {whatsappNumber || "—"}
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
                            fontWeight: 400,
                            border: "1px solid rgba(113,51,218,0.18)",
                          }}
                        >
                          {plan}
                        </span>
                      </td>
                      <td style={{ padding: "10px 8px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "4px 10px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 400,
                            border: "1px solid rgba(0,0,0,0.06)",
                            background: active ? "rgba(53,255,112,0.12)" : "rgba(226,75,74,0.10)",
                            color: active ? "#0f5132" : "#8a1c1c",
                          }}
                        >
                          {active ? "פעיל" : "לא פעיל"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 8px", fontSize: 13 }}>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <a
                            href={`/${encodeURIComponent(slug)}/analytics`}
                            style={{ color: "#7133da", textDecoration: "underline", textUnderlineOffset: 4, fontWeight: 400 }}
                          >
                            אנליטיקס
                          </a>
                          <a
                            href={`/${encodeURIComponent(slug)}/conversations`}
                            style={{ color: "#7133da", textDecoration: "underline", textUnderlineOffset: 4, fontWeight: 400 }}
                          >
                            שיחות
                          </a>
                          <a
                            href={`/${encodeURIComponent(slug)}/settings`}
                            style={{ color: "#7133da", textDecoration: "underline", textUnderlineOffset: 4, fontWeight: 400 }}
                          >
                            הגדרות
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

