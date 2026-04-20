import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import ConversationsClient from "./client";

type Props = { params: Promise<{ slug: string }> };

export default async function ConversationsPage({ params }: Props) {
  const { slug } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect("/dashboard/login");

  return (
    <div className="space-y-6">
      <div className="hz-wave hz-wave-1">
        <h1 className="text-2xl font-semibold text-zinc-900 text-right">שיחות ל-{slug}</h1>
        <p className="text-sm text-zinc-600 text-right">
          רשימת השיחות, עצירת בוט ומענה ידני ללקוחות
        </p>
      </div>

      <div className="hz-wave hz-wave-2">
        <ConversationsClient slug={slug} initialSessions={[]} />
      </div>
    </div>
  );
}

