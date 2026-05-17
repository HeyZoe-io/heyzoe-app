"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buildOwnerWhatsappConnectUrl } from "@/lib/notifications/owner-opt-in";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettingKey,
  type NotificationSettings,
} from "@/lib/notifications/types";

const ROWS: Array<{
  key: NotificationSettingKey;
  label: string;
  description: string;
}> = [
  {
    key: "new_lead",
    label: "🔔 ליד חדש נכנס",
    description: "כשמספר חדש פונה לבוט בפעם הראשונה",
  },
  {
    key: "human_requested",
    label: "✋ ליד ביקש נציג אנושי",
    description: "כשהליד מבקש לדבר עם נציג",
  },
  {
    key: "bot_paused_waiting",
    label: "⏸️ שיחה ממתינה",
    description: "30 דקות לאחר השהיית הבוט ללא מענה",
  },
  {
    key: "cta_no_signup",
    label: "🎯 ליד הגיע ל-CTA ולא נרשם",
    description: '20 דקות לאחר לחיצה על כפתור הרשמה ללא אישור "נרשמתי"',
  },
  {
    key: "lead_registered",
    label: "✅ ליד נרשם",
    description: 'כשהליד כותב "נרשמתי"',
  },
  {
    key: "daily_summary",
    label: "📋 סיכום יומי",
    description: "סיכום יומי בשעה 08:00",
  },
];

export default function AccountNotificationsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [settings, setSettings] = useState<NotificationSettings>({ ...DEFAULT_NOTIFICATION_SETTINGS });
  const [ownerWhatsappOptedIn, setOwnerWhatsappOptedIn] = useState(false);
  const [businessSlug, setBusinessSlug] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/account/notifications", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.settings) setSettings({ ...DEFAULT_NOTIFICATION_SETTINGS, ...data.settings });
        setOwnerWhatsappOptedIn(data.owner_whatsapp_opted_in === true);
        setBusinessSlug(typeof data.slug === "string" ? data.slug : "");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const locked = !ownerWhatsappOptedIn;
  const connectUrl = businessSlug ? buildOwnerWhatsappConnectUrl(businessSlug) : "#";

  function toggle(key: NotificationSettingKey) {
    if (locked) return;
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function save() {
    if (locked) return;
    setSaving(true);
    setToast("");
    try {
      const res = await fetch("/api/account/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(typeof data.error === "string" ? data.error : "שמירה נכשלה");
        return;
      }
      if (data.settings) setSettings({ ...DEFAULT_NOTIFICATION_SETTINGS, ...data.settings });
      setToast("ההגדרות נשמרו בהצלחה");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">התראות WhatsApp</h1>
        <p className="mt-1 text-sm text-zinc-600">
          בחר אילו התראות לקבל לווטסאפ שלך לגבי פעילות הבוט.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          ההתראות נשלחות ממספר זואי הראשי (+972 3-382-4981) ומתייחסות לפעילות על מספר העסק שלך.
        </p>
      </div>

      {locked && !loading ? (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-right flex flex-wrap items-center justify-between gap-3"
          role="status"
        >
          <p className="text-sm text-amber-900 font-medium">כדי לקבל התראות, חבר את הווטסאפ שלך תחילה</p>
          {businessSlug ? (
            <a
              href={connectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-2xl px-4 py-2 text-sm font-semibold text-white shadow-[0_16px_35px_rgba(142,75,255,0.28)] bg-[linear-gradient(135deg,#5f2ee8_0%,#9043ff_42%,#ff78de_100%)] hover:brightness-[1.03]"
            >
              חבר ווטסאפ
            </a>
          ) : null}
        </div>
      ) : null}

      <Card className={locked ? "opacity-50 pointer-events-none select-none" : undefined}>
        <CardHeader className="text-right">
          <CardTitle>סוגי התראות</CardTitle>
          <CardDescription>
            {locked ? "חברו ווטסאפ כדי לערוך את ההגדרות" : "ניתן לכבות כל סוג בנפרד"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {loading ? (
            <p className="text-sm text-zinc-500 py-6 text-center">טוען…</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {ROWS.map((row) => (
                <li key={row.key} className="flex items-start gap-3 py-4">
                  <input
                    id={`notif-${row.key}`}
                    type="checkbox"
                    checked={settings[row.key]}
                    onChange={() => toggle(row.key)}
                    disabled={locked}
                    className="mt-1 h-4 w-4 rounded border-zinc-300 text-fuchsia-600 focus:ring-fuchsia-500 cursor-pointer disabled:cursor-not-allowed"
                  />
                  <label
                    htmlFor={`notif-${row.key}`}
                    className={`flex-1 text-right ${locked ? "cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <span className="block text-sm font-medium text-zinc-900">{row.label}</span>
                    <span className="block text-xs text-zinc-500 mt-0.5">{row.description}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {!locked ? (
        <div className="flex flex-wrap items-center gap-3 justify-start">
          <Button type="button" onClick={() => void save()} disabled={saving || loading}>
            {saving ? "שומר…" : "שמירה"}
          </Button>
          {toast ? (
            <p
              className={`text-sm ${toast.includes("נכשל") ? "text-red-600" : "text-emerald-700"}`}
              role="status"
            >
              {toast}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
