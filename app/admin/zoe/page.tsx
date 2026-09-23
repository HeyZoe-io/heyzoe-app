import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAdminAllowedEmail } from "@/lib/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(v: string | string[] | undefined): string {
  const raw = Array.isArray(v) ? v[0] : v;
  return typeof raw === "string" ? raw.trim() : "";
}

export default async function AdminZoePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams> | SearchParams;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  const email = user.user?.email?.trim().toLowerCase() ?? "";
  if (!email || !isAdminAllowedEmail(email)) redirect("/admin/login");

  const sp = (await Promise.resolve(searchParams)) ?? {};
  const tab = firstParam(sp.tab);
  const next = new URLSearchParams({ tab: "marketing" });
  if (tab === "conversations" || tab === "questions" || tab === "answers" || tab === "open" || tab === "legal") {
    next.set("sub", tab);
  }
  const phone = firstParam(sp.phone);
  const session = firstParam(sp.session);
  if (phone) next.set("phone", phone);
  if (session) next.set("session", session);
  redirect(`/admin/dashboard?${next.toString()}`);
}
