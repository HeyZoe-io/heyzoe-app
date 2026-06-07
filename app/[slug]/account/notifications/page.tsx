"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buildOwnerWhatsappConnectUrl } from "@/lib/notifications/owner-opt-in";
import { normalizePhone } from "@/lib/phone-normalize";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_UI_SETTING_KEYS,
  type NotificationSettings,
  type NotificationUiSettingKey,
} from "@/lib/notifications/types";

function formatOwnerPhoneDisplay(phone: string): string {
  const d = normalizePhone(phone) ?? phone.replace(/\D/g, "");
  if (d.startsWith("972") && d.length >= 12) return `0${d.slice(3)}`;
  return phone.trim() || "—";
}

type NotificationRow = {
  label: string;
  description: string;
  whatsappKey: NotificationUiSettingKey;
  emailKey: NotificationUiSettingKey;
};

const ROWS: NotificationRow[] = [
  {
    label: "✅ ליד נרשם",
    description: 'כשהליד כותב "נרשמתי"',
    whatsappKey: "lead_registered",
    emailKey: "lead_registered_email",
  },
  {
    label: "✋ ליד ביקש נציג אנושי",
    description: "כשהליד מבקש לדבר עם נציג",
    whatsappKey: "human_requested",
    emailKey: "human_requested_email",
  },
  {
    label: "📋 סיכום יומי",
    description: "סיכום יומי בשעה 08:00",
    whatsappKey: "daily_summary",
    emailKey: "daily_summary_email",
  },
];

function uiSettingsFromFull(full: NotificationSettings): Pick<NotificationSettings, NotificationUiSettingKey> {
  const out = {} as Pick<NotificationSettings, NotificationUiSettingKey>;
  for (const key of NOTIFICATION_UI_SETTING_KEYS) {
    out[key] = full[key];
  }
  return out;
}

