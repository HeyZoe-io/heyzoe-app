import { formatLeadPhoneDisplay } from "@/lib/notifications/owner-email-context";

const PLAN_DO_LEAD_URL = "https://plando.co.il/contacts/lead_form1";

export type PlanDoLeadPayload = {
  access_key: string;
  name: string;
  phone: string;
  email: string;
  no_redirect: number;
  contact: {
    remark: string;
    customer_cat_id: 0;
  };
};

function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

/** פלנדו: POST אחד — חיפוש לפי טלפון, יצירת ליד או הוספת הערה בצד השרת. */
export async function submitPlanDoLeadEvent(input: {
  apiKey: string;
  phone: string;
  fullName?: string | null;
  noteText: string;
}): Promise<{ ok: true } | { ok: false; error: string; detail?: string }> {
  const accessKey = String(input.apiKey ?? "").trim();
  if (!accessKey) return { ok: false, error: "missing_api_key" };

  const phoneDisplay = formatLeadPhoneDisplay(input.phone);
  if (!phoneDisplay || phoneDisplay === "—") return { ok: false, error: "invalid_phone" };

  const noteText = String(input.noteText ?? "").trim();
  if (!noteText) return { ok: false, error: "missing_note" };

  const name = String(input.fullName ?? "").trim() || phoneDisplay;

  const payload: PlanDoLeadPayload = {
    access_key: accessKey,
    name,
    phone: phoneDisplay,
    email: "",
    no_redirect: 1,
    contact: {
      remark: noteText,
      customer_cat_id: 0,
    },
  };

  try {
    const res = await fetch(PLAN_DO_LEAD_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rawText = await res.text();
    if (!res.ok) {
      console.error("[crm/plan-do] HTTP error", {
        status: res.status,
        phone: maskPhoneForLog(phoneDisplay),
        body: rawText.slice(0, 500),
      });
      return { ok: false, error: "http_error", detail: `status_${res.status}` };
    }

    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[crm/plan-do] request failed", {
      phone: maskPhoneForLog(phoneDisplay),
      error: message,
    });
    return { ok: false, error: "request_failed", detail: message };
  }
}
