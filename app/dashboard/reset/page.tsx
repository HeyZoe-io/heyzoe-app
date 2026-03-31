"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function DashboardResetPasswordPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    // If the reset link is using PKCE flow, it will include ?code=...
    // This exchanges it into a session so updateUser works.
    const url = window.location.href;
    void supabase.auth
      .exchangeCodeForSession(url)
      .then(() => setReady(true))
      .catch(() => setReady(true));
  }, [supabase]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    if (password.length < 6) {
      setMessage("הסיסמה חייבת להיות לפחות 6 תווים.");
      return;
    }
    if (password !== confirm) {
      setMessage("הסיסמאות לא תואמות.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setMessage(error.message);
    else {
      setMessage("הסיסמה עודכנה בהצלחה. מעביר להתחברות...");
      window.setTimeout(() => router.replace("/dashboard/login"), 700);
    }
    setLoading(false);
  }

  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-center">
            <div className="h-12 w-12 rounded-2xl bg-yellow-300 text-zinc-900 font-semibold flex items-center justify-center shadow-sm select-none">
              HZ
            </div>
          </div>
          <CardTitle className="text-center">איפוס סיסמה</CardTitle>
          <CardDescription className="text-center">
            בחרו סיסמה חדשה לחשבון שלכם
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!ready ? (
            <p className="text-sm text-zinc-500 text-center">טוען...</p>
          ) : (
            <form className="space-y-3" onSubmit={onSubmit}>
              <Input
                type="password"
                placeholder="סיסמה חדשה"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Input
                type="password"
                placeholder="אישור סיסמה"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
              <Button className="w-full" disabled={loading}>
                {loading ? "שומר..." : "שמור סיסמה חדשה"}
              </Button>
              {message ? (
                <p className="text-sm text-zinc-500 text-center">{message}</p>
              ) : null}
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

