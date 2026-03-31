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
    .select("id, slug")
    .eq("slug", slug)
    .eq("user_id", user.user.id)
    .maybeSingle();

  if (!biz) redirect("/dashboard/settings");

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
  const dropoffRate = started ? Math.round(((started - converted) / started) * 100) : 0;

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
          <p className="text-sm font-medium text-zinc-900">שיעור נטישה</p>
          <p className="mt-1 text-3xl font-semibold text-amber-600">{dropoffRate}%</p>
          <p className="mt-1 text-xs text-zinc-500">
            נטישה = שיחות שהתחילו ולא הגיעו להמרה (Lead).
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-right">
          <p className="text-sm font-medium text-zinc-900">הצעת שיפור</p>
          <p className="mt-2 text-sm text-zinc-700">
            {converted === 0
              ? "כדאי להוסיף כפתורי תשובה מהירה ברורים בתחילת השיחה ולחדד את ההנעה לפעולה."
              : dropoffRate > 60
              ? "שקול לקצר את הזרימה לפני שליחת לינק הסליקה ולהוסיף תשובות מוכנות להתנגדויות נפוצות."
              : "הביצועים טובים – אפשר לנסות להעלות מעט את מחיר שיעור הניסיון או להרחיב את שעות הפעילות."}
          </p>
        </div>
      </section>
    </div>
  );
}

