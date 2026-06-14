import { isLeadTemplateOnlyContact } from "@/lib/lead-template";
import { isIdleAfterLastUserMessage, waNoResponseEligible } from "@/lib/wa-no-response";
import type { DashboardLang } from "@/lib/dashboard-lang";

export type ContactStatusKey =
  | "opted_out"
  | "not_relevant"
  | "registered"
  | "no_response"
  | "followup"
  | "template"
  | "active";

export type ContactStatusInput = {
  opted_out?: boolean | null;
  not_relevant_at?: string | null;
  trial_registered?: boolean | null;
  session_phase?: string | null;
  source?: string | null;
  wa_no_response_at?: string | null;
  wa_followup_stage?: number | null;
  last_contact_at?: string | null;
};

const ACTIVE_PHASES = new Set(["opening", "warmup", "schedule_date", "schedule_time", "cta"]);

export function computeContactStatus(input: ContactStatusInput): ContactStatusKey | null {
  if (input.opted_out === true) return "opted_out";
  if (input.not_relevant_at) return "not_relevant";
  if (input.trial_registered === true || input.session_phase === "registered") return "registered";
  if (input.wa_no_response_at) return "no_response";

  const stage = Number(input.wa_followup_stage ?? 0);
  if (stage === 3) return "no_response";

  // last_contact_at מתעדכן בהודעת user — 26ש׳+ בלי נרשם/הסר → ללא מענה (גם אם stage פולואפ תקוע)
  if (
    waNoResponseEligible(input) &&
    isIdleAfterLastUserMessage(input.last_contact_at ? String(input.last_contact_at) : null)
  ) {
    return "no_response";
  }

  if (stage === 1 || stage === 2) return "followup";

  if (isLeadTemplateOnlyContact(input)) return "template";

  const phase = String(input.session_phase ?? "").trim();
  if (ACTIVE_PHASES.has(phase)) return "active";

  return null;
}

export type ContactStatusMeta = { label: string; tooltip: string; badgeClass: string };

const CONTACT_STATUS_META_HE: Record<ContactStatusKey, ContactStatusMeta> = {
  active: {
    label: "פעיל",
    tooltip: "שיחה פעילה",
    badgeClass: "border-blue-200 bg-blue-50 text-blue-800",
  },
  followup: {
    label: "פולואפ",
    tooltip: "3 הודעות ב-24 שעות",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-900",
  },
  template: {
    label: "טמפלייט",
    tooltip:
      "נשלח טמפלייט פתיחה — אם אין תגובה תוך 6 שעות הליד עובר ל«ללא מענה» ונשלח ל-CRM",
    badgeClass: "border-violet-200 bg-violet-50 text-violet-900",
  },
  no_response: {
    label: "ללא מענה",
    tooltip: "26+ שעות מהודעת הליד האחרונה, בלי «נרשמתי» (לא נרשם / לא הסיר)",
    badgeClass: "border-red-200 bg-red-50 text-red-800",
  },
  registered: {
    label: "נרשם",
    tooltip: "הליד נרשם בהצלחה",
    badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  opted_out: {
    label: "הסר",
    tooltip: "הליד ביקש להפסיק התקשרות",
    badgeClass: "border-zinc-300 bg-zinc-100 text-zinc-700",
  },
  not_relevant: {
    label: "לא רלוונטי",
    tooltip: "הליד ציין שאינו מעוניין / לא רלוונטי — זואי הפסיקה פולואפים",
    badgeClass: "border-slate-300 bg-slate-100 text-slate-800",
  },
};

const CONTACT_STATUS_META_EN: Record<ContactStatusKey, ContactStatusMeta> = {
  active: {
    label: "Active",
    tooltip: "Active conversation",
    badgeClass: "border-blue-200 bg-blue-50 text-blue-800",
  },
  followup: {
    label: "Follow-up",
    tooltip: "3 messages within 24 hours",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-900",
  },
  template: {
    label: "Template",
    tooltip: "Opening template sent — no reply within 6 hours moves lead to no response + CRM",
    badgeClass: "border-violet-200 bg-violet-50 text-violet-900",
  },
  no_response: {
    label: "No Response",
    tooltip: "26+ hours since last lead message, without «I registered» (not registered / not opted out)",
    badgeClass: "border-red-200 bg-red-50 text-red-800",
  },
  registered: {
    label: "Registered",
    tooltip: "Lead registered successfully",
    badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  opted_out: {
    label: "Opted Out",
    tooltip: "Lead asked to stop communication",
    badgeClass: "border-zinc-300 bg-zinc-100 text-zinc-700",
  },
  not_relevant: {
    label: "Not Relevant",
    tooltip: "Lead indicated not interested / not relevant — Zoe stopped follow-ups",
    badgeClass: "border-slate-300 bg-slate-100 text-slate-800",
  },
};

/** Hebrew labels (backward compat for contacts page). */
export const CONTACT_STATUS_META = CONTACT_STATUS_META_HE;

export function getContactStatusMeta(lang: DashboardLang): Record<ContactStatusKey, ContactStatusMeta> {
  return lang === "en" ? CONTACT_STATUS_META_EN : CONTACT_STATUS_META_HE;
}

export function contactStatusLabel(key: ContactStatusKey | null, lang: DashboardLang = "he"): string {
  if (!key) return "";
  return getContactStatusMeta(lang)[key].label;
}

/** סדר תצוגה בפילטר סטטוס בדף לידים */
export const CONTACT_STATUS_FILTER_ORDER: ContactStatusKey[] = [
  "template",
  "active",
  "followup",
  "no_response",
  "not_relevant",
  "registered",
  "opted_out",
];

export type ContactStatusFilterValue = ContactStatusKey | "all" | "none";

/** סטטוסים שניתן לקבוע ידנית מדשבורד הלידים */
export const MANUAL_CONTACT_STATUSES: ContactStatusKey[] = ["not_relevant"];

export function canManuallySetContactStatus(
  target: ContactStatusKey,
  contact: ContactStatusInput
): boolean {
  if (target === "not_relevant") {
    return contact.opted_out !== true && !contact.not_relevant_at;
  }
  return false;
}
