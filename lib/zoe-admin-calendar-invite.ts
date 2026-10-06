import { sendEmail } from "@/lib/email";
import {
  buildZoeAdminInviteIcs,
  zoeAdminGuestEvent,
  ZOE_ADMIN_CALL_DURATION_MS,
} from "@/lib/zoe-admin-calendar";

export type ZoeAdminInviteColumn = "setup_call" | "requires_call";

export type ZoeAdminInviteSnapshot = {
  column: ZoeAdminInviteColumn | null;
  emailRaw: string;
  dateYmd: string | null;
  timeHm: string | null;
};

export type ZoeAdminInviteSlot = {
  email: string;
  column: ZoeAdminInviteColumn;
  dateYmd: string;
  timeHm: string;
};

export type ZoeAdminInvitePlan =
  | { action: "skip" }
  | { action: "missing_slot" }
  | { action: "cancel"; slot: ZoeAdminInviteSlot }
  | { action: "request"; slot: ZoeAdminInviteSlot; cancelSlot: ZoeAdminInviteSlot | null };

export type ZoeAdminInviteResult =
  | { status: "skipped" | "missing_slot" | "sent" | "cancelled" }
  | { status: "failed"; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeZoeAdminInviteEmail(raw: unknown): string {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || value.length > 254) return "";
  if (!EMAIL_RE.test(value)) return "";
  return value;
}

export function zoeAdminInviteColumn(
  relevance: string | null | undefined,
  stage: string | null | undefined
): ZoeAdminInviteColumn | null {
  if (relevance === "not_relevant") return null;
  if (stage === "setup_call" || stage === "requires_call") return stage;
  return null;
}

function completeSlot(snapshot: ZoeAdminInviteSnapshot): ZoeAdminInviteSlot | null {
  if (snapshot.column !== "setup_call" && snapshot.column !== "requires_call") return null;
  const email = normalizeZoeAdminInviteEmail(snapshot.emailRaw);
  const dateYmd = String(snapshot.dateYmd ?? "").trim();
  const timeHm = String(snapshot.timeHm ?? "").trim();
  if (!email || !dateYmd || !timeHm) return null;
  return { email, column: snapshot.column, dateYmd, timeHm };
}

function slotKey(slot: ZoeAdminInviteSlot): string {
  return `${slot.column}|${slot.email}|${slot.dateYmd}|${slot.timeHm}`;
}

/**
 * זימון נשלח רק כשיש מייל, סטטוס שיחת הקמה/דורש שיחה, תאריך ושעה,
 * והחבילה הזו השתנתה. מחיקת שעה באמצע עריכה לא מבטלת זימון קיים.
 */
export function planZoeAdminCalendarInvite(
  previous: ZoeAdminInviteSnapshot,
  next: ZoeAdminInviteSnapshot
): ZoeAdminInvitePlan {
  const prev = completeSlot(previous);
  const nextSlot = completeSlot(next);
  const nextEmail = normalizeZoeAdminInviteEmail(next.emailRaw);
  const nextIsCall = next.column === "setup_call" || next.column === "requires_call";

  if (prev && nextSlot && slotKey(prev) === slotKey(nextSlot)) return { action: "skip" };
  if (nextSlot) {
    return {
      action: "request",
      slot: nextSlot,
      cancelSlot: prev && prev.email !== nextSlot.email ? prev : null,
    };
  }
  if (prev && !nextIsCall) return { action: "cancel", slot: prev };
  if (prev && nextIsCall && !String(next.emailRaw ?? "").trim()) return { action: "cancel", slot: prev };
  if (nextIsCall && nextEmail && (!String(next.dateYmd ?? "").trim() || !String(next.timeHm ?? "").trim())) {
    return { action: "missing_slot" };
  }
  return { action: "skip" };
}

function formatHeDate(ymd: string): string {
  const [year, month, day] = ymd.split("-");
  if (!year || !month || !day) return ymd;
  return `${Number(day)}.${Number(month)}.${year}`;
}

function meetingLabel(column: ZoeAdminInviteColumn): string {
  return column === "setup_call" ? "שיחת הקמה" : "שיחה";
}

function escHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function zoeAdminInviteMessage(input: {
  slot: ZoeAdminInviteSlot;
  businessName: string;
  cancelled: boolean;
}): { subject: string; htmlContent: string; description: string } {
  const when = `${formatHeDate(input.slot.dateYmd)} בשעה ${input.slot.timeHm}`;
  const label = meetingLabel(input.slot.column);
  const name = input.businessName.trim();
  const greeting = name ? `היי ${escHtml(name)},` : "היי,";
  const minutes = Math.round(ZOE_ADMIN_CALL_DURATION_MS / 60000);
  const subject = input.cancelled
    ? `בוטל: ${label} עם זואי — ${when}`
    : `זימון: ${label} עם זואי — ${when}`;
  const description = input.cancelled
    ? `${label} עם זואי ל-${when} בוטלה.`
    : `נקבעה ${label} עם זואי ל-${when}. נתקשר אליך בטלפון. משך השיחה כ-${minutes} דקות.`;
  const body = input.cancelled
    ? `${greeting}<br/><br/>${escHtml(label)} עם זואי שנקבעה ל-${escHtml(when)} בוטלה.`
    : `${greeting}<br/><br/>נקבעה ${escHtml(label)} עם זואי ל-${escHtml(when)}.<br/>נתקשר אליך בטלפון. משך השיחה כ-${minutes} דקות.<br/><br/>הזימון מצורף, ואפשר להוסיף אותו ליומן.`;
  return {
    subject,
    description,
    htmlContent: `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7">${body}</div>`,
  };
}

async function deliverInvite(input: {
  phone: string;
  to: string;
  businessName: string;
  slot: ZoeAdminInviteSlot;
  method: "REQUEST" | "CANCEL";
  sequence: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const event = zoeAdminGuestEvent({
    phone: input.phone,
    column: input.slot.column,
    dateYmd: input.slot.dateYmd,
    timeHm: input.slot.timeHm,
  });
  if (!event) return { ok: false, error: "invalid_slot" };
  const message = zoeAdminInviteMessage({
    slot: input.slot,
    businessName: input.businessName,
    cancelled: input.method === "CANCEL",
  });
  const ics = buildZoeAdminInviteIcs({
    event,
    method: input.method,
    attendeeEmail: input.to,
    attendeeName: input.businessName.trim() || "אורח",
    description: message.description,
    sequence: input.sequence,
  });
  return sendEmail({
    to: input.to,
    subject: message.subject,
    htmlContent: message.htmlContent,
    attachments: [
      {
        name: input.method === "CANCEL" ? "heyzoe-cancel.ics" : "heyzoe-invite.ics",
        contentBase64: Buffer.from(ics, "utf8").toString("base64"),
      },
    ],
    headers: { "Content-Class": "urn:content-classes:calendarmessage" },
  });
}

/** קריאת Brevo אחת לזימון, ועוד אחת אם צריך לבטל כתובת קודמת. */
export async function deliverZoeAdminCalendarInvite(input: {
  phone: string;
  businessName: string;
  plan: Extract<ZoeAdminInvitePlan, { action: "request" | "cancel" }>;
}): Promise<ZoeAdminInviteResult> {
  const sequence = Math.floor(Date.now() / 1000);
  if (input.plan.action === "cancel") {
    const sent = await deliverInvite({
      phone: input.phone,
      to: input.plan.slot.email,
      businessName: input.businessName,
      slot: input.plan.slot,
      method: "CANCEL",
      sequence,
    });
    if (!sent.ok) return { status: "failed", error: sent.error };
    return { status: "cancelled" };
  }

  if (input.plan.cancelSlot) {
    const cancelled = await deliverInvite({
      phone: input.phone,
      to: input.plan.cancelSlot.email,
      businessName: input.businessName,
      slot: input.plan.cancelSlot,
      method: "CANCEL",
      sequence,
    });
    if (!cancelled.ok) {
      console.error("[zoe-admin-calendar-invite] cancel previous attendee failed:", cancelled.error);
    }
  }

  const sent = await deliverInvite({
    phone: input.phone,
    to: input.plan.slot.email,
    businessName: input.businessName,
    slot: input.plan.slot,
    method: "REQUEST",
    sequence: input.plan.cancelSlot ? sequence + 1 : sequence,
  });
  if (!sent.ok) return { status: "failed", error: sent.error };
  return { status: "sent" };
}
