import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { loadLeadsForAdmin } from "@/lib/leads-data";
import { AdminNav } from "@/app/admin/AdminNav";
import ContactsClient from "@/app/[slug]/contacts/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminLeadsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  const email = user.user?.email?.trim().toLowerCase() ?? "";
  if (!email || !isAdminAllowedEmail(email)) redirect("/admin/login");

  const admin = createSupabaseAdminClient();
  const rows = await loadLeadsForAdmin(admin);

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
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "end",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 20,
          }}
        >
          <div style={{ textAlign: "right" }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 400, color: "#1a0a3c" }}>לידים</h1>
            <p style={{ margin: "6px 0 0", fontSize: 14, color: "#6b5b9a" }}>
              כל הלידים מכל העסקים — פילטרים, סטטוסים וייצוא
            </p>
          </div>
          <AdminNav active="leads" />
        </header>

        <ContactsClient initialContacts={rows} adminMode />
      </div>
    </main>
  );
}
