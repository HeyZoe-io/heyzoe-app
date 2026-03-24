"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function DashboardLoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/dashboard/settings");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, session) => {
      if (session) router.replace("/dashboard/settings");
    });
    return () => sub.subscription.unsubscribe();
  }, [router, supabase]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/dashboard/settings` },
    });
    if (error) setMessage(error.message);
    else setMessage("Magic link sent to your email.");
    setLoading(false);
  }

  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Business Dashboard Login</CardTitle>
          <CardDescription>Sign in to manage your business chatbot settings.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
              <Input className="pl-9" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Button className="w-full" disabled={loading}>{loading ? "Sending..." : "Send Magic Link"}</Button>
            {message ? <p className="text-sm text-zinc-500">{message}</p> : null}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
