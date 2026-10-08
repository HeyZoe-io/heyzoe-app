import { AdminNav } from "@/app/admin/AdminNav";
import { HeldActionButton } from "@/app/admin/held-sends/HeldActionButton";
import { HOLD_REASON_LABELS } from "@/lib/send-plan/alerts";
import { loadActivePauses, loadHeldRows, type HeldRow } from "@/lib/send-plan/holds";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cell = { padding: 8, borderBottom: "1px solid #f0f0f0", verticalAlign: "top" as const };

function slotLabel(slot: string | null): string {
  if (slot === "morning") return "09:00";
  if (slot === "evening") return "20:00";
  if (slot === "event") return "אירוע";
  if (slot === "queue") return "תור";
  return "";
}

export default async function AdminHeldSendsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  const email = user.user?.email?.trim().toLowerCase() ?? "";
  if (!email || !isAdminAllowedEmail(email)) redirect("/admin/login");

  const admin = createSupabaseAdminClient();
  const [held, pauses] = await Promise.all([loadHeldRows(admin), loadActivePauses(admin, new Date())]);

  const groups = new Map<string, { businessId: number; business: string; reason: string; rows: HeldRow[] }>();
  for (const row of held.rows) {
    const reason = row.hold_reason ?? "unknown";
    const key = `${row.business_id}|${reason}`;
    const group = groups.get(key) ?? { businessId: row.business_id, business: row.business, reason, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }

  return (
    <main dir="rtl" style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <AdminNav active="businesses" />
      <h1 style={{ fontSize: 22, marginTop: 20 }}>הודעות מעוכבות</h1>
      <p style={{ color: "#444" }}>
        {held.rows.length} הודעות מעוכבות. מה ששוחרר יוצא בשליחה הבאה (09:00 / 20:00), או מיד אם השליחה כבר עברה והוא
        עדיין רלוונטי. מה שלא שוחרר מתבטל בסוף היום.
      </p>
      {held.error ? <p style={{ color: "#b00020" }}>שגיאה בטעינה: {held.error}</p> : null}

      {pauses.length ? (
        <section style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 17 }}>טריגרים שנעצרו במפסק נפח</h2>
          <ul>
            {pauses.map((pause) => (
              <li key={`${pause.business_id}-${pause.trigger_key}`} style={{ marginBottom: 6 }}>
                {pause.business}: טריגר {pause.trigger_key}, {pause.reason ?? ""}{" "}
                <HeldActionButton
                  label="חידוש"
                  payload={{ action: "resume", business_id: pause.business_id, trigger_key: pause.trigger_key }}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {[...groups.values()].map((group) => (
        <section key={`${group.businessId}-${group.reason}`} style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 17, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {group.business} · {HOLD_REASON_LABELS[group.reason] ?? group.reason} · {group.rows.length}
            <HeldActionButton
              label="שחרור הקבוצה"
              payload={{ action: "release", group: { business_id: group.businessId, reason: group.reason } }}
              confirmText={`לשחרר ${group.rows.length} הודעות של ${group.business}?`}
            />
            <HeldActionButton
              label="ביטול הקבוצה"
              payload={{ action: "cancel", group: { business_id: group.businessId, reason: group.reason } }}
              confirmText={`לבטל ${group.rows.length} הודעות של ${group.business}?`}
            />
          </h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                {["יום", "שליחה", "טמפלייט", "איש קשר", "פירוט", "הודעה", ""].map((label) => (
                  <th key={label} style={{ textAlign: "right", borderBottom: "1px solid #ddd", padding: 8 }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => (
                <tr key={row.id}>
                  <td style={cell}>{row.plan_day ?? ""}</td>
                  <td style={cell}>{slotLabel(row.plan_slot)}</td>
                  <td style={cell}>{row.template_name}</td>
                  <td style={cell} dir="ltr">
                    {row.contact_phone}
                  </td>
                  <td style={cell}>{row.last_error ?? ""}</td>
                  <td style={{ ...cell, whiteSpace: "pre-wrap", maxWidth: 420 }}>{row.rendered_body ?? ""}</td>
                  <td style={{ ...cell, whiteSpace: "nowrap" }}>
                    <HeldActionButton label="שחרור" payload={{ action: "release", ids: [row.id] }} />{" "}
                    <HeldActionButton label="ביטול" payload={{ action: "cancel", ids: [row.id] }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
