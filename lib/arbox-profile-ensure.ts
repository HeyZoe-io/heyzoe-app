/**
 * Lazy-fill contacts.arbox_profile_id when opening a WhatsApp conversation.
 * IO (10x clients): 0 Arbox calls when already cached; at most 1 searchUser per
 * contact that still lacks profile_id (then persisted).
 */

import { ensureArboxProfileIdForContact } from "@/lib/crm/adapters/arbox";
import { businessHasArboxConnection } from "@/lib/crm/types";
import { extractPhoneFromSessionId } from "@/lib/conversations-sessions";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export async function resolveArboxProfileIdForConversation(input: {
  admin: AdminClient;
  slug: string;
  sessionId: string;
}): Promise<string | null> {
  const slug = String(input.slug ?? "").trim().toLowerCase();
  const sessionId = String(input.sessionId ?? "").trim();
  const phone = extractPhoneFromSessionId(sessionId);
  if (!slug || !phone) return null;

  const { data: biz } = await input.admin
    .from("businesses")
    .select("id, crm_type, crm_api_key, crm_box_id")
    .ilike("slug", slug)
    .maybeSingle();

  if (!businessHasArboxConnection(biz)) return null;

  const businessId = Number((biz as { id?: unknown }).id);
  if (!Number.isFinite(businessId) || businessId <= 0) return null;

  const apiKey = String((biz as { crm_api_key?: unknown }).crm_api_key ?? "").trim();
  const boxId = String((biz as { crm_box_id?: unknown }).crm_box_id ?? "").trim();
  if (!apiKey) return null;

  try {
    return await ensureArboxProfileIdForContact({
      businessId,
      apiKey,
      boxId,
      phone,
    });
  } catch (e) {
    console.error("[arbox-profile-ensure] failed", {
      slug,
      businessId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
