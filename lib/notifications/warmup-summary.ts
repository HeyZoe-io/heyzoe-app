import {
  fetchLastSalesFlowGreetingResetAt,
  fetchLastSfServiceEventName,
} from "@/lib/analytics";
import { getBusinessKnowledgePack } from "@/lib/business-context";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveWarmupMenuPickLabel } from "@/lib/wa-menu-choice";
import { WA_WARMUP_EXPERIENCE_SENT_MODEL } from "@/lib/wa-warmup-pending";
import {
  buildWarmupExtraCleanStepsFromWb,
  isWarmupExperienceQuestion1Configured,
  matchesTrialRegisteredMessage,
  resolveWarmupExperienceConfig,
} from "@/lib/sales-flow";

const WARMUP_SUMMARY_MAX_CHARS = 900;
const USER_MESSAGES_LIMIT = 24;

const WARMUP_ASSISTANT_SENT_MODELS = [
  WA_WARMUP_EXPERIENCE_SENT_MODEL,
  "sales_flow_warmup_extra",
  "flow_continuation_warmup_extra",
  "sales_flow_warmup_extra_resend",
] as const;

export type WarmupSummaryStep = { question: string; options: string[] };

export function formatWarmupSummaryBlock(stepIndex: number, question: string, answer: string): string {
  const q = String(question ?? "").trim();
  const a = String(answer ?? "").trim();
  if (!q || !a) return "";
  return `שאלה ${stepIndex} מתוך סשן חימום (${q})\n\n${a}`;
}

export function formatWarmupSummaryFromSteps(
  steps: Array<{ question: string; answer: string }>
): string {
  const blocks: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const block = formatWarmupSummaryBlock(i + 1, steps[i]!.question, steps[i]!.answer);
    if (block) blocks.push(block);
  }
  const joined = blocks.join("\n\n").trim();
  return joined.length > WARMUP_SUMMARY_MAX_CHARS
    ? joined.slice(0, WARMUP_SUMMARY_MAX_CHARS - 1) + "…"
    : joined;
}

function fillServiceNameInWarmupQuestion(template: string, serviceName: string): string {
  return String(template ?? "").replace(/\{serviceName\}/g, serviceName.trim());
}

export function buildWarmupSummaryStepsFromPack(input: {
  warmupSessionEnabled: boolean;
  salesFlowConfig: NonNullable<Awaited<ReturnType<typeof getBusinessKnowledgePack>>>["salesFlowConfig"];
  serviceName: string;
}): WarmupSummaryStep[] {
  if (!input.warmupSessionEnabled || !input.salesFlowConfig) return [];
  const wb = resolveWarmupExperienceConfig(input.salesFlowConfig);
  const { cleanSteps, hasWarmupQ1 } = buildWarmupExtraCleanStepsFromWb(wb);
  const steps: WarmupSummaryStep[] = [];
  if (hasWarmupQ1 && isWarmupExperienceQuestion1Configured(wb)) {
    steps.push({
      question: fillServiceNameInWarmupQuestion(wb.question, input.serviceName),
      options: wb.options.map((o) => String(o ?? "").trim()).filter(Boolean),
    });
  }
  for (const st of cleanSteps) {
    steps.push({
      question: st.question,
      options: st.options,
    });
  }
  return steps.filter((s) => s.question && s.options.length >= 2);
}

async function fetchUserTextsAfterSalesFlowReset(input: {
  business_slug: string;
  session_id: string;
}): Promise<string[]> {
  const slug = input.business_slug.trim().toLowerCase();
  const sessionId = input.session_id.trim();
  if (!slug || !sessionId) return [];

  const resetAt = await fetchLastSalesFlowGreetingResetAt({
    business_slug: slug,
    session_id: sessionId,
  });

  const admin = createSupabaseAdminClient();
  let q = admin
    .from("messages")
    .select("content, created_at")
    .eq("business_slug", slug)
    .eq("session_id", sessionId)
    .eq("role", "user")
    .order("created_at", { ascending: true })
    .limit(USER_MESSAGES_LIMIT);
  if (resetAt) {
    q = q.gt("created_at", resetAt);
  }
  const { data, error } = await q;
  if (error) {
    console.warn("[warmup-summary] user messages query failed:", error.message);
    return [];
  }

  const out: string[] = [];
  for (const row of data ?? []) {
    const c = String(row.content ?? "").trim();
    if (!c || c.startsWith("[media]")) continue;
    if (matchesTrialRegisteredMessage(c)) continue;
    out.push(c);
  }
  return out;
}

