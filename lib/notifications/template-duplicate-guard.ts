import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { buildWaSessionId } from "@/lib/phone-normalize";
import { bodyTextFromTemplateComponents } from "@/lib/template-presets";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Last-line window. The morning job is about 15 hours after an 18:30 send. */
export const TEMPLATE_DUPLICATE_WINDOW_MS = 20 * 60 * 60 * 1000;

export const DUPLICATE_GUARD_ERROR = "duplicate_guard";

/**
 * Static pieces of an approved body, long enough to identify the template
 * after the placeholders are filled.
 */
export function templateStaticChunks(body: string): string[] {
  return body
    .split(/\{\{\s*\d+\s*\}\}/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 8);
}

export function messageMatchesAutomatedTemplate(input: {
  content: string;
  staticChunks: readonly string[];
  params: readonly string[];
}): boolean {
  const content = input.content.replace(/\s+/g, " ");
  const chunks = input.staticChunks.map((chunk) => chunk.replace(/\s+/g, " ").trim()).filter(Boolean);
  const params = input.params.map((param) => param.trim()).filter((param) => param.length >= 2);
  if (!chunks.length && params.length < 2) return false;
  if (chunks.some((chunk) => !content.includes(chunk))) return false;
  if (params.some((param) => !content.includes(param))) return false;
  return true;
}

/**
 * Indexed read: messages (business_slug, session_id, role, created_at).
 * One template-body read. No Graph call.
 * A query error does not block the send; a positive match does.
 */
export async function findRecentAutomatedTemplateSend(input: {
  admin: Admin;
  businessId: number;
  phoneNumberId: string;
  phone: string;
  templateName: string;
  params: readonly string[];
  now?: Date;
}): Promise<boolean> {
  const phone = input.phone.replace(/\D/g, "");
  const templateName = input.templateName.trim();
  if (!phone || !templateName || !input.businessId) return false;
  const sessionId = buildWaSessionId(input.phoneNumberId, phone);
  if (!sessionId) return false;

  const { data: biz, error: bizErr } = await input.admin
    .from("businesses")
    .select("slug")
    .eq("id", input.businessId)
    .maybeSingle();
  if (bizErr || !biz) {
    console.error("[template-duplicate-guard] business lookup failed", bizErr?.message ?? "missing");
    return false;
  }
  const slug = String((biz as { slug?: unknown }).slug ?? "").trim();
  if (!slug) return false;

  const since = new Date((input.now ?? new Date()).getTime() - TEMPLATE_DUPLICATE_WINDOW_MS).toISOString();
  const [{ data: messages, error: msgErr }, { data: tpl, error: tplErr }] = await Promise.all([
    input.admin
      .from("messages")
      .select("content")
      .eq("business_slug", slug)
      .eq("session_id", sessionId)
      .eq("role", "assistant")
      .eq("model_used", "lead_template")
      .gte("created_at", since)
      .limit(20),
    input.admin
      .from("whatsapp_templates")
      .select("components")
      .eq("business_id", input.businessId)
      .eq("name", templateName)
      .eq("status", "APPROVED")
      .limit(1)
      .maybeSingle(),
  ]);
  if (msgErr) {
    console.error("[template-duplicate-guard] message lookup failed", msgErr.message);
    return false;
  }
  if (tplErr) {
    console.error("[template-duplicate-guard] template lookup failed", tplErr.message);
  }
  const chunks = templateStaticChunks(
    bodyTextFromTemplateComponents((tpl as { components?: unknown } | null)?.components)
  );
  return (messages ?? []).some((row) =>
    messageMatchesAutomatedTemplate({
      content: String((row as { content?: unknown }).content ?? ""),
      staticChunks: chunks,
      params: input.params,
    })
  );
}
