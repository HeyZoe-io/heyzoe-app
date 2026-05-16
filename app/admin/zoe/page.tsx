import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { AdminNav } from "@/app/admin/AdminNav";
import ZoeGuidelinesClient from "./ZoeGuidelinesClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminZoePage() {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  const email = user.user?.email?.trim().toLowerCase() ?? "";
  if (!email || !isAdminAllowedEmail(email)) redirect("/admin/login");

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
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 14,
            alignItems: "end",
            justifyContent: "space-between",
            marginBottom: 24,
          }}
        >
          <div style={{ textAlign: "right" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 400 }}>זואי</h1>
            <p style={{ margin: "6px 0 0", fontSize: 14, color: "#6b5b9a" }}>
              אופי, חוקיות ומבנה תשובה — לבוט של בעלי העסקים
            </p>
          </div>
          <AdminNav active="zoe" />
        </header>
        <ZoeGuidelinesClient />
      </div>
    </main>
  );
}
