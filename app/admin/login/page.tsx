"use client";

import { useMemo, useState } from "react";
import { Mail, ShieldCheck } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const nextPath = useMemo(() => {
    if (typeof window === "undefined") return "/admin/dashboard";
    const params = new URLSearchParams(window.location.search);
    return params.get("next") || "/admin/dashboard";
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}${nextPath}`,
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

  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2 text-fuchsia-600">
            <ShieldCheck className="h-5 w-5" />
            <CardTitle>Zoe Admin Login</CardTitle>
          </div>
          <CardDescription>Authorized email only. Sign in with a magic link.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <label className="text-sm font-medium text-zinc-700">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
              <Input
                type="email"
                required
                className="pl-9"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Sending..." : "Send Magic Link"}
            </Button>
            {message ? <p className="text-sm text-zinc-600">{message}</p> : null}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
