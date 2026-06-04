/** כתובת לשליחת מיילי התראות לבעל — ייעודי, ואם ריק מייל העסק מההרשמה. */
export function resolveOwnerNotificationEmail(biz: {
  owner_notification_email?: string | null;
  email?: string | null;
}): string {
  const dedicated = String(biz.owner_notification_email ?? "").trim();
  if (dedicated) return dedicated;
  return String(biz.email ?? "").trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeOwnerNotificationEmailInput(raw: unknown): string | null {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim().toLowerCase();
  if (!s) return "";
  if (!EMAIL_RE.test(s)) return null;
  return s;
}
