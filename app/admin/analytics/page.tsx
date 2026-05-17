import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { AdminNav } from "@/app/admin/AdminNav";
import { buildLandingAnalyticsSnapshot } from "@/lib/admin-landing-analytics";
import { loadWhatsappAnalyticsSnapshot } from "@/lib/admin-marketing-analytics";
import AnalyticsAdminClient from "./AnalyticsAdminClient";
import LandingAnalyticsPanel from "./LandingAnalyticsPanel";
import WhatsappAnalyticsPanel from "./WhatsappAnalyticsPanel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RangeKey = "7" | "30" | "90";
type SourceMode = "all" | "purchases";
type AnalyticsTab = "landing" | "whatsapp";

function resolveRangeKey(raw: unknown): RangeKey {
  const r = String(raw ?? "").trim();
  if (r === "30" || r === "90") return r;
  return "7";
}

function resolveSourceMode(raw: unknown): SourceMode {
  const r = String(raw ?? "").trim();
  return r === "purchases" ? "purchases" : "all";
}

function resolveTab(raw: unknown): AnalyticsTab {
  return String(raw ?? "").trim() === "whatsapp" ? "whatsapp" : "landing";
}

function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  const email = user.user?.email?.trim().toLowerCase() ?? "";
  if (!email || !isAdminAllowedEmail(email)) redirect("/admin/login");

  const sp = await searchParams;
  const range = resolveRangeKey(typeof sp.range === "string" ? sp.range : Array.isArray(sp.range) ? sp.range[0] : "");
  const sourceMode = resolveSourceMode(
    typeof sp.source === "string" ? sp.source : Array.isArray(sp.source) ? sp.source[0] : ""
  );
  const tab = resolveTab(typeof sp.tab === "string" ? sp.tab : Array.isArray(sp.tab) ? sp.tab[0] : "");
  const days = range === "90" ? 90 : range === "30" ? 30 : 7;
  const since = daysAgoIso(days);

  const admin = createSupabaseAdminClient();
  let loadError: string | null = null;

  const [{ data: eventsRaw, error: eventsError }, waData] = await Promise.all([
    admin
      .from("analytics_events")
      .select("event_type, value, source, label, session_id, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200_000),
    loadWhatsappAnalyticsSnapshot(since),
  ]);

  if (eventsError) loadError = eventsError.message;

  const events = ((eventsRaw ?? []) as any[]).filter((e) => e && e.session_id);
  const landingData = buildLandingAnalyticsSnapshot(events, sourceMode);

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
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <header style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "end", justifyContent: "space-between" }}>
          <div style={{ textAlign: "right" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 400, color: "#1a0a3c" }}>אנליטיקס</h1>
            <p style={{ margin: "6px 0 0", fontSize: 14, color: "#6b5b9a" }}>
              {tab === "whatsapp" ? "פלואו שיווקי וואטסאפ + המרות מדף הנחיתה" : "אירועי tracking בדף הנחיתה (lp-leads)"}
            </p>
            {loadError ? (
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "#c81e5b" }}>שגיאת טעינה: {loadError}</p>
            ) : null}
          </div>
          <AdminNav active="analytics" />
        </header>

        <Suspense fallback={<div style={{ marginTop: 18, fontSize: 14, color: "#6b5b9a" }}>טוען…</div>}>
          <AnalyticsAdminClient range={range} sourceMode={sourceMode}>
            {tab === "whatsapp" ? (
              <WhatsappAnalyticsPanel data={waData} />
            ) : (
              <LandingAnalyticsPanel data={landingData} range={range} sourceMode={sourceMode} />
            )}
          </AnalyticsAdminClient>
        </Suspense>

        <p style={{ marginTop: 12, fontSize: 12, color: "#6b5b9a", textAlign: "right" }}>טווח: {days} ימים אחרונים</p>
      </div>
    </main>
  );
}