export default function AccountNotificationsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [settings, setSettings] = useState(() => uiSettingsFromFull({ ...DEFAULT_NOTIFICATION_SETTINGS }));
  const [ownerWhatsappOptedIn, setOwnerWhatsappOptedIn] = useState(false);
  const [ownerWhatsappPhone, setOwnerWhatsappPhone] = useState("");
  const [businessSlug, setBusinessSlug] = useState("");
  const [notificationEmail, setNotificationEmail] = useState("");
  const [businessEmailFallback, setBusinessEmailFallback] = useState("");
  const [effectiveNotificationEmail, setEffectiveNotificationEmail] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/account/notifications", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.settings) {
          const merged = { ...DEFAULT_NOTIFICATION_SETTINGS, ...data.settings } as NotificationSettings;
          setSettings(uiSettingsFromFull(merged));
        }
        setOwnerWhatsappOptedIn(data.owner_whatsapp_opted_in === true);
        setOwnerWhatsappPhone(
          typeof data.owner_whatsapp_phone === "string" ? data.owner_whatsapp_phone : ""
        );
        setBusinessSlug(typeof data.slug === "string" ? data.slug : "");
        setNotificationEmail(
          typeof data.owner_notification_email === "string" ? data.owner_notification_email : ""
        );
        setBusinessEmailFallback(
          typeof data.business_email === "string" ? data.business_email : ""
        );
        setEffectiveNotificationEmail(
          typeof data.effective_email === "string" ? data.effective_email : ""
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const waLocked = !ownerWhatsappOptedIn;
  const connectUrl = businessSlug ? buildOwnerWhatsappConnectUrl(businessSlug) : "#";

  function toggle(key: NotificationUiSettingKey) {
    if (waLocked && (key === "lead_registered" || key === "human_requested" || key === "daily_summary")) {
      return;
    }
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function save() {
    setSaving(true);
    setToast("");
    try {
      const res = await fetch("/api/account/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          owner_notification_email: notificationEmail.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "missing_db_column_owner_notification_email") {
          setToast("חסרה עמודה ב-Supabase — הריצו את המיגרציה businesses_owner_notification_email.sql");
        } else if (data.error === "invalid_notification_email") {
          setToast("כתובת המייל אינה תקינה");
        } else {
          setToast(typeof data.error === "string" ? data.error : "שמירה נכשלה");
        }
        return;
      }
      if (data.settings) {
        const merged = { ...DEFAULT_NOTIFICATION_SETTINGS, ...data.settings } as NotificationSettings;
        setSettings(uiSettingsFromFull(merged));
      }
      if (typeof data.owner_notification_email === "string") {
        setNotificationEmail(data.owner_notification_email);
      }
      if (typeof data.business_email === "string") {
        setBusinessEmailFallback(data.business_email);
      }
      if (typeof data.effective_email === "string") {
        setEffectiveNotificationEmail(data.effective_email);
      }
      const savedEmail =
        typeof data.owner_notification_email === "string"
          ? data.owner_notification_email.trim()
          : notificationEmail.trim();
      setToast(
        savedEmail
          ? `ההגדרות נשמרו — מייל התראות: ${savedEmail}`
          : "ההגדרות נשמרו בהצלחה"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4" dir="rtl">
      <h1 className="text-2xl font-semibold text-zinc-900">התראות</h1>

      {waLocked && !loading ? (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-right flex flex-wrap items-center justify-between gap-3"
          role="status"
        >
          <p className="text-sm text-amber-900 font-medium">
            כדי לקבל התראות בווטסאפ, חברו את המספר שלכם תחילה. התראות מייל זמינות גם בלי חיבור.
          </p>
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

      {!waLocked && !loading && ownerWhatsappPhone ? (
        <div
          className="rounded-xl border border-fuchsia-100 bg-fuchsia-50/60 px-4 py-3 text-right flex flex-wrap items-center gap-x-2 gap-y-1"
          role="status"
        >
          <p className="text-sm text-zinc-800">
            התראות WhatsApp נשלחות אל:{" "}
            <span className="font-medium text-zinc-900" dir="ltr">
              {formatOwnerPhoneDisplay(ownerWhatsappPhone)}
            </span>
          </p>
          {businessSlug ? (
            <a
              href={connectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-fuchsia-700 hover:text-fuchsia-800 underline underline-offset-2"
            >
              שנה מספר
            </a>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardHeader className="text-right">
          <CardTitle>מייל להתראות</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-right">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-zinc-800">כתובת מייל</span>
            <Input
              type="email"
              dir="ltr"
              className="text-left"
              placeholder={
                businessEmailFallback
                  ? `ברירת מחדל: ${businessEmailFallback}`
                  : "name@example.com"
              }
              value={notificationEmail}
              onChange={(e) => setNotificationEmail(e.target.value)}
              disabled={saving}
              autoComplete="email"
            />
          </label>
          {!notificationEmail.trim() && effectiveNotificationEmail ? (
            <p className="text-xs text-emerald-800">
              כרגע נשלח ל: <span dir="ltr">{effectiveNotificationEmail}</span>
              {businessEmailFallback ? " (מייל מההרשמה לעסק)" : ""}
            </p>
          ) : !notificationEmail.trim() ? (
            <p className="text-xs text-amber-800">
              לא הוגדר מייל — הפעילו מייל בהתראות רק אחרי מילוי כתובת (או מייל בהרשמת העסק).
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="text-right">
          <CardTitle>סוגי התראות</CardTitle>
          <CardDescription>ניתן להפעיל כל ערוץ בנפרד</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {loading ? (
            <p className="text-sm text-zinc-500 py-6 text-center">טוען…</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {ROWS.map((row) => (
                <li key={row.whatsappKey} className="py-4">
                  <div className="text-right mb-3">
                    <span className="block text-sm font-medium text-zinc-900">{row.label}</span>
                    <span className="block text-xs text-zinc-500 mt-0.5">{row.description}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-6 justify-start">
                    <label
                      className={`inline-flex items-center gap-2 text-sm ${
                        waLocked ? "text-zinc-400 cursor-not-allowed" : "text-zinc-800 cursor-pointer"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={settings[row.whatsappKey]}
                        onChange={() => toggle(row.whatsappKey)}
                        disabled={waLocked}
                        className="h-4 w-4 rounded border-zinc-300 text-fuchsia-600 focus:ring-fuchsia-500 disabled:cursor-not-allowed"
                      />
                      <span>WhatsApp</span>
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-zinc-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings[row.emailKey]}
                        onChange={() => toggle(row.emailKey)}
                        className="h-4 w-4 rounded border-zinc-300 text-fuchsia-600 focus:ring-fuchsia-500"
                      />
                      <span>מייל</span>
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

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
    </div>
  );
}
