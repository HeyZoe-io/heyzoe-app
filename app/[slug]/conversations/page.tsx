import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadAccessibleBusinesses,
  normDashboardSlug,
  pickBusinessBySlug,
  type DashboardBizRow,
} from "@/lib/dashboard-business-access";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { loadBusinessConversationSessions } from "@/lib/conversations-sessions";
import ConversationsClient from "./client";

type Props = { params: Promise<{ slug: string }> };

type SessionSummary = {
  session_id: string;
  lastAt: string;
  count: number;
  isOpen: boolean;
  isPaused: boolean;
  phone: string;
};

export default async function ConversationsPage({ params }: Props) {
  const { slug } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect("/dashboard/login");

  // Server-side initial load for fast first paint and resilience.
  let initialSessions: SessionSummary[] = [];
  try {
    const admin = createSupabaseAdminClient();
    const accessible = await loadAccessibleBusinesses(admin, user.user.id, { adminAll: isAdminAllowedEmail(user.user.email ?? "") });
    const business = pickBusinessBySlug(accessible, normDashboardSlug(slug)) as DashboardBizRow | null;
    if (!business) notFound();

    initialSessions = await loadBusinessConversationSessions(admin, normDashboardSlug(slug));
  } catch {
    // If server-side preload fails, client-side query will still attempt to load.
    initialSessions = [];
  }

  return (
    <div className="space-y-6">
      <div className="hz-wave hz-wave-1">
        <h1 className="text-2xl font-semibold text-zinc-900 text-right">שיחות ל-{slug}</h1>
        <p className="text-sm text-zinc-600 text-right">
          רשימת השיחות, עצירת בוט ומענה ידני ללקוחות
        </p>
      </div>

      <div className="hz-wave hz-wave-2">
        <ConversationsClient slug={slug} initialSessions={initialSessions} />
      </div>
    </div>
  );
}

