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

export type CrmEventKind = "trial_registered" | "human_requested" | "no_response";

/** טקסטי הערה סטנדרטיים ל-CRM (תאריך בפורמט IL בזמן השליחה). */
export function buildCrmEventNote(kind: CrmEventKind, eventDateIl: string): string {
  switch (kind) {
    case "trial_registered":
      return `✅ זואי: הליד נרשם לשיעור ניסיון - ${eventDateIl}`;
    case "human_requested":
      return "🙋 זואי: הליד ביקש לדבר עם נציג";
    case "no_response":
      return "⏰ זואי: הליד לא ענה לאחר כל הפולואפים, מומלץ להתקשר";
  }
}
