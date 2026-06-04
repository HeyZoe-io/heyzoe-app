import { resolveMetaInteractiveLabel } from "@/lib/whatsapp";
import { truncateWaButtonLabel } from "@/lib/wa-button-label";

export function waNormLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function waLabelMatches(a: string, b: string): boolean {
  return waNormLabel(a) === waNormLabel(b);
}

export function resolveWaMenuChoice(
  raw: string,
  metaInteractiveReplyId: string | undefined,
  candidates: string[],
  numericScope?: string[]
): string {
  const trimmed = raw.trim();
  if (/^[1-9]$/.test(trimmed) && numericScope && numericScope.length) {
    const idx = Number(trimmed);
    if (idx >= 1 && idx <= numericScope.length) return numericScope[idx - 1]!;
  }
  const base = metaInteractiveReplyId?.trim()
    ? resolveMetaInteractiveLabel(metaInteractiveReplyId, raw, candidates)
    : raw.trim();
  let label = base.trim();
  const n = waNormLabel(label);
  const asNum = Number(n);
  if (Number.isFinite(asNum) && asNum >= 1 && asNum <= candidates.length) {
    label = candidates[asNum - 1] ?? label;
  }
  return label;
}

/** מיפוי תשובת כפתור/רשימה ל־index — כולל התאמה אחרי חיתוך תוויות לוואטסאפ (23 תווים). */
export function findWaMenuOptionIndex(
  raw: string,
  metaInteractiveReplyId: string | undefined,
  candidates: string[]
): number {
  if (!candidates.length) return -1;
  const incomingResolved = resolveWaMenuChoice(raw, metaInteractiveReplyId, candidates);
  let idx = candidates.findIndex((o) => waLabelMatches(incomingResolved, o));
  if (idx >= 0) return idx;
  idx = candidates.findIndex((o) => waLabelMatches(incomingResolved, truncateWaButtonLabel(o)));
  if (idx >= 0) return idx;
  const truncatedIncoming = truncateWaButtonLabel(incomingResolved);
  if (truncatedIncoming) {
    idx = candidates.findIndex((o) => waLabelMatches(truncatedIncoming, truncateWaButtonLabel(o)));
  }
  return idx;
}

export function resolveWarmupMenuPickLabel(raw: string, options: string[]): string {
  const idx = findWaMenuOptionIndex(raw, undefined, options);
  return idx >= 0 ? String(options[idx] ?? "").trim() : "";
}
