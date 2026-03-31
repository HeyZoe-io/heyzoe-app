"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function RegisterConfirmPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [status, setStatus] = useState<"loading" | "need_verify" | "creating" | "done" | "error">("loading");
  const [message, setMessage] = useState("מאמת התחברות...");

  useEffect(() => {
    async function run() {
      try {
        // Handles both email confirmation (code) and OAuth (code)
        await supabase.auth.exchangeCodeForSession(window.location.href);
      } catch {
        // ignore; we still check session below
      }

      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session?.user) {
        setStatus("need_verify");
        setMessage("כדי להמשיך יש לאמת את המייל דרך הלינק שנשלח אליך, ואז לחזור לכאן.");
        return;
      }

      const emailConfirmed =
        Boolean((session.user as any).email_confirmed_at) ||
        Boolean((session.user as any).confirmed_at);

      // For email/password sign-up, require verification before creating business
      if (!emailConfirmed && session.user.app_metadata?.provider === "email") {
        setStatus("need_verify");
        setMessage("שלחנו מייל אימות. יש לאמת את המייל לפני הכניסה הראשונה.");
        return;
      }

      setStatus("creating");
      setMessage("מכין את העסק הראשון שלך...");

      const res = await fetch("/api/register/ensure-business", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.slug) {
        setStatus("error");
        setMessage("לא הצלחנו ליצור עסק. נסה/י שוב בעוד רגע.");
        return;
      }

      setStatus("done");
      router.replace(`/${encodeURIComponent(String(j.slug))}/settings`);
    }
    void run();
  }, [router, supabase]);

  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center p-6" dir="rtl">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-center">
            <div className="h-12 w-12 rounded-2xl bg-yellow-300 text-zinc-900 font-semibold flex items-center justify-center shadow-sm select-none">
              HZ
            </div>
          </div>
          <CardTitle className="text-center">השלמת הרשמה</CardTitle>
          <CardDescription className="text-center">אימות והכנת העסק הראשון</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-zinc-600 text-center">{message}</p>
          {status === "need_verify" ? (
            <div className="space-y-2">
              <Button className="w-full" onClick={() => router.replace("/dashboard/login")}>
                מעבר להתחברות
              </Button>
              <Button className="w-full" variant="outline" onClick={() => router.replace("/register")}>
                חזרה להרשמה
              </Button>
            </div>
          ) : status === "error" ? (
            <Button className="w-full" onClick={() => window.location.reload()}>
              נסה שוב
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}

