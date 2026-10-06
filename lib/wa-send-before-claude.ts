import { AsyncLocalStorage } from "node:async_hooks";
import {
  isWholeMessageSalesFlowStart,
  type SalesFlowStartTriggerOpts,
} from "@/lib/sales-flow-start-triggers";
import { setPreClaudeOutboundGuard } from "@/lib/wa-pre-claude-guard";

/**
 * The only reasons a WhatsApp turn may send or call Arbox before the main Claude call.
 * Anything else is a hint on that same call.
 */
export const SEND_BEFORE_CLAUDE_REASONS = [
  "interactive_reply",
  "opt_out",
  "explicit_timetable_request",
  "configured_opening_trigger",
  "warmup_guard",
  "test_environment_guard",
] as const;

export type SendBeforeClaudeReason = (typeof SEND_BEFORE_CLAUDE_REASONS)[number];

type Zone = { active: boolean; gate: SendBeforeClaudeReason | null };

const zone = new AsyncLocalStorage<Zone>();

export class PreClaudeSendBlocked extends Error {
  readonly action: string;
  constructor(action: string) {
    super(`pre-Claude ${action} blocked`);
    this.name = "PreClaudeSendBlocked";
    this.action = action;
  }
}

/** Current request only. Concurrent webhooks do not share the gate. */
export function enterPreClaudeZone(): void {
  zone.enterWith({ active: true, gate: null });
}

export function exitPreClaudeZone(): void {
  zone.enterWith({ active: false, gate: null });
}

export function preClaudeZoneActive(): boolean {
  return zone.getStore()?.active === true;
}

export function preClaudeGateReason(): SendBeforeClaudeReason | null {
  const store = zone.getStore();
  if (!store?.active) return null;
  return store.gate;
}

/**
 * Opens the gate for one allow-listed reason, runs fn, then restores the previous gate.
 * This is the only permitted way to send or call Arbox before Claude.
 */
export async function sendBeforeClaude<T>(
  reason: SendBeforeClaudeReason,
  fn: () => Promise<T> | T
): Promise<T> {
  if (!SEND_BEFORE_CLAUDE_REASONS.includes(reason)) {
    throw new Error(`unknown sendBeforeClaude reason: ${String(reason)}`);
  }
  const store = zone.getStore();
  if (!store?.active) return await fn();
  const prev = store.gate;
  store.gate = reason;
  try {
    return await fn();
  } finally {
    store.gate = prev;
  }
}

/**
 * Same gate as sendBeforeClaude, for the legacy block that must stay in the caller
 * so its locals remain in scope. Call only with an allow-listed reason.
 * Returns a release function.
 */
export function allowPreClaudeSends(reason: SendBeforeClaudeReason): () => void {
  if (!SEND_BEFORE_CLAUDE_REASONS.includes(reason)) {
    throw new Error(`unknown sendBeforeClaude reason: ${String(reason)}`);
  }
  const store = zone.getStore();
  if (!store?.active) return () => {};
  const prev = store.gate;
  store.gate = reason;
  return () => {
    store.gate = prev;
  };
}

function guardPreClaudeOutboundImpl(action: string): void {
  const store = zone.getStore();
  if (!store?.active) return;
  if (store.gate) return;
  console.error("[pre-claude] blocked outbound before Claude", action);
  throw new PreClaudeSendBlocked(action);
}

setPreClaudeOutboundGuard(guardPreClaudeOutboundImpl);

export { guardPreClaudeOutbound } from "@/lib/wa-pre-claude-guard";

const TIMETABLE_WHOLE = new Set([
  "מערכת שעות",
  "מערכת השעות",
  "שלחי לי את מערכת השעות",
  "שלח לי את מערכת השעות",
  "תשלחי לי את מערכת השעות",
  "תשלח לי את מערכת השעות",
  "אפשר את הלוח",
  "אפשר את מערכת השעות",
  "אפשר מערכת שעות",
  "לוח שיעורים",
  "לוח הזמנים",
  "לוח זמנים",
  "צפייה במערכת",
]);

const LEADING_GREETING =
  /^(?:היי|הי+|שלום|אהלן|hello|hi|hey)\s+/iu;

/** Trim punctuation, emoji, and one leading greeting. A word inside a sentence never matches. */
export function normalizeWholeOutboundMessage(raw: string): string {
  let text = String(raw ?? "")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, " ")
    .replace(/[!.,?;:~'"`()\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  text = text.replace(LEADING_GREETING, "").trim();
  return text;
}

export function isWholeMessageTimetableRequest(raw: string): boolean {
  const text = normalizeWholeOutboundMessage(raw);
  if (!text || text.length > 80) return false;
  if (TIMETABLE_WHOLE.has(text)) return true;
  const stripped = text.replace(/^(?:בבקשה|אפשר)\s+/u, "").replace(/\s+בבקשה$/u, "").trim();
  return stripped !== text && TIMETABLE_WHOLE.has(stripped);
}

export function isWholeMessageOpeningTrigger(
  raw: string,
  opts?: SalesFlowStartTriggerOpts
): boolean {
  return isWholeMessageSalesFlowStart(raw, opts);
}

export function wholeMessageMatchesLabel(raw: string, labels: readonly string[]): boolean {
  const text = normalizeWholeOutboundMessage(raw);
  if (!text) return false;
  return labels.some((label) => normalizeWholeOutboundMessage(label) === text);
}

export function resolveSendBeforeClaudeReason(input: {
  text: string;
  interactiveId?: string | null;
  interactiveKind?: string | null;
  openingTrigger: boolean;
  matchesMenuLabel: boolean;
  warmupOption: boolean;
}): SendBeforeClaudeReason | null {
  const kind = String(input.interactiveKind ?? "").trim();
  if (String(input.interactiveId ?? "").trim() || kind === "button_reply" || kind === "list_reply") {
    return "interactive_reply";
  }
  if (input.warmupOption) return "warmup_guard";
  if (input.matchesMenuLabel) return "interactive_reply";
  if (isWholeMessageTimetableRequest(input.text)) return "explicit_timetable_request";
  if (input.openingTrigger) return "configured_opening_trigger";
  return null;
}
