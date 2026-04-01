"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Member = {
  user_id: string;
  name: string;
  email: string;
  role: "admin" | "employee";
  status: "pending" | "active";
  is_primary: boolean;
};

const roleHelp: Record<Member["role"], string> = {
  admin: "גישה לכל הדשבורד (שיחות, אנליטיקס, הגדרות).",
  employee: "גישה לדף שיחות בלבד.",
};

export default function AccountUsersPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [meId, setMeId] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [message, setMessage] = useState("");

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<Member["role"]>("employee");
  const [inviting, setInviting] = useState(false);
  const [cancellingByUserId, setCancellingByUserId] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const [{ data }, meRes] = await Promise.all([
        fetch("/api/account/users").then((r) => r.json()),
        supabase.auth.getUser(),
      ]);
      setMembers(Array.isArray(data?.members) ? data.members : []);
      setMeId(meRes.data.user?.id ?? "");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function invite() {
    setInviting(true);
    setMessage("");
    try {
      const res = await fetch("/api/account/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          full_name: inviteName.trim(),
          role: inviteRole,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(j.error ?? "invite_failed");
        return;
      }
      const member: Member | null = j?.member && typeof j.member === "object" ? (j.member as Member) : null;
      if (member?.user_id) {
        setMembers((prev) => {
          if (prev.some((m) => m.user_id === member.user_id)) return prev;
          return [member, ...prev];
        });
      }
      setInviteEmail("");
      setInviteName("");
      setInviteRole("employee");
      setMessage("נשלחה הזמנה במייל.");
    } finally {
      setInviting(false);
    }
  }

  async function cancelInvite(userId: string) {
    if (!confirm("לבטל את ההזמנה?")) return;
    setMessage("");
    const prev = members;
    setMembers((p) => p.filter((m) => m.user_id !== userId));
    setCancellingByUserId((m) => ({ ...m, [userId]: true }));
    try {
      const res = await fetch(
        `/api/account/users?user_id=${encodeURIComponent(userId)}&cancel_invite=1`,
        { method: "DELETE" }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMembers(prev);
        setMessage(j.error ?? "cancel_failed");
      }
    } finally {
      setCancellingByUserId((m) => {
        const next = { ...m };
        delete next[userId];
        return next;
      });
    }
  }

  async function removeMember(userId: string) {
    if (!confirm("למחוק את המשתמש מהעסק?")) return;
    setMessage("");
    const res = await fetch(`/api/account/users?user_id=${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) setMessage(j.error ?? "delete_failed");
    else await load();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-right">משתמשים</CardTitle>
          <CardDescription className="text-right">
            ניהול משתמשים והרשאות לעסק
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-right">
          {loading ? (
            <p className="text-sm text-zinc-500">טוען…</p>
          ) : (
            <div className="space-y-2">
              {members.map((m) => (
                <div
                  key={m.user_id}
                  className="rounded-xl border border-zinc-200 bg-white px-3 py-2 flex items-center justify-between gap-3"
                >
                  <div className="text-right">
                    <p className="text-sm font-medium text-zinc-900">
                      {m.name || "—"}{" "}
                      {m.is_primary ? (
                        <span className="text-[11px] rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2 py-0.5 text-fuchsia-700">
                          ראשי
                        </span>
                      ) : null}
                      {m.status === "pending" ? (
                        <span className="mr-2 text-[11px] rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">
                          ממתין לאישור
                        </span>
                      ) : (
                        <span className="mr-2 text-[11px] rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                          פעיל
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-zinc-500">{m.email || "—"}</p>
                    <p className="text-[11px] text-zinc-500">
                      <span className="font-medium text-zinc-700">
                        {m.role === "admin" ? "אדמין" : "עובד"}:
                      </span>{" "}
                      {roleHelp[m.role]}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.status === "pending" && !m.is_primary ? (
                      <button
                        type="button"
                        onClick={() => void cancelInvite(m.user_id)}
                        className="text-xs text-zinc-700 hover:text-zinc-900 underline underline-offset-4 cursor-pointer"
                        disabled={Boolean(cancellingByUserId[m.user_id])}
                        title="בטל בקשה"
                      >
                        {cancellingByUserId[m.user_id] ? "מבטל..." : "בטל בקשה"}
                      </button>
                    ) : null}
                    {!m.is_primary ? (
                      <button
                        type="button"
                        onClick={() => void removeMember(m.user_id)}
                        className="text-xs text-red-600 hover:text-red-700 underline underline-offset-4 cursor-pointer"
                        disabled={m.user_id === meId}
                        title={m.user_id === meId ? "לא ניתן למחוק את עצמך כאן" : "מחיקה"}
                      >
                        מחיקה
                      </button>
                    ) : (
                      <span className="text-[11px] text-zinc-400">—</span>
                    )}
                  </div>
                </div>
              ))}
              {members.length === 0 ? (
                <p className="text-sm text-zinc-500">אין משתמשים להצגה.</p>
              ) : null}
            </div>
          )}

          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 space-y-2">
            <p className="text-sm font-semibold text-zinc-900">הוספת משתמש חדש</p>
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <label className="text-xs text-zinc-600">שם מלא</label>
                <Input
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="שם מלא"
                  autoComplete="name"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-600">אימייל</label>
                <Input
                  dir="ltr"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="name@company.com"
                  autoComplete="email"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-600">הרשאה</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value === "admin" ? "admin" : "employee")}
                className="mt-1 w-full rounded-xl border border-zinc-300 bg-white p-2 text-sm text-right cursor-pointer focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
              >
                <option value="admin">אדמין — {roleHelp.admin}</option>
                <option value="employee">עובד — {roleHelp.employee}</option>
              </select>
            </div>
            <Button
              onClick={() => void invite()}
              disabled={inviting || !inviteEmail.trim() || !inviteName.trim()}
              className="w-full"
            >
              {inviting ? "שולח הזמנה..." : "שלח הזמנה"}
            </Button>
          </div>

          {message ? <p className="text-sm text-zinc-500">{message}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

