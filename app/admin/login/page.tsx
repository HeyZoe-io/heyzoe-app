"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, ShieldCheck } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function AdminLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"magic" | "password">("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted && data.session) {
        router.replace("/admin/dashboard");
      }
    });

    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        router.replace("/admin/dashboard");
      }
    });

    return () => {
      mounted = false;
      authSub.subscription.unsubscribe();
    };
  }, [router, supabase]);

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/admin/dashboard`,
        },
      });
      if (error) {
        setMessage(`Login failed: ${error.message}`);
      } else {
        setMessage("Magic link sent. Open your email to continue.");
      }
    } catch (err) {
      setMessage(`Login failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const cleanEmail = email.trim();
      const cleanPassword = password;
      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: cleanPassword,
      });
      if (error) {
        setMessage(`Login failed: ${error.message}`);
      } else {
        router.replace("/admin/dashboard");
      }
    } catch (err) {
      setMessage(`Login failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2 text-fuchsia-600">
            <ShieldCheck className="h-5 w-5" />
            <CardTitle>Zoe Admin Login</CardTitle>
          </div>
          <CardDescription>Authorized email only. Sign in with a magic link or password.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center gap-2">
            <button
              type="button"
              className={
                "rounded-full px-3 py-1.5 text-xs font-normal transition " +
                (mode === "magic" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200")
              }
              onClick={() => {
                setMode("magic");
                setMessage("");
              }}
              disabled={loading}
            >
              Magic link
            </button>
            <button
              type="button"
              className={
                "rounded-full px-3 py-1.5 text-xs font-normal transition " +
                (mode === "password" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200")
              }
              onClick={() => {
                setMode("password");
                setMessage("");
              }}
              disabled={loading}
            >
              Password
            </button>
          </div>

          <form onSubmit={mode === "magic" ? handleMagicLink : handlePassword} className="space-y-4">
            <label className="text-sm font-normal text-zinc-700">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
              <Input
                type="email"
                autoComplete="email"
                required
                className="pl-9"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {mode === "password" ? (
              <div>
                <label className="text-sm font-normal text-zinc-700">Password</label>
                <div className="relative mt-1">
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute left-3 top-1/2 -translate-y-1/2 z-10 rounded-full p-1.5 text-zinc-500 hover:text-zinc-800 hover:bg-white/70"
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <Input
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    className="pl-16"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>
            ) : null}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Working..." : mode === "magic" ? "Send Magic Link" : "Sign in"}
            </Button>
            {message ? <p className="text-sm text-zinc-600">{message}</p> : null}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