async function wasWarmupMenuSentInSession(input: {
  business_slug: string;
  session_id: string;
}): Promise<boolean> {
  const slug = input.business_slug.trim().toLowerCase();
  const sessionId = input.session_id.trim();
  if (!slug || !sessionId) return false;

  const resetAt = await fetchLastSalesFlowGreetingResetAt({
    business_slug: slug,
    session_id: sessionId,
  });

  const admin = createSupabaseAdminClient();
  let q = admin
    .from("messages")
    .select("id")
    .eq("business_slug", slug)
    .eq("session_id", sessionId)
    .eq("role", "assistant")
    .in("model_used", [...WARMUP_ASSISTANT_SENT_MODELS])
    .limit(1);
  if (resetAt) {
    q = q.gt("created_at", resetAt);
  }
  const { data, error } = await q.maybeSingle();
  if (error) {
    console.warn("[warmup-summary] warmup sent check failed:", error.message);
    return false;
  }
  return Boolean(data?.id);
}

function matchWarmupAnswersFromUserTexts(
  steps: WarmupSummaryStep[],
  userTexts: string[]
): Array<{ question: string; answer: string }> {
  const matched: Array<{ question: string; answer: string }> = [];
  let userIdx = 0;

  for (const step of steps) {
    let answer = "";
    while (userIdx < userTexts.length && !answer) {
      const candidate = userTexts[userIdx]!;
      userIdx += 1;
      answer = resolveWarmupMenuPickLabel(candidate, step.options);
    }
    if (answer) {
      matched.push({ question: step.question, answer });
    }
  }
  return matched;
}

/** שחזור סיכום חימום מהדשבורד + הודעות user (fallback). */
export async function buildWarmupSummaryFromSession(input: {
  businessSlug: string;
  sessionId: string;
}): Promise<string> {
  const slug = String(input.businessSlug ?? "").trim().toLowerCase();
  const sessionId = String(input.sessionId ?? "").trim();
  if (!slug || !sessionId) return "";

  const pack = await getBusinessKnowledgePack(slug);
  if (!pack || pack.warmupSessionEnabled === false || !pack.salesFlowConfig) return "";

  const serviceName =
    (await fetchLastSfServiceEventName({ business_slug: slug, session_id: sessionId }))?.trim() ?? "";

  const steps = buildWarmupSummaryStepsFromPack({
    warmupSessionEnabled: true,
    salesFlowConfig: pack.salesFlowConfig,
    serviceName,
  });
  if (!steps.length) return "";

  const warmupSent = await wasWarmupMenuSentInSession({ business_slug: slug, session_id: sessionId });
  if (!warmupSent) return "";

  const userTexts = await fetchUserTextsAfterSalesFlowReset({ business_slug: slug, session_id: sessionId });
  const matched = matchWarmupAnswersFromUserTexts(steps, userTexts);
  return formatWarmupSummaryFromSteps(matched);
}

/** לשימוש בהתראות: precomputed מה-webhook, אחרת fallback. */
export async function resolveWarmupSummaryForLeadRegistered(input: {
  businessSlug: string;
  sessionId: string;
  warmupSummaryPrecomputed?: string | null;
}): Promise<string> {
  const pre = String(input.warmupSummaryPrecomputed ?? "").trim();
  if (pre) {
    return pre.length > WARMUP_SUMMARY_MAX_CHARS
      ? pre.slice(0, WARMUP_SUMMARY_MAX_CHARS - 1) + "…"
      : pre;
  }
  try {
    const built = await buildWarmupSummaryFromSession({
      businessSlug: input.businessSlug,
      sessionId: input.sessionId,
    });
    return String(built ?? "").trim() || "—";
  } catch (e) {
    console.warn("[warmup-summary] resolve failed:", e);
    return "—";
  }
}
