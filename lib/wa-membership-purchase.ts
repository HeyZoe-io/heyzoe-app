import { pickContentCopy, type BusinessContentLanguage } from "@/lib/business-content-lang";

export const MEMBERSHIP_PURCHASE_LINK_MODEL = "membership_purchase_link";
export const MEMBERSHIP_PURCHASE_TEAM_MODEL = "membership_purchase_team_handoff";

export type MembershipPurchaseOutcome = {
  text: string;
  model: string;
  notifyTeam: boolean;
};

/**
 * Claude tagged membership_purchase. The memberships page from the links tab if set,
 * otherwise the team. A second ask right after the link also goes to the team.
 */
export function resolveMembershipPurchaseReply(input: {
  membershipsUrl: string | null | undefined;
  lang: BusinessContentLanguage;
  linkAlreadySent: boolean;
}): MembershipPurchaseOutcome {
  const url = String(input.membershipsUrl ?? "").trim();
  if (url && !input.linkAlreadySent) {
    const intro = pickContentCopy(input.lang, {
      he: "הנה דף המנויים והכרטיסיות, משם אפשר לבחור ולרכוש:",
      en: "Here is our memberships and passes page, you can choose and purchase there:",
      ru: "Вот страница абонементов и карт, там можно выбрать и оплатить:",
    });
    return { text: `${intro}\n${url}`, model: MEMBERSHIP_PURCHASE_LINK_MODEL, notifyTeam: false };
  }
  return {
    text: pickContentCopy(input.lang, {
      he: "אין בעיה, מעבירה לצוות שיעזרו לך עם המנוי ויחזרו אלייך בהקדם 💜",
      en: "No problem, I'm passing this to the team so they can help you with the membership 💜",
      ru: "Без проблем, передаю команде, они помогут с абонементом и скоро свяжутся 💜",
    }),
    model: MEMBERSHIP_PURCHASE_TEAM_MODEL,
    notifyTeam: true,
  };
}
