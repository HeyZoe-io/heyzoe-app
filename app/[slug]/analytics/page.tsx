import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

type Props = { params: Promise<{ slug: string }> };

export default async function AnalyticsPage({ params }: Props) {
  const { slug } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect("/dashboard/login");

  const admin = createSupabaseAdminClient();
  const { data: biz } = await admin
    .from("businesses")
    .select("id, slug, user_id")
    .eq("slug", slug)
    .maybeSingle();

  if (!biz) redirect("/dashboard/settings");

  const isOwner = String(biz.user_id) === user.user.id;
  if (!isOwner) {
    const { data: bu } = await admin
      .from("business_users")
      .select("role")
      .eq("business_id", biz.id)
      .eq("user_id", user.user.id)
      .maybeSingle();
    const allowed = bu?.role === "admin";
    if (!allowed) redirect(`/${slug}/conversations`);
  }

  const { data: messages } = await admin
    .from("messages")
    .select("session_id, created_at")
    .eq("business_slug", slug);
  const { data: conversions } = await admin
    .from("conversions")
    .select("session_id, created_at")
    .eq("business_slug", slug);

  const sessionsStarted = new Set<string>();
  const sessionsConverted = new Set<string>();

  messages?.forEach((m) => {
    if (m.session_id) sessionsStarted.add(m.session_id);
  });
  conversions?.forEach((c) => {
    if (c.session_id) sessionsConverted.add(c.session_id);
  });

  const started = sessionsStarted.size;
  const converted = sessionsConverted.size;
  const conversionRate = started ? Math.round((converted / started) * 100) : 0;

  const estimatedRevenue = converted * 1; // ניתן לעדכן למחיר שיעור ניסיון אמיתי

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-zinc-900 text-right">אנליטיקס ל-{slug}</h1>
      <p className="text-sm text-zinc-600 text-right">שיחות, המרות והכנסה מוערכת</p>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-right">
          <p className="text-xs text-zinc-500">שיחות שהתחילו</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900">{started}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-right">
          <p className="text-xs text-zinc-500">המרות (לחיצות על לינק סליקה)</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-600">{converted}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-right">
          <p className="text-xs text-zinc-500">הכנסה מוערכת החודש</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900">₪{estimatedRevenue}</p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-right">
          <p className="text-sm font-medium text-zinc-900">שיעור המרה</p>
          <p className="mt-1 text-3xl font-semibold text-emerald-600">{conversionRate}%</p>
          <p className="mt-1 text-xs text-zinc-500">
            שיעור המרה = שיחות שהגיעו להמרה מתוך כלל השיחות.
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-right">
          <p className="text-sm font-medium text-zinc-900">הצעת שיפור</p>
          <p className="mt-2 text-sm text-zinc-700">
            {converted === 0
              ? "כדאי להוסיף כפתורי תשובה מהירה ברורים בתחילת השיחה ולחדד את ההנעה לפעולה."
              : conversionRate < 40
              ? "שקול לקצר את הזרימה לפני שליחת לינק הסליקה ולהוסיף תשובות מוכנות להתנגדויות נפוצות."
              : "הביצועים טובים – אפשר לנסות להעלות מעט את מחיר שיעור הניסיון או להרחיב את שעות הפעילות."}
          </p>
        </div>
      </section>
    </div>
  );
}

