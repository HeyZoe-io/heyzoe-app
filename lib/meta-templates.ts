/**
 * Meta Graph API helpers for WhatsApp message templates (list / create / update).
 * Auth: WHATSAPP_SYSTEM_TOKEN (same System User token as meta-waba-resolve).
 * Graph version matches the rest of the codebase (v21.0).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const META_GRAPH_VERSION = "v21.0";
const LIST_PAGE_LIMIT = 100;
const LIST_MAX_TEMPLATES = 500;

export type MetaWabaTemplate = {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  components?: unknown[];
};

export type CreateWabaTemplatePayload = {
  name: string;
  category: string;
  language: string;
  components: unknown[];
};

export type CreateWabaTemplateResult = {
  id: string;
  status: string;
  category?: string;
};

export type UpdateWabaTemplatePayload = {
  category?: string;
  components: unknown[];
};

export type UpdateWabaTemplateResult = {
  success: boolean;
  id?: string;
  name?: string;
  category?: string;
  status?: string;
};

function resolveSystemToken(): string {
  const token = process.env.WHATSAPP_SYSTEM_TOKEN?.trim() ?? "";
  if (!token) {
    throw new Error("[meta-templates] missing WHATSAPP_SYSTEM_TOKEN");
  }
  return token;
}

function normalizeWabaId(wabaId: string): string {
  const waba = String(wabaId ?? "").trim().replace(/\s+/g, "");
  if (!waba) {
    throw new Error("[meta-templates] missing wabaId");
  }
  return waba;
}

function parseTemplateRow(row: unknown): MetaWabaTemplate | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const name = String(r.name ?? "").trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    status: String(r.status ?? "").trim(),
    category: String(r.category ?? "").trim(),
    language: String(r.language ?? "").trim(),
    ...(Array.isArray(r.components) ? { components: r.components } : {}),
  };
}

/**
 * GET /{waba-id}/message_templates — lists templates on a WABA.
 * Follows `paging.next` until exhausted, capped at {@link LIST_MAX_TEMPLATES}.
 */
export async function listWabaTemplates(wabaId: string): Promise<MetaWabaTemplate[]> {
  const waba = normalizeWabaId(wabaId);
  const token = resolveSystemToken();

  const collected: MetaWabaTemplate[] = [];
  let url: string | null =
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(waba)}/message_templates` +
    `?limit=${LIST_PAGE_LIMIT}`;

  while (url && collected.length < LIST_MAX_TEMPLATES) {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const bodyText = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(
        `[listWabaTemplates] Meta Graph API ${res.status}: ${bodyText || res.statusText}`
      );
    }

    let json: unknown = null;
    try {
      json = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      json = null;
    }

    const page = json as { data?: unknown[]; paging?: { next?: string } } | null;
    const rows = Array.isArray(page?.data) ? page.data : [];
    for (const row of rows) {
      const parsed = parseTemplateRow(row);
      if (parsed) collected.push(parsed);
      if (collected.length >= LIST_MAX_TEMPLATES) break;
    }

    const next = String(page?.paging?.next ?? "").trim();
    url = next && collected.length < LIST_MAX_TEMPLATES ? next : null;
  }

  return collected;
}

const TEMPLATE_DETAIL_FIELDS = "id,name,status,category,language,components";

/**
 * GET /{template-id}?fields=… — fetches one template including components.
 * Used after Meta approval webhooks to sync the approved body/header/buttons locally.
 */
export async function getWabaTemplateById(templateId: string): Promise<MetaWabaTemplate | null> {
  const id = String(templateId ?? "").trim();
  if (!id) return null;
  const token = resolveSystemToken();

  const url =
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(id)}` +
    `?fields=${encodeURIComponent(TEMPLATE_DETAIL_FIELDS)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(
      `[getWabaTemplateById] Meta Graph API ${res.status}: ${bodyText || res.statusText}`
    );
  }

  let json: unknown = null;
  try {
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    throw new Error(`[getWabaTemplateById] invalid JSON response: ${bodyText}`);
  }

  return parseTemplateRow(json);
}

/** DB patch fields when applying an approved Meta template snapshot. */
export function approvedTemplateSyncPatch(
  metaTpl: MetaWabaTemplate,
  fallbackStatus: string,
  nowIso: string
): {
  status: string;
  components: unknown[];
  category?: string;
  waba_template_id: string;
  updated_at: string;
} {
  return {
    status: metaTpl.status || fallbackStatus,
    components: metaTpl.components ?? [],
    ...(metaTpl.category ? { category: metaTpl.category } : {}),
    waba_template_id: metaTpl.id,
    updated_at: nowIso,
  };
}

/**
 * POST /{waba-id}/message_templates — creates a template (usually returns PENDING).
 */
export async function createWabaTemplate(
  wabaId: string,
  payload: CreateWabaTemplatePayload
): Promise<CreateWabaTemplateResult> {
  const waba = normalizeWabaId(wabaId);
  const token = resolveSystemToken();

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(waba)}/message_templates`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(
      `[createWabaTemplate] Meta Graph API ${res.status}: ${bodyText || res.statusText}`
    );
  }

  let json: unknown = null;
  try {
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    throw new Error(`[createWabaTemplate] invalid JSON response: ${bodyText}`);
  }

  const r = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const status = String(r.status ?? "").trim();
  if (!id) {
    throw new Error(`[createWabaTemplate] response missing id: ${bodyText}`);
  }

  return {
    id,
    status,
    ...(r.category != null ? { category: String(r.category) } : {}),
  };
}

