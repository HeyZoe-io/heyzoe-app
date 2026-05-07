"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import Link from "next/link";

export default function DashboardLoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [pwShake, setPwShake] = useState(false);
  const [wrongPassword, setWrongPassword] = useState(false);

  async function resolveInvalidCredentialsMessage(cleanEmail: string): Promise<{ text: string; isWrongPassword: boolean }> {
    try {
      const res = await fetch(`/api/onboarding/email-status?email=${encodeURIComponent(cleanEmail)}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      const j = (await res.json().catch(() => null)) as any;
      if (j?.state === "none") return { text: "לא מצאנו חשבון עם האימייל הזה.", isWrongPassword: false };
      if (j?.state === "existing_paying" || j?.state === "existing_unpaid")
        return { text: "הוזנה סיסמה לא נכונה", isWrongPassword: true };
    } catch {
      // ignore
    }
    // Fallback: Supabase does not differentiate between wrong email / wrong password for security reasons.
    return { text: "אימייל או סיסמה לא נכונים", isWrongPassword: false };
  }

  const nextPath = useMemo(() => {
    if (typeof window === "undefined") return "";
    const sp = new URLSearchParams(window.location.search);
    const next = sp.get("next") ?? "";
    return next.startsWith("/") ? next : "";
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const msg = sp.get("msg") ?? "";
    if (msg && !message) setMessage(msg);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function redirectAfterLogin() {
    if (nextPath) {
      window.location.href = nextPath;
      return;
    }
    // Use lite payload to avoid fetching large settings blobs during login redirects.
    const res = await fetch("/api/dashboard/settings?lite=1", { method: "GET" });
    const j = await res.json().catch(() => ({}));
    const slug =
      j?.business && typeof j.business.slug === "string" ? String(j.business.slug).trim() : "";
    window.location.href = slug ? `/${encodeURIComponent(slug)}/analytics` : "/register";
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
    setWrongPassword(false);
    setPwShake(false);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      const msg = String(error.message ?? "").toLowerCase();
      const isInvalidCreds =
        msg.includes("invalid login credentials") ||
        msg.includes("invalid credentials") ||
        msg.includes("invalid") ||
        msg.includes("credentials");

      if (isInvalidCreds) {
        const cleanEmail = email.trim();
        const resolved = await resolveInvalidCredentialsMessage(cleanEmail);
        setWrongPassword(resolved.isWrongPassword);
        setMessage(resolved.text);
        if (resolved.isWrongPassword) {
          requestAnimationFrame(() => setPwShake(true));
          window.setTimeout(() => setPwShake(false), 520);
        }
      } else {
        setWrongPassword(false);
        setMessage(error.message);
      }
    }
    else await redirectAfterLogin();
    setLoading(false);
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
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center p-6" dir="rtl">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-center">
            <div className="h-14 w-14 rounded-2xl bg-white shadow-[0_12px_28px_rgba(110,78,176,0.10)] ring-1 ring-black/5 flex items-center justify-center overflow-hidden">
              <Image src="/zoe-logo.png" alt="Zoe" width={56} height={56} priority />
            </div>
          </div>
          <CardTitle className="text-center">HeyZoe</CardTitle>
          <CardDescription className="text-center">
            כבר עשית שנ״צ היום? כי עם זואי אתה יכול.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={signInWithPassword}>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
              <Input
                className="pl-9 text-right placeholder:text-right"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="אימייל"
              />
            </div>
            <div className={`relative ${pwShake ? "hz-shake" : ""}`.trim()}>
              <Lock className="absolute left-10 top-2.5 h-4 w-4 text-zinc-400" />
              <button
                type="button"
                aria-label={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
                className="absolute left-3 top-1/2 -translate-y-1/2 z-10 rounded-full p-1.5 text-zinc-500 hover:text-zinc-800 hover:bg-white/70"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <Input
                className="pl-16 text-right placeholder:text-right"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (wrongPassword) {
                    setWrongPassword(false);
                    setMessage("");
                  }
                }}
                placeholder="סיסמה"
              />
            </div>
            {wrongPassword ? (
              <p className="-mt-2 text-[12px] text-red-600 text-right">{message}</p>
            ) : null}
            <Button className="w-full" disabled={loading}>
              {loading ? "מתחבר..." : "התחברות"}
            </Button>
            <button
              type="button"
              className="w-full text-xs text-zinc-500 hover:text-zinc-700 underline underline-offset-4"
              onClick={forgotPassword}
              disabled={loading}
            >
              שכחת סיסמה?
            </button>
            <Link
              href="/register"
              className="block w-full text-xs text-zinc-500 hover:text-zinc-700 underline underline-offset-4 text-center"
              aria-label="אין לך חשבון? הירשם כעת"
            >
              אין לך חשבון? הירשם כעת!
            </Link>
            {message && !wrongPassword ? <p className="text-sm text-zinc-500">{message}</p> : null}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
