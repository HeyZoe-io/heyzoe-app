import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { computeContactStatus } from "@/lib/contact-status";
import {
  firstNameFromFullName,
  renderLeadTemplateMessageContent,
  resolveLeadTemplateDisplayContent,
} from "@/lib/lead-template";
import { extractPhoneFromSessionId } from "@/lib/conversations-sessions";
import { contactPhoneLookupVariants } from "@/lib/phone-normalize";

export type SessionMessageRow = {
  role: string;
  content: string;
  created_at: string;
  error_code?: string | null;
};

async function loadContactFirstNameForSession(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  slug: string;
  sessionId: string;
}): Promise<string> {
  const phoneRaw = extractPhoneFromSessionId(input.sessionId);
  const phoneVariants = contactPhoneLookupVariants(phoneRaw);
  if (!phoneVariants.length) return "שלום";

  const normSlug = String(input.slug ?? "").trim().toLowerCase();
  if (!normSlug) return "שלום";

  const { data: biz } = await input.admin
    .from("businesses")
    .select("id")
    .ilike("slug", normSlug)
    .maybeSingle();
  const businessId = Number((biz as { id?: number } | null)?.id ?? 0);
  if (!Number.isFinite(businessId) || businessId <= 0) return "שלום";

  const { data: contact } = await input.admin
    .from("contacts")
    .select("full_name")
    .eq("business_id", businessId)
    .in("phone", phoneVariants)
    .maybeSingle();

  const fullName = String((contact as { full_name?: string | null } | null)?.full_name ?? "").trim();
  return firstNameFromFullName(fullName);
}

/** מחליף placeholder «נשלח טמפלייט…» בטקסט המלא לתצוגה בדשבורד. */
export async function enrichLeadTemplateMessagesForDisplay(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  slug: string;
  sessionId: string;
  messages: SessionMessageRow[];
}): Promise<SessionMessageRow[]> {
  if (!input.messages.length) return input.messages;

  const firstName = await loadContactFirstNameForSession(input);
  return input.messages.map((m) => ({
    ...m,
    content: resolveLeadTemplateDisplayContent(m.content, { firstName }),
  }));
}

/** הודעת טמפלייט סינתטית ללידים ישנים שלא נרשמו ב-messages */
export async function appendLeadTemplateMessageFallback(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  slug: string;
  sessionId: string;
  messages: SessionMessageRow[];
}): Promise<SessionMessageRow[]> {
  if (input.messages.length > 0) {
    return enrichLeadTemplateMessagesForDisplay(input);
  }

  const phoneRaw = extractPhoneFromSessionId(input.sessionId);
  const phoneVariants = contactPhoneLookupVariants(phoneRaw);
  if (!phoneVariants.length) return input.messages;

  const normSlug = String(input.slug ?? "").trim().toLowerCase();
  if (!normSlug) return input.messages;

  const { data: biz } = await input.admin
    .from("businesses")
    .select("id, lead_template_name")
    .ilike("slug", normSlug)
    .maybeSingle();
  const businessId = Number((biz as { id?: number } | null)?.id ?? 0);
  if (!Number.isFinite(businessId) || businessId <= 0) return input.messages;

  const { data: contact } = await input.admin
    .from("contacts")
    .select(
      "phone, full_name, source, session_phase, opted_out, trial_registered, wa_followup_stage, last_contact_at, wa_no_response_at, created_at"
    )
    .eq("business_id", businessId)
    .in("phone", phoneVariants)
    .maybeSingle();

  if (!contact) return input.messages;
  if (computeContactStatus(contact as Parameters<typeof computeContactStatus>[0]) !== "template") {
    return input.messages;
  }

  const templateName = String((biz as { lead_template_name?: string | null }).lead_template_name ?? "").trim();
  const createdAt = String((contact as { created_at?: string | null }).created_at ?? new Date().toISOString());
  const firstName = firstNameFromFullName(String((contact as { full_name?: string | null }).full_name ?? ""));

  return [
    {
      role: "assistant",
      content: renderLeadTemplateMessageContent(templateName, { firstName }),
      created_at: createdAt,
      error_code: null,
    },
  ];
}
