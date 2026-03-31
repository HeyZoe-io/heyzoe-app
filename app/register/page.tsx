"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, Mail, User } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function RegisterPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    const cleanName = fullName.trim();
    const cleanEmail = email.trim();
    if (!cleanName) {
      setMessage("נא להזין שם מלא.");
      return;
    }
    if (!cleanEmail) {
      setMessage("נא להזין אימייל.");
      return;
    }
    if (password.length < 6) {
      setMessage("הסיסמה חייבת להיות לפחות 6 תווים.");
      return;
    }
    if (password !== confirm) {
      setMessage("הסיסמאות לא תואמות.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: { full_name: cleanName },
          emailRedirectTo: `${window.location.origin}/register/confirm`,
        },
      });
      if (error) {
        setMessage(error.message);
        return;
      }

      setMessage("נרשמת בהצלחה! שלחנו לך מייל אימות — יש לאמת את המייל לפני הכניסה הראשונה.");
    } finally {
      setLoading(false);
    }
  }

  async function signInWithGoogle() {
    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/register/confirm`,
      },
    });
    if (error) {
      setMessage(error.message);
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center p-6" dir="rtl">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-center">
            <div className="h-12 w-12 rounded-2xl bg-yellow-300 text-zinc-900 font-semibold flex items-center justify-center shadow-sm select-none">
              HZ
            </div>
          </div>
          <CardTitle className="text-center">HeyZoe</CardTitle>
          <CardDescription className="text-center">הרשמה לניהול העסק שלך</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={signUp}>
            <div className="relative">
              <User className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
              <Input
                className="pl-9 text-right placeholder:text-right"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="שם מלא"
                required
              />
            </div>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
              <Input
                className="pl-9 text-right placeholder:text-right"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="אימייל"
                required
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
              <Input
                className="pl-9 text-right placeholder:text-right"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="סיסמה"
                required
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
              <Input
                className="pl-9 text-right placeholder:text-right"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="אישור סיסמה"
                required
              />
            </div>

            <Button className="w-full" disabled={loading}>
              {loading ? "נרשם..." : "הרשמה"}
            </Button>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={loading}
              onClick={signInWithGoogle}
            >
              הרשמה עם Google
            </Button>

            {message ? <p className="text-sm text-zinc-500 text-center">{message}</p> : null}
          </form>

          <div className="mt-6 flex items-center justify-center gap-3 text-xs text-zinc-500">
            <Link className="underline underline-offset-4 hover:text-zinc-700" href="/terms">
              תנאי שימוש
            </Link>
            <span className="text-zinc-300">•</span>
            <Link className="underline underline-offset-4 hover:text-zinc-700" href="/privacy">
              פרטיות
            </Link>
          </div>

          <div className="mt-4 text-center text-xs text-zinc-500">
            כבר יש לך חשבון?{" "}
            <button
              type="button"
              onClick={() => router.push("/dashboard/login")}
              className="underline underline-offset-4 hover:text-zinc-700"
            >
              התחברות
            </button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

