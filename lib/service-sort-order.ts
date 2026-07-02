/** מפתח sort_order מעמודת DB או מ־JSON ב־description (גיבוי). */

function parseServiceDescriptionMeta(raw: unknown): Record<string, unknown> {
  const text = String(raw ?? "").trim();
  if (!text) return {};
  const candidate = text.startsWith("__META__:") ? text.slice("__META__:".length).trim() : text;
  if (!candidate.startsWith("{")) return {};
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function readServiceSortOrder(row: {
  sort_order?: unknown;
  id?: unknown;
  description?: unknown;
}): number {
  const col = row.sort_order;
  if (col !== null && col !== undefined && String(col).trim() !== "") {
    const n = Number(col);
    if (Number.isFinite(n)) return n;
  }
  const fromMeta = Number(parseServiceDescriptionMeta(row.description).sort_order);
  if (Number.isFinite(fromMeta)) return fromMeta;
  const id = Number(row.id ?? 0);
  return Number.isFinite(id) ? id : 0;
}

export function compareServiceRowsBySortOrder(
  a: { sort_order?: unknown; id?: unknown; description?: unknown },
  b: { sort_order?: unknown; id?: unknown; description?: unknown }
): number {
  const diff = readServiceSortOrder(a) - readServiceSortOrder(b);
  if (diff !== 0) return diff;
  return Number(a.id ?? 0) - Number(b.id ?? 0);
}

export function sortServiceRowsBySortOrder<T extends { sort_order?: unknown; id?: unknown; description?: unknown }>(
  rows: T[]
): T[] {
  return [...rows].sort(compareServiceRowsBySortOrder);
}
