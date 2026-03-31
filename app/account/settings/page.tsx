"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function AccountSettingsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [newEmail, setNewEmail] = useState("");

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      setEmail(u?.email ?? "");
      const name =
        (typeof u?.user_metadata?.full_name === "string" ? u.user_metadata.full_name : "") ||
        (typeof u?.user_metadata?.name === "string" ? u.user_metadata.name : "");
      const avatar =
        (typeof u?.user_metadata?.avatar_url === "string" ? u.user_metadata.avatar_url : "") ||
        (typeof u?.user_metadata?.picture === "string" ? u.user_metadata.picture : "");
      setFullName(String(name ?? ""));
      setAvatarUrl(String(avatar ?? ""));
      setNewEmail(u?.email ?? "");
      setLoading(false);
    });
  }, [supabase]);

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const updates: Record<string, unknown> = {
        data: {
          full_name: fullName.trim(),
          avatar_url: avatarUrl.trim(),
        },
      };

      // Email change triggers confirmation email from Supabase (if enabled)
      const cleanNewEmail = newEmail.trim();
      if (cleanNewEmail && cleanNewEmail !== email) {
        (updates as any).email = cleanNewEmail;
      }

      const { error } = await supabase.auth.updateUser(updates as any);
      if (error) {
        setMessage(error.message);
      } else {
        setMessage(
          cleanNewEmail !== email
            ? "נשמר. אם שינית אימייל — נשלח אליך מייל אימות לכתובת החדשה."
            : "נשמר בהצלחה."
        );
        setEmail(cleanNewEmail);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>הגדרות חשבון</CardTitle>
          <CardDescription>טוען…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>הגדרות חשבון</CardTitle>
          <CardDescription>עדכון שם, תמונת פרופיל ואימייל</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-end gap-3">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt="תמונת פרופיל"
                className="h-12 w-12 rounded-full object-cover border border-zinc-200"
              />
            ) : (
              <div className="h-12 w-12 rounded-full bg-zinc-200" />
            )}
            <div className="text-right">
              <p className="text-sm font-medium text-zinc-900">{fullName || "—"}</p>
              <p className="text-xs text-zinc-500">{email || "—"}</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700 block">שם מלא</label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="שם מלא" />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700 block">תמונת פרופיל (URL)</label>
            <Input dir="ltr" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://..." />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700 block">אימייל</label>
            <Input dir="ltr" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          </div>

          <Button onClick={save} disabled={saving}>
            {saving ? "שומר..." : "שמירה"}
          </Button>
          {message ? <p className="text-sm text-zinc-500">{message}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

