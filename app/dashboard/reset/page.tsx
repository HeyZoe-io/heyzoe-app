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
  const [exchanged, setExchanged] = useState(false);
  const [expired, setExpired] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
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
    if (password.length < 8) {
      setMessage("הסיסמה חייבת להיות לפחות 8 תווים.");
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
      setMessage("הסיסמה עודכנה בהצלחה. אפשר להתחבר מחדש.");
      window.setTimeout(() => router.replace("/dashboard/login?reset=1"), 700);
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
          ) : exchanged ? (
            <form className="space-y-3" onSubmit={onSubmit}>
              <p className="text-xs text-zinc-500 text-center">
                בחרו סיסמה חזקה (לפחות 8 תווים).
              </p>
              <Input
                type="password"
                placeholder="סיסמה חדשה"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              <Input
                type="password"
                placeholder="אישור סיסמה"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
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

