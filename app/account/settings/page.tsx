"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  const [phone, setPhone] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

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
      const ph =
        typeof u?.user_metadata?.phone === "string" ? u.user_metadata.phone : "";
      setFullName(String(name ?? ""));
      setAvatarUrl(String(avatar ?? ""));
      setNewEmail(u?.email ?? "");
      setPhone(String(ph ?? ""));
      setLoading(false);
    });
  }, [supabase]);

  async function uploadAvatar(file: File) {
    setUploading(true);
    setMessage("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/dashboard/upload-logo", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.url) {
        setMessage("העלאת תמונה נכשלה.");
        return;
      }
      const url = String(j.url);
      setAvatarUrl(url);
      await supabase.auth.updateUser({ data: { avatar_url: url } } as any);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const updates: Record<string, unknown> = {
        data: {
          full_name: fullName.trim(),
          avatar_url: avatarUrl.trim(),
          phone: phone.trim(),
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
          <CardTitle>פרטים אישיים</CardTitle>
          <CardDescription>טוען…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>פרטים אישיים</CardTitle>
          <CardDescription>כאן ממלאים את הפרטים האישיים שלך לצורך התקשרות בינינו!</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative h-16 w-16 rounded-full overflow-hidden border border-zinc-200 bg-zinc-100 cursor-pointer"
              aria-label="עריכת תמונת פרופיל"
              disabled={uploading}
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="תמונת פרופיל" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full bg-zinc-200" />
              )}
              <div className="absolute bottom-0 inset-x-0 bg-black/35 text-white text-[11px] py-1">
                {uploading ? "מעלה..." : "ערוך"}
              </div>
            </button>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAvatar(f);
              }}
            />
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
            <label className="text-sm font-medium text-zinc-700 block">אימייל</label>
            <Input dir="ltr" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700 block">טלפון</label>
            <Input dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0501234567" />
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

