import type { ClosedPlaybookCategory } from "@/lib/wa-closed-playbook-types";
import { buildClassRescheduleTeamHandoffReply } from "@/lib/wa-class-reschedule";

export const CLOSED_PLAYBOOK_CANCELLATION_REPLY =
  "אני מבינה, אני אעביר את הבקשה לביטול לצוות שלנו והם יחזרו אלייך בהקדם 💜";

export const CLOSED_PLAYBOOK_FREEZE_REPLY =
  "בשמחה, אני מעבירה את בקשת ההקפאה לצוות - הם יטפלו בזה מולך 💜";

export const CLOSED_PLAYBOOK_REFUND_REPLY =
  "אני מבינה, אני אעביר את הפנייה ישירות לצוות - הם יחזרו אלייך 💜";

export const CLOSED_PLAYBOOK_MEDICAL_REPLY =
  "בנושא כזה חשוב לדבר עם הצוות ישירות ולא איתי - אני מעבירה אליהם את הפנייה ויחזרו אלייך 💜";

export const CLOSED_PLAYBOOK_COMPLAINT_REPLY =
  "אני מצטערת לשמוע, אני מעבירה את זה כעת לצוות שלנו וידאגו לחזור אלייך בהקדם 💜";

export const CLOSED_PLAYBOOK_GROUP_REPLY =
  "איזה כיף! אני מעבירה את זה לצוות, הם ידברו איתך על הפרטים 💜";

export const CLOSED_PLAYBOOK_DISCOUNT_NO_PROMO_REPLY =
  "אין לי ממש יכולת לעזור כאן אבל אני יכולה להעביר את זה לצוות שיצרו איתך קשר ✨";

export const CLOSED_PLAYBOOK_COACH_OWNER_REPLY = "בשמחה, אני מעבירה את זה ישירות אליהם 💜";

export function buildClosedPlaybookDefaultReply(
  category: ClosedPlaybookCategory,
  botName?: string | null
): string {
  switch (category) {
    case "reschedule":
      return buildClassRescheduleTeamHandoffReply(botName ?? "");
    case "cancellation":
      return CLOSED_PLAYBOOK_CANCELLATION_REPLY;
    case "freeze":
      return CLOSED_PLAYBOOK_FREEZE_REPLY;
    case "refund":
      return CLOSED_PLAYBOOK_REFUND_REPLY;
    case "medical":
      return CLOSED_PLAYBOOK_MEDICAL_REPLY;
    case "complaint":
      return CLOSED_PLAYBOOK_COMPLAINT_REPLY;
    case "group":
      return CLOSED_PLAYBOOK_GROUP_REPLY;
    case "discount":
      return CLOSED_PLAYBOOK_DISCOUNT_NO_PROMO_REPLY;
    case "coach_owner":
      return CLOSED_PLAYBOOK_COACH_OWNER_REPLY;
  }
}

export function closedPlaybookModelUsed(
  category: ClosedPlaybookCategory,
  source: "default" | "fact" | "promo" | "catalog"
): string {
  if (source === "promo") return "closed_playbook_promo";
  if (source === "catalog") return `closed_playbook_catalog_${category}`;
  if (source === "fact") return `closed_playbook_fact_${category}`;
  if (category === "reschedule") return "class_reschedule_team_handoff";
  return `closed_playbook_${category}`;
}
