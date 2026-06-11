import type { OfferKind } from "@/lib/sales-flow";
import { formatScheduleForOwnerNotification } from "@/lib/notifications/owner-template-params";

export const CRM_TYPES = ["", "arbox", "physikal", "boostapp", "plan_do"] as const;

export type CrmType = (typeof CRM_TYPES)[number];

export type CrmTypeOption = { value: CrmType; label: string };

export const CRM_TYPE_OPTIONS: CrmTypeOption[] = [
  { value: "", label: "ללא חיבור" },
  { value: "arbox", label: "Arbox" },
  { value: "physikal", label: "Physikal" },
  { value: "boostapp", label: "Boostapp" },
  { value: "plan_do", label: "Plan Do" },
];

export function normalizeCrmType(raw: unknown): CrmType {
  const t = String(raw ?? "").trim().toLowerCase();
  if (t === "plan do" || t === "plando") return "plan_do";
  return (CRM_TYPES as readonly string[]).includes(t) ? (t as CrmType) : "";
}

export type CrmEventKind =
  | "trial_registered"
  | "human_requested"
  | "no_response"
  | "not_relevant"
  | "template_sent"
  | "template_no_response";

export type CrmTrialRegistrationContext = {
  serviceName?: string | null;
  offerKind?: OfferKind;
  requestedDate?: string | null;
  requestedTime?: string | null;
  courseSchedulePhrase?: string | null;
};

function offerKindLabel(kind: OfferKind): string {
  switch (kind) {
    case "workshop":
      return "סדנה";
    case "course":
      return "קורס";
    default:
      return "שיעור ניסיון";
  }
}

function buildCrmRegistrationScheduleLine(ctx?: CrmTrialRegistrationContext | null): string {
  if (!ctx) return "";
  const schedule = formatScheduleForOwnerNotification({
    requestedDate: ctx.requestedDate,
    requestedTime: ctx.requestedTime,
  });
  const coursePhrase = String(ctx.courseSchedulePhrase ?? "").trim();
  if (ctx.offerKind === "course") {
    if (schedule && coursePhrase) return `${schedule} — ${coursePhrase}`;
    if (coursePhrase) return coursePhrase;
  }
  return schedule;
}

/** הערת CRM לרישום ניסיון / סדנה / קורס — כולל שם ומועד כשזמינים. */
export function buildCrmTrialRegisteredNote(
  eventDateIl: string,
  ctx?: CrmTrialRegistrationContext | null
): string {
  const kind = ctx?.offerKind ?? "trial";
  const typeLabel = offerKindLabel(kind);
  const serviceName = String(ctx?.serviceName ?? "").trim();
  const schedule = buildCrmRegistrationScheduleLine(ctx);

  let line = `✅ זואי: הליד נרשם ל${typeLabel}`;
  if (serviceName) line += ` — ${serviceName}`;
  if (schedule) line += `, ${schedule}`;
  line += ` (${eventDateIl})`;
  return line;
}

/** טקסטי הערה סטנדרטיים ל-CRM (תאריך בפורמט IL בזמן השליחה). */
export function buildCrmEventNote(
  kind: CrmEventKind,
  eventDateIl: string,
  registration?: CrmTrialRegistrationContext | null,
  notRelevantReason?: string | null
): string {
  switch (kind) {
    case "trial_registered":
      return buildCrmTrialRegisteredNote(eventDateIl, registration);
    case "human_requested":
      return "🙋 זואי: הליד ביקש לדבר עם נציג";
    case "no_response":
      return "⏰ זואי: הליד לא ענה לאחר כל הפולואפים, מומלץ להתקשר";
    case "template_sent":
      return "זואי - נשלח טמפלייט פתיחה לליד";
    case "template_no_response":
      return "עברו 6 שעות והליד לא ענה להודעת הפתיחה - יש ליצור איתו קשר טלפוני";
    case "not_relevant": {
      const r = String(notRelevantReason ?? "").trim();
      return r ? `זואי - לא רלוונטי - ${r}` : "זואי - לא רלוונטי";
    }
  }
}
