/**
 * Two templates on one trigger: the original name, then the same name with "1"
 * appended (registered_after_trial then registered_after_trial1).
 * A name like attendance_gap1_v2 is not the companion of attendance_gap_v2.
 *
 * The 5s gap is only between those two live WhatsApp sends to the same person.
 * One template, or two rules that are not this pair, keeps the previous send path.
 * A pair also does one indexed dedup read and one insert per template so a retry
 * does not repeat a send. That lookup is skipped when the trigger has one template.
 */
import { isArboxDailyDryRun } from "@/lib/leads/arbox-daily-run-flag";
import { logDedupBlockedSend } from "@/lib/leads/dedup-fail-closed";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export const SAME_TRIGGER_TEMPLATE_GAP_MS = 5_000;

export type CompanionDispatch =
  | "immediate"
  | "deferred"
  | "gated"
  | "skipped"
  | "send_failed"
  | "no_rule";

type NamedRule = {
  id?: string;
  template_name?: string | null;
  created_at?: string;
  updated_at?: string | null;
};

function templateNameOf(rule: NamedRule): string {
  return String(rule.template_name ?? "").trim();
}

function namedRules<T extends NamedRule>(rules: T[]): T[] {
  return rules.filter((rule) => Boolean(rule.id) && Boolean(templateNameOf(rule)));
}

/** True when `follow` is the original title plus a trailing 1. */
export function isCompanionFollowupTemplate(baseName: string, followName: string): boolean {
  const base = baseName.trim();
  const follow = followName.trim();
  return Boolean(base) && follow === `${base}1`;
}

function companionRank(name: string, names: Set<string>): { group: string; order: 0 | 1 } {
  if (names.has(`${name}1`)) return { group: name, order: 0 };
  if (name.endsWith("1")) {
    const base = name.slice(0, -1);
    if (base && names.has(base)) return { group: base, order: 1 };
  }
  return { group: name, order: 0 };
}

/**
 * Keep every rule. Pairs sort as original then the "1" title.
 * Independent rules (different day counts, tiers, products) stay in the list.
 */
export function orderAllRulesWithCompanion<T extends NamedRule>(rules: T[]): T[] {
  const named = namedRules(rules);
  const names = new Set(named.map((rule) => templateNameOf(rule)));
  return [...named].sort((a, b) => {
    const left = companionRank(templateNameOf(a), names);
    const right = companionRank(templateNameOf(b), names);
    const byGroup = left.group.localeCompare(right.group, "en");
    if (byGroup !== 0) return byGroup;
    if (left.order !== right.order) return left.order - right.order;
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  });
}

/**
 * Every named rule fires. A `name` + `name1` pair stays ordered original then follow-up.
 * Independent rules (different delays, tiers, products) stay in the list.
 */
export function rulesForCompanionSend<T extends NamedRule>(rules: T[]): T[] {
  return orderAllRulesWithCompanion(rules);
}

