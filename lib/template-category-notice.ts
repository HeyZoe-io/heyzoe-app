import type { SupabaseClient } from "@supabase/supabase-js";

/** Shown once on the automations page until a real business user dismisses it. */
export type UtilityRecategoryNotice = {
  id: string;
  name: string;
  language: string;
};

const NOTICE_COLUMNS = {
  flagged: "meta_recategorized_from",
  at: "meta_recategorized_at",
  dismissed: "category_notice_dismissed_at",
} as const;

export function isMissingRecategoryNoticeColumn(message: string): boolean {
  return /meta_recategorized_from|meta_recategorized_at|category_notice_dismissed_at|schema cache/i.test(
    message
  );
}

/**
 * Extra columns for a Meta category webhook.
 * UTILITY → MARKETING flags the row. A repeat event must not clear a dismiss
 * already saved for that same recategorization (see preserveUtilityRecategoryDismiss).
 * Any other new category closes the notice, because the template is no longer marketing.
 */
export function utilityRecategoryNoticeColumns(
  previousCategory: string,
  newCategory: string,
  nowIso: string
): Record<string, string | null> | null {
  const previous = previousCategory.trim().toUpperCase();
  const next = newCategory.trim().toUpperCase();
  if (!next) return null;
  if (previous === "UTILITY" && next === "MARKETING") {
    return {
      [NOTICE_COLUMNS.flagged]: "UTILITY",
      [NOTICE_COLUMNS.at]: nowIso,
      [NOTICE_COLUMNS.dismissed]: null,
    };
  }
  if (next !== "MARKETING") {
    return {
      [NOTICE_COLUMNS.flagged]: null,
      [NOTICE_COLUMNS.at]: null,
      [NOTICE_COLUMNS.dismissed]: null,
    };
  }
  return null;
}

/**
 * Once any template in the business was dismissed, the automations popup stays
 * closed — including templates Meta recategorizes later.
 * A repeat UTILITY→MARKETING webhook also keeps an existing dismiss on that row.
 */
export function preserveUtilityRecategoryDismiss(row: {
  meta_recategorized_from?: string | null;
  category_notice_dismissed_at?: string | null;
}): boolean {
  const from = String(row.meta_recategorized_from ?? "").trim().toUpperCase();
  return from === "UTILITY" && Boolean(String(row.category_notice_dismissed_at ?? "").trim());
}

export function visibleUtilityRecategoryNotices<
  T extends { category_notice_dismissed_at?: string | null },
>(rows: T[]): T[] {
  if (
    rows.some((row) =>
      preserveUtilityRecategoryDismiss({ ...row, meta_recategorized_from: "UTILITY" })
    )
  ) {
    return [];
  }
  return rows;
}

type CategoryMatch =
  | { wabaTemplateId: string }
  | { name: string; language: string };

export async function updateBusinessTemplateCategory(
  admin: SupabaseClient,
  match: CategoryMatch,
  category: string,
  previousCategory: string,
  nowIso: string
): Promise<number> {
  const base = { category, updated_at: nowIso };
  const notice = utilityRecategoryNoticeColumns(previousCategory, category, nowIso);
  const opening = notice?.[NOTICE_COLUMNS.flagged] === "UTILITY";
  if (!opening) {
    const rows = await writeCategory(admin, match, notice ? { ...base, ...notice } : base);
    if (rows !== "missing_columns") return rows;
    console.error(
      "[template-category-notice] notice columns missing; category updated without popup flag. Run supabase/whatsapp_templates_meta_recategory_notice.sql"
    );
    const retried = await writeCategory(admin, match, base);
    if (retried === "missing_columns") {
      throw new Error("whatsapp_templates category update failed");
    }
    return retried;
  }

  const categoryRows = await writeCategory(admin, match, base);
  if (categoryRows === "missing_columns") {
    throw new Error("whatsapp_templates category update failed");
  }
  const noticeRows = await writeCategory(admin, match, notice, { preserveDismissed: true });
  if (noticeRows === "missing_columns") {
    console.error(
      "[template-category-notice] notice columns missing; category updated without popup flag. Run supabase/whatsapp_templates_meta_recategory_notice.sql"
    );
    return categoryRows;
  }
  return Math.max(categoryRows, noticeRows);
}

async function writeCategory(
  admin: SupabaseClient,
  match: CategoryMatch,
  patch: Record<string, string | null>,
  options?: { preserveDismissed?: boolean }
): Promise<number | "missing_columns"> {
  let query = admin.from("whatsapp_templates").update(patch).select("id");
  if ("wabaTemplateId" in match) {
    query = query.eq("waba_template_id", match.wabaTemplateId);
  } else {
    query = query.eq("name", match.name).eq("language", match.language);
  }
  if (options?.preserveDismissed) {
    query = query.or(
      "category_notice_dismissed_at.is.null,meta_recategorized_from.is.null,meta_recategorized_from.neq.UTILITY"
    );
  }
  const { data, error } = await query;
  if (error) {
    if (isMissingRecategoryNoticeColumn(error.message)) return "missing_columns";
    throw new Error(error.message);
  }
  return data?.length ?? 0;
}

export async function listOpenUtilityRecategoryNotices(
  admin: SupabaseClient,
  businessId: number
): Promise<UtilityRecategoryNotice[]> {
  const { data, error } = await admin
    .from("whatsapp_templates")
    .select("id, name, language, category_notice_dismissed_at")
    .eq("business_id", businessId)
    .eq("category", "MARKETING")
    .eq("meta_recategorized_from", "UTILITY")
    .order("meta_recategorized_at", { ascending: false });

  if (error) {
    console.error("[template-category-notice] list failed:", error.message);
    return [];
  }

  const visible = visibleUtilityRecategoryNotices(
    (data ?? []) as Array<{
      id?: unknown;
      name?: unknown;
      language?: unknown;
      category_notice_dismissed_at?: string | null;
    }>
  );

  return visible
    .map((row) => {
      const id = String(row.id ?? "").trim();
      const name = String(row.name ?? "").trim();
      if (!id || !name) return null;
      return {
        id,
        name,
        language: String(row.language ?? "").trim(),
      };
    })
    .filter((row): row is UtilityRecategoryNotice => row !== null);
}

export async function dismissUtilityRecategoryNotices(
  admin: SupabaseClient,
  businessId: number,
  ids: string[]
): Promise<number> {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(0, 100);
  if (unique.length === 0) return 0;
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("whatsapp_templates")
    .update({ category_notice_dismissed_at: nowIso })
    .eq("business_id", businessId)
    .eq("meta_recategorized_from", "UTILITY")
    .in("id", unique)
    .select("id");
  if (error) {
    console.error("[template-category-notice] dismiss failed:", error.message);
    throw new Error(error.message);
  }
  return data?.length ?? 0;
}

/** After a Meta list sync, drop the popup if the template is no longer MARKETING. */
export async function clearStaleUtilityRecategoryNotices(
  admin: SupabaseClient,
  businessId: number
): Promise<void> {
  const { error } = await admin
    .from("whatsapp_templates")
    .update({
      meta_recategorized_from: null,
      meta_recategorized_at: null,
      category_notice_dismissed_at: null,
    })
    .eq("business_id", businessId)
    .eq("meta_recategorized_from", "UTILITY")
    .in("category", ["UTILITY", "AUTHENTICATION"]);
  if (error && !isMissingRecategoryNoticeColumn(error.message)) {
    console.error("[template-category-notice] clear stale failed:", error.message);
  }
}
