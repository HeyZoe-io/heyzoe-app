import { AdminNav } from "@/app/admin/AdminNav";
import {
  loadAdminDailyUnsent,
  MANUAL_BLOCK_REASON,
  unsentGroup,
  type UnsentGroup,
} from "@/lib/admin-daily-unsent-summary";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminUnsentPage() {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  const email = user.user?.email?.trim().toLowerCase() ?? "";
  if (!email || !isAdminAllowedEmail(email)) redirect("/admin/login");

  const rows = await loadAdminDailyUnsent(createSupabaseAdminClient(), new Date());
  const groupLabel: Record<UnsentGroup, string> = {
    problem: "לא יצא",
    manual: MANUAL_BLOCK_REASON,
    expected: "צפוי",
  };
  const groupOrder: Record<UnsentGroup, number> = { problem: 0, manual: 1, expected: 2 };
  const counts: Record<UnsentGroup, number> = { problem: 0, manual: 0, expected: 0 };
  const sorted = rows
    .map((row) => ({ row, group: unsentGroup(row) }))
    .sort((a, b) => groupOrder[a.group] - groupOrder[b.group]);
  for (const item of sorted) counts[item.group] += 1;

  return (
    <main dir="rtl" style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <AdminNav active="businesses" />
      <h1 style={{ fontSize: 22, marginTop: 20 }}>הודעות אוטומטיות שלא יצאו</h1>
      <p style={{ color: "#444" }}>
        24 השעות האחרונות. {counts.problem} לא יצאו, {counts.manual} {MANUAL_BLOCK_REASON}, {counts.expected} צפוי.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr>
            {["סוג", "עסק", "טריגר", "כלל", "איש קשר", "סיבה", "זמן"].map((label) => (
              <th key={label} style={{ textAlign: "right", borderBottom: "1px solid #ddd", padding: 8 }}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ row, group }, index) => (
            <tr key={`${row.business}-${row.trigger}-${row.contact}-${row.at}-${index}`}>
              <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{groupLabel[group]}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{row.business}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{row.trigger}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{row.rule ?? ""}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{row.contact}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{row.reason}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{row.at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
