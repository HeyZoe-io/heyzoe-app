import { SALES_FLOW_START_BUTTON_LABEL_HE } from "@/lib/sales-flow-start-triggers";

/** טקסטי ברירת מחדל למעקב אחרי שתיקה בווטסאפ (20 דק׳ / 2 שעות / 23 שעות). {{bot_name}}, {{business_name}}, {{phone}} ב־2–3, {{service_phone_note}} ב־1 (מותנה: נוסף רק אם לעסק יש טלפון תצוגה) */

export const WA_SALES_FOLLOWUP_1_DEFAULT =
  `היי! 😊 לפעמים ההודעות הולכות לאיבוד, אבל בונדינג חזק נשאר לנצח. להמשך שיחה ניתן ללחוץ על הכפתור הקודם מהתפריט, לשאול שאלה פתוחה, או לכתוב *${SALES_FLOW_START_BUTTON_LABEL_HE}* ונתחיל מחדש.{{service_phone_note}}`;

export const WA_SALES_FOLLOWUP_2_DEFAULT =
  `היי, {{bot_name}} כאן 👋 מ{{business_name}}. אני אומנם בוטית ואין לי ממש חיי חברה או עיסוקים, אבל רק מזכירה שאני עוד כאן ממתינה לתשובתך :) יש לך שאלה? אפשר לכתוב לי. לתחילת שיחה חדשה יש לכתוב *${SALES_FLOW_START_BUTTON_LABEL_HE}*`;

export const WA_SALES_FOLLOWUP_3_DEFAULT =
  "הולה! זו {{bot_name}} מ{{business_name}} 🌟 זו הפעם האחרונה שאני אצור איתך קשר - כדי לא להטריד😊 אם יש בך רצון להתאהב בשגרת האימונים החדשה שלך, אני כאן כדי לגרום לזה לקרות. אפשר לשאול אותי כל שאלה או להרים טלפון ישירות למספר {{phone}} אנחנו כאן בשבילך! שיהיה המשך יום קסום.";

function asSocialRecord(social: unknown): Record<string, unknown> {
  if (!social || typeof social !== "object" || Array.isArray(social)) return {};
  return social as Record<string, unknown>;
}

/**
 * כשאין מספר שירות לקוחות — להשמיט את פסוקית הטלפון שמכילה {{phone}}
 * (למשל «או להרים טלפון ישירות למספר {{phone}}») במקום להשאיר משפט קטוע.
 */
export function stripPhonePlaceholderClauseWhenEmpty(tpl: string): string {
  let out = String(tpl ?? "");
  // פסוקית עם חיבור/הזמנה לפני {{phone}} — «או להרים טלפון…», «ניתן להתקשר ל…» וכד׳ → נקודה
  out = out.replace(
    /\s*(?:,?\s*(?:או|ו))?\s*(?:ניתן|אפשר|מוזמנ(?:ים|ות))?\s*(?:ל)?(?:הרים\s+טלפון|להתקשר|לחייג|טלפון)[^.!?\n]*\{\{phone\}\}/gu,
    "."
  );
  // שארית {{phone}} בודדת אם נשארה
  out = out.replace(/\s*\{\{phone\}\}/gu, "");
  // ניקוי רווחים ופיסוק כפול
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.!?,])/g, "$1")
    .replace(/([.!?])[.,]+/g, "$1")
    .trim();
}

export function resolveWaSalesFollowupTemplates(social: unknown): {
  t1: string;
  t2: string;
  t3: string;
} {
  const sl = asSocialRecord(social);
  const pick = (key: "wa_sales_followup_1" | "wa_sales_followup_2" | "wa_sales_followup_3", fallback: string) => {
    const v = sl[key];
    return typeof v === "string" && v.trim() ? v.trim() : fallback;
  };
  return {
    t1: pick("wa_sales_followup_1", WA_SALES_FOLLOWUP_1_DEFAULT),
    t2: pick("wa_sales_followup_2", WA_SALES_FOLLOWUP_2_DEFAULT),
    t3: pick("wa_sales_followup_3", WA_SALES_FOLLOWUP_3_DEFAULT),
  };
}

/** ברירת מחדל: פעיל. רק `false` מפורש מכבה (עסקים קיימים בלי השדה ממשיכים לשלוח). */
export function socialFlagEnabled(value: unknown): boolean {
  return value !== false;
}

export type WaSalesFollowupEnabled = {
  e1: boolean;
  e2: boolean;
  e3: boolean;
};

export function resolveWaSalesFollowupEnabled(social: unknown): WaSalesFollowupEnabled {
  const sl = asSocialRecord(social);
  return {
    e1: socialFlagEnabled(sl.wa_sales_followup_1_enabled),
    e2: socialFlagEnabled(sl.wa_sales_followup_2_enabled),
    e3: socialFlagEnabled(sl.wa_sales_followup_3_enabled),
  };
}

export function isWaSalesFollowupStageEnabled(
  enabled: WaSalesFollowupEnabled,
  stage: 1 | 2 | 3
): boolean {
  return stage === 1 ? enabled.e1 : stage === 2 ? enabled.e2 : enabled.e3;
}

export const WA_FOLLOWUP_MS_20_MIN = 20 * 60 * 1000;
export const WA_FOLLOWUP_MS_2_H = 2 * 60 * 60 * 1000;
export const WA_FOLLOWUP_MS_23_H = 23 * 60 * 60 * 1000;

export function nextDueWaFollowupStage(stageCurrent: number, elapsedMs: number): 0 | 1 | 2 | 3 {
  if (stageCurrent < 1 && elapsedMs >= WA_FOLLOWUP_MS_20_MIN) return 1;
  if (stageCurrent < 2 && elapsedMs >= WA_FOLLOWUP_MS_2_H) return 2;
  if (stageCurrent < 3 && elapsedMs >= WA_FOLLOWUP_MS_23_H) return 3;
  return 0;
}

export type WaFollowupSendPlan = {
  /** 0 = אין הודעה לשלוח עכשיו */
  sendStage: 0 | 1 | 2 | 3;
  /** שלב לשמור ב־contacts גם אם דילגנו על שלבים כבויים בלי לשלוח */
  advanceToStage: number;
};

/**
 * מדלג על שלבים כבויים (בלי לשלוח) ומחזיר את השלב הבא שפעיל ושהגיע זמנו.
 * אם כל השלבים המגיעים כבויים — advanceToStage מתקדם כדי לא להיתקע על אותו שלב.
 */
export function resolveWaFollowupSendPlan(input: {
  stageCurrent: number;
  elapsedMs: number;
  enabled: WaSalesFollowupEnabled;
}): WaFollowupSendPlan {
  let stage = Number(input.stageCurrent ?? 0) || 0;
  if (stage < 0) stage = 0;
  if (stage > 3) stage = 3;
  let advanced = stage;
  while (true) {
    const next = nextDueWaFollowupStage(stage, input.elapsedMs);
    if (next === 0) return { sendStage: 0, advanceToStage: advanced };
    if (!isWaSalesFollowupStageEnabled(input.enabled, next)) {
      stage = next;
      advanced = next;
      continue;
    }
    return { sendStage: next, advanceToStage: next };
  }
}
