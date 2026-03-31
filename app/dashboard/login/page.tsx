"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function DashboardLoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const nextPath = useMemo(() => {
    if (typeof window === "undefined") return "";
    const sp = new URLSearchParams(window.location.search);
    const next = sp.get("next") ?? "";
    return next.startsWith("/") ? next : "";
  }, []);

  async function redirectAfterLogin() {
    if (nextPath) {
      router.replace(nextPath);
      return;
    }
    const res = await fetch("/api/dashboard/settings", { method: "GET" });
    const j = await res.json().catch(() => ({}));
    const slug =
      j?.business && typeof j.business.slug === "string" ? String(j.business.slug).trim() : "";
    router.replace(slug ? `/${encodeURIComponent(slug)}/analytics` : "/register");
  }

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) void redirectAfterLogin();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, session) => {
      if (session) void redirectAfterLogin();
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) setMessage(error.message);
    else await redirectAfterLogin();
    setLoading(false);
  }

  async function signInWithGoogle() {
    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/dashboard/login`,
      },
    });
    if (error) {
      setMessage(error.message);
      setLoading(false);
    }
    // On success Supabase redirects away; no need to setLoading(false) here.
  }

  async function forgotPassword() {
    setLoading(true);
    setMessage("");
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setMessage("נא להזין אימייל כדי לשלוח לינק איפוס סיסמה.");
      setLoading(false);
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: `${window.location.origin}/dashboard/reset`,
    });
    if (error) setMessage(error.message);
    else setMessage("נשלח מייל לאיפוס סיסמה. בדקו את תיבת הדואר.");
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
          <CardTitle className="text-center">HeyZoe</CardTitle>
          <CardDescription className="text-center">התחברו כדי לנהל את העסק שלכם</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={signInWithPassword}>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
              <Input className="pl-9" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
              <Input
                className="pl-9"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="סיסמה"
              />
            </div>
            <Button className="w-full" disabled={loading}>
              {loading ? "מתחבר..." : "התחברות"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={loading}
              onClick={signInWithGoogle}
            >
              התחברות עם Google
            </Button>
            <button
              type="button"
              className="w-full text-xs text-zinc-500 hover:text-zinc-700 underline underline-offset-4"
              onClick={forgotPassword}
              disabled={loading}
            >
              שכחת סיסמה?
            </button>
            {message ? <p className="text-sm text-zinc-500">{message}</p> : null}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
