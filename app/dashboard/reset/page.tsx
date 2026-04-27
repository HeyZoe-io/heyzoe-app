"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function DashboardResetPasswordPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [ready, setReady] = useState(false);
  const [exchanged, setExchanged] = useState(false);
  const [expired, setExpired] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function run() {
      try {
        const url = new URL(window.location.href);
        const type = url.searchParams.get("type") ?? "";
        const tokenHash = url.searchParams.get("token_hash") ?? "";
        const code = url.searchParams.get("code") ?? "";

        // Recovery links may arrive as token_hash&type=recovery
        if (type === "recovery" && tokenHash) {
          const { error } = await supabase.auth.verifyOtp({
            type: "recovery",
            token_hash: tokenHash,
          } as any);
          if (error) {
            const msg = (error as any)?.message ? String((error as any).message) : "";
            if (/expired/i.test(msg)) {
              setExpired(true);
              setMessage("הקישור פג תוקף");
            } else {
              setMessage("לא הצלחנו לאמת את לינק האיפוס. בקשו לינק חדש.");
            }
            setReady(true);
            return;
          }

          setExchanged(true);
          setReady(true);
          return;
        }

        // PKCE reset links may arrive as ?code=...
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            const msg = (error as any)?.message ? String((error as any).message) : "";
            if (/expired/i.test(msg)) {
              setExpired(true);
              setMessage("הקישור פג תוקף");
            } else {
              setMessage("לא הצלחנו לאמת את לינק האיפוס. בקשו לינק חדש.");
            }
            setReady(true);
            return;
          }

          setExchanged(true);
          setReady(true);
          return;
        }

        setMessage("לינק האיפוס לא תקין או שפג תוקפו. בקשו לינק חדש.");
        setReady(true);
        return;

        setExchanged(true);
        setReady(true);
      } catch {
        setMessage("לא הצלחנו לאמת את לינק האיפוס. בקשו לינק חדש.");
        setReady(true);
      }
    }
    void run();
  }, [supabase]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const pw = password.trim();
    const hasLetter = /[A-Za-z]/.test(pw);
    const hasNumber = /\d/.test(pw);
    if (pw.length < 8 || !hasLetter || !hasNumber) {
      setMessage("הסיסמה חייבת להיות לפחות 8 תווים, ולכלול אות ומספר.");
      return;
    }
    if (pw !== confirm.trim()) {
      setMessage("הסיסמאות לא תואמות.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) setMessage(error.message);
    else {
      setMessage("הסיסמה עודכנה בהצלחה. אפשר להתחבר מחדש.");
      window.setTimeout(() => router.replace("/dashboard/login?reset=1"), 700);
    }
    setLoading(false);
  }

  return (
    <main className="min-h-screen bg-[#f5f3ff] flex items-center justify-center p-6" dir="rtl">
      <Card className="w-full max-w-md rounded-[24px] shadow-[0_8px_40px_rgba(113,51,218,0.12)] border border-[rgba(113,51,218,0.12)]">
        <CardHeader>
          <div className="flex items-center justify-center">
            <div className="h-14 w-14 rounded-2xl bg-white shadow-[0_12px_28px_rgba(110,78,176,0.10)] ring-1 ring-black/5 flex items-center justify-center overflow-hidden">
              <img src="/heyzoe-logo.png" alt="HeyZoe" className="h-10 w-auto" />
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
          ) : exchanged ? (
            <form className="space-y-3" onSubmit={onSubmit}>
              <div className="text-xs text-zinc-500 text-right leading-relaxed">
                <div>בחרו סיסמה חזקה:</div>
                <ul className="mt-1 list-disc pr-5 space-y-0.5">
                  <li>לפחות 8 תווים</li>
                  <li>כולל אות ומספר</li>
                </ul>
              </div>
              <div className="relative">
                <button
                  type="button"
                  aria-label={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <Input
                  className="pl-10"
                  type={showPassword ? "text" : "password"}
                  placeholder="סיסמה חדשה"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
              <div className="relative">
                <button
                  type="button"
                  aria-label={showConfirm ? "הסתר סיסמה" : "הצג סיסמה"}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
                  onClick={() => setShowConfirm((v) => !v)}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <Input
                  className="pl-10"
                  type={showConfirm ? "text" : "password"}
                  placeholder="אישור סיסמה"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
              <Button className="w-full" disabled={loading}>
                {loading ? "שומר..." : "שמור סיסמה חדשה"}
              </Button>
              {message ? (
                <p className="text-sm text-zinc-500 text-center">{message}</p>
              ) : null}
            </form>
          ) : (
            <div className="space-y-3">
              {message ? (
                <p className="text-sm text-zinc-500 text-center">{message}</p>
              ) : null}
              {expired ? (
                <Button className="w-full" onClick={() => router.replace("/dashboard/login")}>
                  שלח קישור חדש
                </Button>
              ) : (
                <Button className="w-full" onClick={() => router.replace("/dashboard/login")}>
                  חזרה להתחברות
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

