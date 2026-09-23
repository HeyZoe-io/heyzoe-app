const IL_TZ = "Asia/Jerusalem";

/** תאריך פעילות אחרונה — תואם לעמודת «שיחה אחרונה» (כולל לידי טמפלייט בלי last_contact_at). */
export function leadConversationAt(row: {
  last_contact_at?: string | null;
  created_at?: string | null;
  not_relevant_at?: string | null;
  human_requested_at?: string | null;
}): string | null {
  return (
    row.last_contact_at ??
    row.human_requested_at ??
    row.not_relevant_at ??
    row.created_at ??
    null
  );
}

/**
 * «שיחה אחרונה» של ליד זואי אדמין — אותו סדר כמו mapMarketingFlowSessionToLeadRow:
 * הודעת הלקוח האחרונה, אחרת עדכון הסשן, אחרת יצירה.
 */
export function marketingLeadConversationAt(
  row: {
    last_user_message_at?: string | null;
    updated_at?: string | null;
    created_at?: string | null;
  } | null | undefined
): string | null {
  if (!row) return null;
  for (const value of [row.last_user_message_at, row.updated_at, row.created_at]) {
    const raw = String(value ?? "").trim();
    if (!raw) continue;
    if (Number.isFinite(new Date(raw).getTime())) return raw;
  }
  return null;
}

export type LeadConversationDateTimeParts = { date: string; time: string };

/** תאריך ושעה בנפרד — שעון ישראל, אותו פירוק כמו בכרטיס הליד. */
export function formatLeadConversationDateTimeParts(
  iso: string | null | undefined
): LeadConversationDateTimeParts | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const day = pick("day");
  const month = pick("month");
  const year = pick("year");
  const hour = pick("hour");
  const minute = pick("minute");
  if (!day || !month || !year || hour.length !== 2 || minute.length !== 2) return null;
  return { date: `${day}.${month}.${year}`, time: `${hour}:${minute}` };
}

/** תאריך ושעה כמו בכרטיס הליד — שעון ישראל, כדי שדף השיחות ודף הלידים יראו אותו דבר. */
export function formatLeadConversationDateTime(iso: string | null | undefined): string {
  const parts = formatLeadConversationDateTimeParts(iso);
  if (!parts) return "—";
  return `${parts.date}, ${parts.time}`;
}

export function leadConversationAtMs(row: Parameters<typeof leadConversationAt>[0]): number {
  const at = leadConversationAt(row);
  if (!at) return 0;
  const t = new Date(at).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function sortLeadsByRecentActivity<T extends Parameters<typeof leadConversationAt>[0]>(rows: T[]): T[] {
  return [...rows].sort((a, b) => leadConversationAtMs(b) - leadConversationAtMs(a));
}
