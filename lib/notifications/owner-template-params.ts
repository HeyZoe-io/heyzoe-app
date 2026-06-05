/**
 * מיפוי פרמטרים לתבניות Meta לבעל העסק — חייב להתאים ל-WABA (Meta Business Manager).
 *
 * | תבנית | פרמטרים |
 * |--------|---------|
 * | new_lead_notification | body: שם עסק, טלפון, שעה |
 * | human_agent_request | body: טלפון, תאריך+שעה |
 * | lead_registered | body: טלפון |
 * | lead_registered_with_time | body: טלפון, אימון, מועד, תאריך הרשמה, חימום |
 * | daily_summary | header: תאריך; body: שיחות, נרשמו (רשימה), ללא מענה (רשימה), קישור דשבורד |
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

/** שם התבנית ב-Meta Business Manager — חייב להתאים בדיוק */
export const DAILY_SUMMARY_WA_TEMPLATE_NAME = "daily_summary";

/**
 * daily_summary — HEADER: תאריך; BODY: שיחות, נרשמו, ללא מענה, קישור דשבורד
 * ערך {{2}}/{{3}} ב-body: 0508318162 - ליאור | 0546758590 - אופיר | ועוד 3
 * המפריד | רק בין לידים; בין טלפון לשם בתוך ליד: מקף עם רווחים ( - )
 * מעל 16 לידים: | ועוד X בסוף הרשימה
 * כל פרמטר body בשורה אחת (ללא \\n).
 */
export function buildDailySummaryWaParams(input: {
  dateLabel: string;
  conversationsHeld: number;
  registeredLine: string;
  noResponseLine: string;
  dashboardUrl: string;
}): OwnerTemplateComponent[] {
  return waHeaderAndBodyParams(
    input.dateLabel,
    String(Math.max(0, input.conversationsHeld)),
    input.registeredLine.trim() || "אין",
    input.noResponseLine.trim() || "אין",
    input.dashboardUrl.trim() || "https://heyzoe.io"
  );
}

/** bot_paused_waiting | lead_cta_no_signup | marketing_human_agent_request — BODY: טלפון */
export function buildSinglePhoneWaParams(leadPhoneDisplay: string): OwnerTemplateComponent[] {
  return waBodyParams(leadPhoneDisplay);
}
