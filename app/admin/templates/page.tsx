import { AdminNav } from "@/app/admin/AdminNav";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { redirect } from "next/navigation";
import { resolveMarketingWabaId } from "@/lib/marketing-waba";
import { syncMarketingWabaTemplatesToDb } from "@/lib/meta-templates";
import AdminTemplatesClient, {
  type AdminFlowNodeOption,
  type AdminTemplateRow,
  type AdminTriggerRow,
} from "./AdminTemplatesClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminTemplatesPage() {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  const email = user.user?.email?.trim().toLowerCase() ?? "";
  if (!email || !isAdminAllowedEmail(email)) redirect("/admin/login");

  const admin = createSupabaseAdminClient();
  const [{ data: templatesRaw, error: tplErr }, { data: triggers, error: trigErr }, { data: nodes, error: nodeErr }] =
    await Promise.all([
      admin
        .from("marketing_whatsapp_templates")
        .select(
          "id, waba_template_id, name, category, language, status, disabled, components, created_at, updated_at"
        )
        .order("updated_at", { ascending: false }),
      admin
        .from("marketing_template_triggers")
        .select(
          "id, trigger_type, flow_node_id, delay_days, delay_direction, template_name, enabled, created_at"
        )
        .order("created_at", { ascending: true }),
      admin.from("marketing_flow_nodes").select("id, type, data"),
    ]);

  const migrationRequired =
    Boolean(tplErr && /does not exist|schema cache|marketing_whatsapp_templates/i.test(tplErr.message)) ||
    Boolean(trigErr && /does not exist|schema cache|marketing_template_triggers/i.test(trigErr.message));

  if (tplErr && !migrationRequired) {
    console.error("[admin/templates] list failed:", tplErr.message);
  }
  if (trigErr && !migrationRequired) {
    console.error("[admin/templates] triggers failed:", trigErr.message);
  }
  if (nodeErr) {
    console.error("[admin/templates] nodes failed:", nodeErr.message);
  }

  let templates = templatesRaw;
  if (!migrationRequired && (templates?.length ?? 0) === 0) {
    try {
      const wabaId = await resolveMarketingWabaId();
      if (wabaId) {
        await syncMarketingWabaTemplatesToDb(admin, wabaId);
        const again = await admin
          .from("marketing_whatsapp_templates")
          .select(
            "id, waba_template_id, name, category, language, status, disabled, components, created_at, updated_at"
          )
          .order("updated_at", { ascending: false });
        if (!again.error) templates = again.data;
      }
    } catch (e) {
      console.error("[admin/templates] initial Meta sync failed:", e);
    }
  }

  const flowNodes: AdminFlowNodeOption[] = ((nodes ?? []) as { id: string; type: string; data: unknown }[])
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }))
    .map((n, i) => {
      const data = n.data && typeof n.data === "object" ? (n.data as Record<string, unknown>) : {};
      const text = String(data.text ?? "").trim().replace(/\s+/g, " ");
      return {
        id: n.id,
        rank: i + 1,
        type: n.type,
        label: text ? text.slice(0, 48) : n.type,
      };
    });

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
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
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
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 400, color: "#1a0a3c" }}>טמפלייטים</h1>
            <p style={{ margin: "6px 0 0", fontSize: 14, color: "#6b5b9a" }}>
              טמפלייטים של קו זואי שיווק — סנכרון מטא, טריגרים ושידור ללידים קיימים
            </p>
          </div>
          <AdminNav active="templates" />
        </header>
        <AdminTemplatesClient
          initialTemplates={(templates ?? []) as AdminTemplateRow[]}
          initialTriggers={(triggers ?? []) as AdminTriggerRow[]}
          flowNodes={flowNodes}
          migrationRequired={migrationRequired}
        />
      </div>
    </main>
  );
}
