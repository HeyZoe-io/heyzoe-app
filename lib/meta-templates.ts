/**
 * Meta Graph API helpers for WhatsApp message templates (list / create).
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
 * Pull Meta templates for a WABA and upsert into `whatsapp_templates`.
 * Conflict key: (business_id, name, language). Does not delete missing rows.
 * This is the only writer that syncs from a Meta list (no cron/polling).
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
