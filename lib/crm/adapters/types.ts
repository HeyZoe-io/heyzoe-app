import type { CrmEventKind } from "@/lib/crm/types";

/** לקוח ב-CRM אחרי חיפוש או יצירה */
export type CrmContactRef = {
  externalId: string;
  created: boolean;
};

export type CrmDispatchInput = {
  businessId: number;
  crmType: string;
  apiKey: string;
  phone: string;
  fullName?: string | null;
  kind: CrmEventKind;
  noteText: string;
};

/**
 * כל אדפטר CRM:
 * 1) חיפוש לפי טלפון
 * 2) אם לא נמצא — יצירת ליד חדש (שם + טלפון) — endpoint יוגדר לפי דוקומנטציה
 * 3) הוספת הערה / משימה / פעילות על הלקוח
 */
export interface CrmAdapter {
  findOrCreateContact(input: {
    apiKey: string;
    phone: string;
    fullName?: string | null;
  }): Promise<CrmContactRef>;

  appendNote(input: {
    apiKey: string;
    contact: CrmContactRef;
    text: string;
    kind: CrmEventKind;
  }): Promise<void>;
}
