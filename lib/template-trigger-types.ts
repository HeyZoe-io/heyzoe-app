/**
 * Facade over `lib/trigger-catalog.ts` so existing API/test imports stay stable.
 * Add/change trigger metadata on the catalog, not here.
 */

export {
  ARBOX_TRIGGER_TYPES,
  NON_ARBOX_TRIGGER_TYPES,
  TRIGGER_TYPES,
  INCOMING_LEAD_TRIGGER_TYPES,
  LEGACY_INCOMING_LEAD_TRIGGER_TYPES,
  INCOMING_LEAD_TRIGGER_TYPES_RESOLVE,
  isTriggerType,
  isArboxDependentTriggerType,
  isCreatableTriggerType,
  isIncomingLeadTriggerType,
  canonicalizeTriggerType,
  forcesDelayAfter,
  allowsDelayBefore,
  delayDirectionForTrigger,
  type TriggerType,
  type IncomingLeadTriggerType,
} from "@/lib/trigger-catalog";

const TRIGGER_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** template_triggers.id is uuid — do not coerce with Number() (NaN). */
export function parseTriggerId(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!TRIGGER_UUID_RE.test(s)) return null;
  return s;
}