/**
 * POST /{template-id} — edits category/components. Name and language cannot change.
 * Meta re-reviews the template; APPROVED typically becomes PENDING until approved again.
 * 1 Graph call per save (owner-initiated, not a cron).
 */
export async function updateWabaTemplate(
  templateId: string,
  payload: UpdateWabaTemplatePayload
): Promise<UpdateWabaTemplateResult> {
  const id = String(templateId ?? "").trim();
  if (!id) {
    throw new Error("[updateWabaTemplate] missing templateId");
  }
  if (!Array.isArray(payload.components) || payload.components.length === 0) {
    throw new Error("[updateWabaTemplate] missing components");
  }
  const token = resolveSystemToken();

  const body: Record<string, unknown> = { components: payload.components };
  const category = String(payload.category ?? "").trim().toUpperCase();
  if (category) body.category = category;

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(
      `[updateWabaTemplate] Meta Graph API ${res.status}: ${bodyText || res.statusText}`
    );
  }

  let json: unknown = null;
  try {
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    throw new Error(`[updateWabaTemplate] invalid JSON response: ${bodyText}`);
  }

  const r = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  if (r.success === false) {
    throw new Error(`[updateWabaTemplate] Meta returned success=false: ${bodyText}`);
  }

  return {
    success: r.success !== false,
    ...(r.id != null ? { id: String(r.id) } : {}),
    ...(r.name != null ? { name: String(r.name) } : {}),
    ...(r.category != null ? { category: String(r.category) } : {}),
    ...(r.status != null ? { status: String(r.status) } : {}),
  };
}

/**
 * Pull Meta templates for a WABA and upsert into `whatsapp_templates`.
 * Conflict key: (business_id, name, language). Does not delete missing rows.
 * Full-list sync also runs on manual dashboard refresh; single-template content
 * sync runs on Meta `message_template_status_update` when status is APPROVED.
 *
 * Intentionally omits `disabled` from the upsert payload so owner soft-disable
 * is preserved across Meta refresh (our field, independent of Meta status).
 */
export async function syncWabaTemplatesToDb(
  admin: SupabaseClient,
  businessId: number,
  wabaId: string
): Promise<number> {
  if (!Number.isFinite(businessId)) {
    throw new Error("[syncWabaTemplatesToDb] invalid businessId");
  }
  const templates = await listWabaTemplates(wabaId);
  if (templates.length === 0) return 0;

  const nowIso = new Date().toISOString();
  const rows = templates.map((t) => ({
    business_id: businessId,
    waba_template_id: t.id,
    name: t.name,
    category: t.category,
    language: t.language,
    status: t.status,
    components: t.components ?? [],
    updated_at: nowIso,
  }));

  const { error } = await admin.from("whatsapp_templates").upsert(rows, {
    onConflict: "business_id,name,language",
  });
  if (error) {
    throw new Error(`[syncWabaTemplatesToDb] upsert failed: ${error.message}`);
  }
  return rows.length;
}
