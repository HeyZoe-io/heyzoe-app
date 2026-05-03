import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SurveyRow = {
  id: string;
  created_at: string;
  reason: string;
  reason_detail: string | null;
  business_slug: string | null;
  business_id: number | null;
};

function formatSurveyDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("he-IL", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default async function AdminCancellationsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  const email = user.user?.email?.trim().toLowerCase() ?? "";
  if (!email || !isAdminAllowedEmail(email)) redirect("/admin/login");

  const admin = createSupabaseAdminClient();
  const { data: surveysRaw, error } = await admin
    .from("cancellation_surveys")
    .select("id, created_at, reason, reason_detail, business_slug, business_id")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("[admin/cancellations] query failed:", error);
  }

  const surveys = ((surveysRaw ?? []) as unknown as SurveyRow[]).filter(Boolean);
  const bizIds = [
    ...new Set(surveys.map((s) => s.business_id).filter((x): x is number => typeof x === "number" && Number.isFinite(x))),
  ];
  const nameById = new Map<number, string>();
  if (bizIds.length) {
    const { data: bizRows } = await admin.from("businesses").select("id, name").in("id", bizIds);
    for (const b of bizRows ?? []) {
      nameById.set(Number((b as any).id), String((b as any).name ?? "").trim());
    }
  }

  const total = surveys.length;
  const countByReason = new Map<string, number>();
  for (const s of surveys) {
    const r = String(s.reason ?? "").trim() || "לא ידוע";
    countByReason.set(r, (countByReason.get(r) ?? 0) + 1);
  }
  const aggregates = [...countByReason.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({
      reason,
      count,
      pct: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }));

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
        color: "#1a0a3c",
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <header style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "end", justifyContent: "space-between" }}>
          <div style={{ textAlign: "right" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 400, color: "#1a0a3c" }}>ביטולים</h1>
            <p style={{ margin: "6px 0 0", fontSize: 14, color: "#6b5b9a" }}>
              שאלון ביטול מנוי — אגרגציה ופרטים
            </p>
          </div>

          <nav style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-start" }}>
            <Link className={pill} href="/admin/dashboard" style={{ background: "white", color: "#7133da", textDecoration: "none" }}>
              ראשי
            </Link>
            <Link className={pill} href="/admin/analytics" style={{ background: "white", color: "#7133da", textDecoration: "none" }}>
              analytics
            </Link>
            <Link className={pill} href="/admin/businesses" style={{ background: "white", color: "#7133da", textDecoration: "none" }}>
              עסקים
            </Link>
            <Link className={pill} href="/admin/cancellations" style={{ background: "#7133da", color: "white", textDecoration: "none" }}>
              ביטולים
            </Link>
            <Link className={pill} href="/admin/requests" style={{ background: "white", color: "#7133da", textDecoration: "none" }}>
              פניות מבעלי עסקים
            </Link>
          </nav>
        </header>

        <section style={{ marginTop: 20 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 600, color: "#1a0a3c" }}>סיכום לפי סיבה</h2>
          {total === 0 ? (
            <p style={{ color: "#6b5b9a", fontSize: 14 }}>עדיין אין תשובות שאלון ביטול.</p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              {aggregates.map((row) => (
                <div
                  key={row.reason}
                  style={{
                    background: "white",
                    border: "1px solid rgba(113,51,218,0.14)",
                    borderRadius: 16,
                    padding: "14px 16px",
                    boxShadow: "0 8px 28px rgba(113,51,218,0.06)",
                  }}
                >
                  <div style={{ fontSize: 13, color: "#6b5b9a", marginBottom: 6 }}>{row.reason}</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: "#7133da", lineHeight: 1.2 }}>{row.count}</div>
                  <div style={{ fontSize: 13, color: "#1a0a3c", marginTop: 4 }}>{row.pct}% מהביטולים</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 600, color: "#1a0a3c" }}>כל הביטולים</h2>
          <div
            style={{
              background: "white",
              border: "1px solid rgba(113,51,218,0.14)",
              borderRadius: 18,
              boxShadow: "0 8px 40px rgba(113,51,218,0.08)",
              overflow: "auto",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr style={{ fontSize: 12, color: "#6b5b9a", textAlign: "right" }}>
                  <th style={{ padding: "12px 14px", borderBottom: "1px solid rgba(113,51,218,0.1)" }}>שם עסק</th>
                  <th style={{ padding: "12px 14px", borderBottom: "1px solid rgba(113,51,218,0.1)" }}>תאריך ביטול</th>
                  <th style={{ padding: "12px 14px", borderBottom: "1px solid rgba(113,51,218,0.1)" }}>סיבה</th>
                  <th style={{ padding: "12px 14px", borderBottom: "1px solid rgba(113,51,218,0.1)" }}>פירוט</th>
                </tr>
              </thead>
              <tbody>
                {surveys.map((s) => {
                  const bid = typeof s.business_id === "number" ? s.business_id : null;
                  const bizName =
                    (bid != null ? nameById.get(bid) : "") ||
                    String(s.business_slug ?? "").trim() ||
                    "—";
                  const detail = String(s.reason_detail ?? "").trim();
                  return (
                    <tr key={s.id} style={{ borderBottom: "1px solid rgba(113,51,218,0.06)", fontSize: 13 }}>
                      <td style={{ padding: "12px 14px", verticalAlign: "top", fontWeight: 500 }}>{bizName}</td>
                      <td style={{ padding: "12px 14px", verticalAlign: "top", color: "#3a2a6c", whiteSpace: "nowrap" }}>
                        {formatSurveyDate(s.created_at)}
                      </td>
                      <td style={{ padding: "12px 14px", verticalAlign: "top", maxWidth: 220 }}>
                        {String(s.reason ?? "—")}
                      </td>
                      <td style={{ padding: "12px 14px", verticalAlign: "top", color: "#6b5b9a", maxWidth: 320 }}>
                        {detail || "—"}
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
