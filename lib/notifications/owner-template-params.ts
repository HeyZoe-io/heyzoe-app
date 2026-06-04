/**
 * מיפוי פרמטרים לתבניות Meta לבעל העסק — חייב להתאים ל-WABA (Meta Business Manager).
 *
 * | תבנית | פרמטרים |
 * |--------|---------|
 * | new_lead_notification | body: שם עסק, טלפון, שעה |
 * | human_agent_request | body: טלפון, תאריך+שעה |
 * | lead_registered | body: טלפון |
 * | lead_registered_with_time | body: טלפון, אימון, מועד, תאריך הרשמה, חימום |
 * | daily_summary | header: תאריך; body: לידים חדשים, נרשמו, ממתינים לטיפול |
 * | bot_paused_waiting / lead_cta_no_signup / marketing_human_agent_request | body: טלפון |
 * | quota_warning_* | ללא פרמטרים |
 */
import type { OwnerTemplateComponent } from "@/lib/notifications/sendOwnerNotification";
import {
  formatDayNameForScheduleDatePlaceholder,
  HEBREW_DAY_OPTIONS,
  normalizeRequestedDateForTemplate,
} from "@/lib/product-schedule-slots";

/** Meta template params: no newlines/tabs, max 4 consecutive spaces (error #132018). */
export function sanitizeMetaOwnerTemplateParam(text: string): string {
  return String(text ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {5,}/g, " ")
    .trim()
    .slice(0, 900);
}

export function waBodyParams(...texts: string[]): OwnerTemplateComponent[] {
  return [
    {
      type: "body",
      parameters: texts.map((text) => ({
        type: "text",
        text: sanitizeMetaOwnerTemplateParam(text),
      })),
    },
  ];
}

export function waHeaderAndBodyParams(
  headerText: string,
  ...bodyTexts: string[]
): OwnerTemplateComponent[] {
  return [
    {
      type: "header",
      parameters: [{ type: "text", text: sanitizeMetaOwnerTemplateParam(headerText) }],
    },
    {
      type: "body",
      parameters: bodyTexts.map((text) => ({
        type: "text",
        text: sanitizeMetaOwnerTemplateParam(text),
      })),
    },
  ];
}

/** מועד לתצוגה ב-WA/מייל: «רביעי בשעה 18:00» */
export function formatScheduleForOwnerNotification(input: {
  requestedDate?: string | null;
  requestedTime?: string | null;
}): string {
  const time = String(input.requestedTime ?? "").trim();
  let dayPart = normalizeRequestedDateForTemplate(String(input.requestedDate ?? "").trim());
  if (dayPart.length === 1) {
    dayPart = formatDayNameForScheduleDatePlaceholder(dayPart);
  } else {
    const byLetter = HEBREW_DAY_OPTIONS.find((o) => o.value === dayPart);
    if (byLetter) dayPart = byLetter.label;
  }
  if (dayPart && time) return `${dayPart} בשעה ${time}`;
  if (dayPart) return dayPart;
  if (time) return time;
  return "";
}

/** new_lead_notification — BODY: עסק, טלפון, שעה */
export function buildNewLeadNotificationWaParams(input: {
  businessName: string;
  leadPhoneDisplay: string;
  atHe: string;
}): OwnerTemplateComponent[] {
  return waBodyParams(
    input.businessName.trim() || "העסק שלך",
    input.leadPhoneDisplay,
    input.atHe
  );
}

/** human_agent_request — BODY: טלפון, תאריך+שעה */
export function buildHumanAgentRequestWaParams(input: {
  leadPhoneDisplay: string;
  requestedAtHe: string;
}): OwnerTemplateComponent[] {
  return waBodyParams(input.leadPhoneDisplay, input.requestedAtHe);
}

/** lead_registered — BODY: טלפון */
export function buildLeadRegisteredWaParams(leadPhoneDisplay: string): OwnerTemplateComponent[] {
  return waBodyParams(leadPhoneDisplay);
}

/** lead_registered_with_time — BODY: טלפון, אימון, מועד, תאריך הרשמה, חימום */
export function buildLeadRegisteredWithTimeWaParams(input: {
  leadPhoneDisplay: string;
  serviceName: string;
  schedule: string;
  registeredAtHe: string;
  warmupSummary: string;
}): OwnerTemplateComponent[] {
  return waBodyParams(
    input.leadPhoneDisplay,
    input.serviceName.trim() || "—",
    input.schedule.trim() || "—",
    input.registeredAtHe,
    input.warmupSummary.trim() || "—",
  );
}

/** daily_summary — HEADER: תאריך | BODY: לידים חדשים, נרשמו, ממתינים לטיפול */
export function buildDailySummaryWaParams(input: {
  dateLabel: string;
  newLeads: number;
  registered: number;
  idleWaitingCount: number;
}): OwnerTemplateComponent[] {
  return waHeaderAndBodyParams(
    input.dateLabel,
    String(Math.max(0, input.newLeads)),
    String(Math.max(0, input.registered)),
    String(Math.max(0, input.idleWaitingCount))
  );
}

/** bot_paused_waiting | lead_cta_no_signup | marketing_human_agent_request — BODY: טלפון */
export function buildSinglePhoneWaParams(leadPhoneDisplay: string): OwnerTemplateComponent[] {
  return waBodyParams(leadPhoneDisplay);
}
