import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { normDashboardSlug } from "@/lib/dashboard-business-access";
import { requireDashboardSlugAccess } from "@/lib/dashboard-slug-guard";
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

  const admin = createSupabaseAdminClient();
  await requireDashboardSlugAccess(
    admin,
    { id: user.user.id, email: user.user.email },
    slug,
    "/conversations"
  );

  // Server-side initial load for fast first paint and resilience.
  let initialSessions: SessionSummary[] = [];
  try {
    initialSessions = await loadBusinessConversationSessions(admin, normDashboardSlug(slug));
  } catch {
    // If server-side preload fails, client-side query will still attempt to load.
    initialSessions = [];
  }

  return <ConversationsClient slug={slug} initialSessions={initialSessions} />;
}
