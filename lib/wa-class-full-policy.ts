/**
 * Omer's place (עומר׳ס סטודיו): fullness is invisible to the lead.
 * Registration still goes out, and no customer-facing copy says the class is full.
 * Cancelled occurrences stay blocked and are still mentioned.
 */
const IGNORE_CLASS_FULLNESS_SLUGS = new Set(["omers-place"]);

export function businessIgnoresClassFullness(slug?: string | null): boolean {
  return IGNORE_CLASS_FULLNESS_SLUGS.has(String(slug ?? "").trim().toLowerCase());
}

/** Customer-facing state. "full" becomes "open" only when this studio hides fullness. */
export function hideClassFullness<T extends string | null | undefined>(
  state: T,
  ignoreClassFullness: boolean | undefined
): T {
  if (ignoreClassFullness && state === "full") return "open" as T;
  return state;
}
