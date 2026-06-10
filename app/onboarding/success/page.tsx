import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import OnboardingSuccessClient from "./client";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OnboardingSuccessPage({ searchParams }: Props) {
  const params = await searchParams;
  const email = String(params.email ?? "")
    .trim()
    .toLowerCase();
  const slugParam = String(params.slug ?? "")
    .trim()
    .toLowerCase();

  if (email) {
    const admin = createSupabaseAdminClient();
    let slug = slugParam;
    if (!slug) {
      const { data: session } = await admin
        .from("payment_sessions")
        .select("slug")
        .eq("email", email)
        .eq("ready", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      slug = String((session as { slug?: unknown })?.slug ?? "")
        .trim()
        .toLowerCase();
    }

    if (slug) {
      const { data: biz } = await admin
        .from("businesses")
        .select("waba_id")
        .eq("slug", slug)
        .maybeSingle();
      const wabaId = String((biz as { waba_id?: unknown })?.waba_id ?? "")
        .trim()
        .replace(/\s+/g, "");
      if (wabaId) {
        redirect(`/${slug}/analytics?welcome=1`);
      }
    }
  }

  return (
    <Suspense>
      <OnboardingSuccessClient />
    </Suspense>
  );
}
