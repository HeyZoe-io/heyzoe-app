/**
 * Product saves upsert by slug. Deletes happen only for slugs the user removed
 * in this session. A product missing from the payload stays.
 */

export const BULK_PRODUCT_DELETE_ERROR = "bulk_product_delete_confirm";

const ARBOX_STAMP_KEYS = [
  "arbox_box_category_id",
  "arbox_class_name",
  "schedule_slots",
  "schedule_removed_notice",
] as const;

export type ProductMergeRow = {
  ui_id: string;
  name: string;
  service_slug: string;
  price_text: string;
  payment_link: string;
  description: string;
  offer_kind?: string;
  schedule_slots?: unknown;
};

export function productEditFingerprint(row: ProductMergeRow): string {
  return JSON.stringify({
    name: row.name.trim(),
    slug: row.service_slug.trim(),
    price: row.price_text.trim(),
    pay: row.payment_link.trim(),
    desc: row.description.trim(),
    kind: row.offer_kind ?? "",
    slots: row.schedule_slots ?? [],
  });
}

export function explicitProductDeleteDecision(input: {
  existingSlugs: readonly string[];
  requestedDeletes: readonly unknown[];
  confirm: boolean;
}):
  | { ok: true; slugs: string[] }
  | {
      ok: false;
      error: typeof BULK_PRODUCT_DELETE_ERROR;
      deleteCount: number;
      productCount: number;
    } {
  const existing = new Set(
    input.existingSlugs.map((slug) => String(slug ?? "").trim()).filter(Boolean)
  );
  const slugs: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.requestedDeletes) {
    const slug = String(raw ?? "").trim();
    if (!slug || seen.has(slug) || !existing.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }
  const productCount = existing.size;
  const deleteCount = slugs.length;
  const needsConfirm =
    deleteCount > 2 || (productCount > 0 && deleteCount / productCount > 0.3);
  if (needsConfirm && !input.confirm) {
    return {
      ok: false,
      error: BULK_PRODUCT_DELETE_ERROR,
      deleteCount,
      productCount,
    };
  }
  return { ok: true, slugs };
}

export function isBulkProductDeleteResponse(status: number, json: unknown): boolean {
  if (status !== 400) return false;
  const error =
    json && typeof json === "object" ? String((json as { error?: unknown }).error ?? "") : "";
  return error === BULK_PRODUCT_DELETE_ERROR;
}

/**
 * Server rows are the base. Unsaved local edits overlay the matching product.
 * A product that exists only in the form stays until it is saved or removed.
 * Slugs the user deleted in this session stay out.
 */
export function mergeProductsAfterConflict<T extends ProductMergeRow>(input: {
  server: readonly T[];
  local: readonly T[];
  baselineByKey: ReadonlyMap<string, string>;
  keyOf: (row: T) => string;
  deletedSlugs: ReadonlySet<string>;
  fingerprint?: (row: T) => string;
}): T[] {
  const fingerprint = input.fingerprint ?? ((row: T) => productEditFingerprint(row));
  const localByKey = new Map<string, T>();
  for (const row of input.local) {
    if (input.deletedSlugs.has(row.service_slug.trim())) continue;
    localByKey.set(input.keyOf(row), row);
  }
  const merged: T[] = [];
  const seen = new Set<string>();
  for (const serverRow of input.server) {
    const slug = serverRow.service_slug.trim();
    if (slug && input.deletedSlugs.has(slug)) continue;
    const key = input.keyOf(serverRow);
    if (seen.has(key)) continue;
    seen.add(key);
    const local = localByKey.get(key);
    if (!local) {
      merged.push(serverRow);
      continue;
    }
    const baseline = input.baselineByKey.get(key);
    const localChanged = baseline === undefined || fingerprint(local) !== baseline;
    merged.push(localChanged ? { ...serverRow, ...local, ui_id: local.ui_id } : { ...serverRow, ui_id: local.ui_id });
  }
  for (const local of input.local) {
    const slug = local.service_slug.trim();
    if (slug && input.deletedSlugs.has(slug)) continue;
    if (!local.name.trim()) continue;
    const key = input.keyOf(local);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(local);
  }
  return merged;
}

/** Keep cron-written Arbox fields when the settings form rewrites description JSON. */
export function preserveArboxDescriptionKeys(
  meta: Record<string, unknown>,
  stamp: {
    arbox_box_category_id?: unknown;
    arbox_class_name?: unknown;
    schedule_slots?: unknown;
    schedule_removed_notice?: unknown;
    prior?: Record<string, unknown> | null;
  }
): Record<string, unknown> {
  const prior = stamp.prior && typeof stamp.prior === "object" ? stamp.prior : {};
  const next: Record<string, unknown> = { ...meta };
  const category = stamp.arbox_box_category_id ?? prior.arbox_box_category_id ?? null;
  const className = stamp.arbox_class_name ?? prior.arbox_class_name ?? "";
  const notice =
    stamp.schedule_removed_notice !== undefined
      ? stamp.schedule_removed_notice
      : (prior.schedule_removed_notice ?? null);
  const slots = Array.isArray(stamp.schedule_slots)
    ? stamp.schedule_slots
    : Array.isArray(prior.schedule_slots)
      ? prior.schedule_slots
      : next.schedule_slots;
  const hadStamp =
    (category != null && String(category).trim() !== "" && String(category) !== "null") ||
    String(className ?? "").trim() !== "" ||
    notice != null ||
    prior.arbox_box_category_id != null ||
    String(prior.arbox_class_name ?? "").trim() !== "" ||
    prior.schedule_removed_notice != null ||
    Array.isArray(prior.schedule_slots);
  if (!hadStamp) return next;
  next.arbox_box_category_id = category;
  next.arbox_class_name = className;
  next.schedule_removed_notice = notice;
  if (Array.isArray(slots)) next.schedule_slots = slots;
  if (prior.arbox_class_description != null && next.arbox_class_description == null) {
    next.arbox_class_description = prior.arbox_class_description;
  }
  for (const key of ARBOX_STAMP_KEYS) {
    if (next[key] === undefined && prior[key] !== undefined) next[key] = prior[key];
  }
  return next;
}