export function combineCompanionDispatches(results: CompanionDispatch[]): CompanionDispatch {
  if (results.length === 0) return "no_rule";
  if (results.some((dispatch) => dispatch === "send_failed")) return "send_failed";
  if (results.some((dispatch) => dispatch === "gated")) return "gated";
  if (results.every((dispatch) => dispatch === "skipped" || dispatch === "no_rule")) return "skipped";
  if (results.some((dispatch) => dispatch === "deferred")) return "deferred";
  return "immediate";
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type CompanionSendContext = { dueOffsetMs: number };

/**
 * Send one slot's templates in companion order.
 * A single rule is one send: no wait, no dedup lookup.
 * A pair waits 5s after a live send, and passes a 5s due offset so a queued
 * follow-up is ordered behind the original when the drain runs.
 * A failed or gated original stops the follow-up so a retry keeps the order.
 */
export async function runCompanionTemplateSends<T extends NamedRule>(input: {
  rules: T[];
  dryRun?: boolean;
  send: (rule: T, ctx: CompanionSendContext) => Promise<CompanionDispatch>;
  alreadyDelivered?: (rule: T) => Promise<boolean | null>;
  recordDelivered?: (rule: T) => Promise<boolean | null | void>;
  settleDelivered?: (rule: T, status: "sent" | "failed" | "release") => Promise<void>;
}): Promise<CompanionDispatch> {
  const rules = input.rules;
  if (rules.length === 0) return "no_rule";
  const gapBetweenSends = rules.length > 1;
  const results: CompanionDispatch[] = [];
  let dueOffsetMs = 0;
  let sentImmediateThisRun = false;

  for (const rule of rules) {
    if (input.alreadyDelivered) {
      const delivered = await input.alreadyDelivered(rule);
      if (delivered == null) {
        logDedupBlockedSend({
          log: "[same-trigger-template-order]",
          businessId: null,
          triggerId: rule.id ?? null,
          reason: "dedup_read_failed",
        });
        results.push("skipped");
        continue;
      }
      if (delivered) {
        results.push("immediate");
        dueOffsetMs += SAME_TRIGGER_TEMPLATE_GAP_MS;
        continue;
      }
    }

    if (input.recordDelivered) {
      const claimed = await input.recordDelivered(rule);
      if (claimed === false || claimed === null) {
        logDedupBlockedSend({
          log: "[same-trigger-template-order]",
          businessId: null,
          triggerId: rule.id ?? null,
          reason: claimed == null ? "dedup_claim_failed" : "claim_not_won",
        });
        results.push("skipped");
        continue;
      }
    }

    if (gapBetweenSends && sentImmediateThisRun && !input.dryRun) {
      await waitMs(SAME_TRIGGER_TEMPLATE_GAP_MS);
    }

    const dispatch = await input.send(rule, { dueOffsetMs });
    results.push(dispatch);
    if (input.settleDelivered && !input.dryRun) {
      const settled =
        dispatch === "immediate" ? "sent" : dispatch === "send_failed" ? "failed" : "release";
      await input.settleDelivered(rule, settled);
    }

    if (dispatch === "immediate" && !input.dryRun) {
      sentImmediateThisRun = true;
      dueOffsetMs += SAME_TRIGGER_TEMPLATE_GAP_MS;
      continue;
    }

    if (dispatch === "deferred") {
      dueOffsetMs += SAME_TRIGGER_TEMPLATE_GAP_MS;
      continue;
    }

    if (dispatch === "send_failed" || dispatch === "gated") break;
  }

  return combineCompanionDispatches(results);
}

/** Per-person gate for loops that already send every rule (own sync row each). */
export function createCompanionSendGate(dryRun = false) {
  let lastImmediateName: string | null = null;
  let blockedBase: string | null = null;
  return {
    async before(templateName: string): Promise<"send" | "skip"> {
      const name = templateName.trim();
      if (blockedBase && isCompanionFollowupTemplate(blockedBase, name)) return "skip";
      if (!dryRun && lastImmediateName && isCompanionFollowupTemplate(lastImmediateName, name)) {
        await waitMs(SAME_TRIGGER_TEMPLATE_GAP_MS);
      }
      return "send";
    },
    after(templateName: string, dispatch: string) {
      const name = templateName.trim();
      if (dispatch === "immediate") lastImmediateName = name;
      if (dispatch === "send_failed" || dispatch === "gated") blockedBase = name;
    },
  };
}

export async function companionTemplateAlreadySent(
  admin: AdminClient,
  dedupKey: string,
  ctx?: { businessId?: number; triggerId?: string }
): Promise<boolean | null> {
  const key = dedupKey.trim();
  if (!key) return false;
  const { data, error } = await admin
    .from("scheduled_template_sends")
    .select("status")
    .eq("dedup_key", key)
    .maybeSingle();
  if (error) {
    logDedupBlockedSend({
      log: "[same-trigger-template-order]",
      businessId: ctx?.businessId ?? null,
      triggerId: ctx?.triggerId ?? null,
      reason: error.message,
    });
    return null;
  }
  return String((data as { status?: unknown } | null)?.status ?? "") === "sent";
}

export async function recordCompanionTemplateSent(
  admin: AdminClient,
  input: {
    dedupKey: string;
    businessId: number;
    ruleId: string;
    phone: string;
    templateName: string;
    nowIso: string;
  }
): Promise<boolean | null> {
  if (isArboxDailyDryRun()) return true;
  const dedupKey = input.dedupKey.trim();
  if (!dedupKey) return null;
  const { error } = await admin.from("scheduled_template_sends").insert({
    business_id: input.businessId,
    trigger_id: input.ruleId,
    contact_phone: input.phone,
    template_name: input.templateName,
    due_at: input.nowIso,
    status: "canceled",
    dedup_key: dedupKey,
    last_error: "claim_held",
    updated_at: input.nowIso,
  });
  if (!error) return true;
  if (error.code === "23505" || /duplicate/i.test(error.message)) return false;
  logDedupBlockedSend({
    log: "[same-trigger-template-order]",
    businessId: input.businessId,
    triggerId: input.ruleId,
    reason: error.message,
  });
  return null;
}

export async function settleCompanionTemplateSent(
  admin: AdminClient,
  dedupKey: string,
  status: "sent" | "failed" | "release"
): Promise<void> {
  const key = dedupKey.trim();
  if (!key) return;
  if (status === "release") {
    const { error } = await admin
      .from("scheduled_template_sends")
      .delete()
      .eq("dedup_key", key)
      .eq("last_error", "claim_held");
    if (error) {
      logDedupBlockedSend({
        log: "[same-trigger-template-order]",
        businessId: null,
        reason: error.message,
      });
    }
    return;
  }
  const { error } = await admin
    .from("scheduled_template_sends")
    .update({
      status,
      last_error: status === "failed" ? "send_failed" : null,
      updated_at: new Date().toISOString(),
    })
    .eq("dedup_key", key)
    .eq("last_error", "claim_held");
  if (error) {
    logDedupBlockedSend({
      log: "[same-trigger-template-order]",
      businessId: null,
      reason: error.message,
    });
  }
}
