import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildHaikuRequest, readHaikuText } from "@/lib/ai-models";
import { getBusinessKnowledgePack } from "@/lib/business-context";
import { parseKnowledgeQa, serializeKnowledgeQa } from "@/lib/knowledge-qa";
import {
  KNOWLEDGE_UPDATE_LLM_BUDGET_USD,
  KNOWLEDGE_UPDATE_LOOKBACK_DAYS,
  KNOWLEDGE_UPDATE_SESSION_MS,
  KNOWLEDGE_UPDATE_TEMPLATE,
  KNOWLEDGE_UPDATE_TEMPLATE_BODY,
  KNOWLEDGE_UPDATES_RECIPIENT_MODE,
  deliverTargets,
  inboundAction,
  isoWeekKey,
  knowledgeUpdateDue,
  labelKnowledgePairs,
  maskPii,
  normalizeKnowledgeText,
  appendKnowledgeQa,
  pairHandoffWithOwnerReply,
  selectWeeklySuggestions,
  sendDecision,
  sessionActive,
  shouldWriteKnowledge,
  suggestionCardText,
  summaryText,
  type ClassifiedPair,
  type KnowledgePairLabel,
  type KnowledgeReviewReason,
  type KnowledgeUpdateSendDecision,
} from "@/lib/knowledge-updates";
import { isHumanOutboundModel } from "@/lib/leads/no-response-audience";
import { logMarketingWhatsAppMessage, MARKETING_WA_PHONE_NUMBER_ID } from "@/lib/marketing-whatsapp";
import { listWabaTemplates } from "@/lib/meta-templates";
import { resolveMarketingWabaId } from "@/lib/marketing-waba";
import { HUMAN_REQUESTED_EVENT_MODELS } from "@/lib/notifications/daily-summary-data";
import { postWhatsAppGraphMessage } from "@/lib/notifications/graph-whatsapp-send";
import { ADMIN_SUPPORT_ALERT_WHATSAPP } from "@/lib/notifications/sendAdminWhatsAppTemplate";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { waSessionIdParts } from "@/lib/phone-normalize";
import { resolveWaReplyAddressingMode } from "@/lib/wa-assistant-reply-fixes";
import {
  formatWhatsAppRtlBody,
  resolveMetaAccessToken,
  sendMetaWhatsAppMessage,
  type MetaWhatsAppOutgoing,
} from "@/lib/whatsapp";

type Admin = SupabaseClient;
type Spend = { usd: number; inputTokens: number; outputTokens: number };

export type KnowledgePairReview = {
  businessName: string;
  question: string;
  answer: string;
  outcome: "passed" | "dropped";
  reason: KnowledgeReviewReason;
  knowledgeText: string;
};

export type BuiltSuggestion = {
  businessId: number;
  businessName: string;
  slug: string;
  clusterKey: string;
  question: string;
  knowledgeText: string;
  leadCount: number;
  ownerAnswers: string[];
};

type SuggestionRow = {
  id: string;
  business_id: number;
  question: string;
  knowledge_text: string;
  status: string;
  lead_count: number;
};

type SessionRow = {
  id: string;
  recipient: string;
  iso_week: string;
  opened_at: string | null;
  expires_at: string | null;
  suggestion_ids: string[];
  current_index: number;
  awaiting_correction: boolean;
  summary_sent: boolean;
};

const HAIKU_IN_USD = 0.1 / 1_000_000;
const HAIKU_OUT_USD = 0.5 / 1_000_000;
const PAIR_CAP = 30;

export function isMissingKnowledgeUpdateTable(error: { message?: string; code?: string } | null): boolean {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /knowledge_update_|PGRST205|42P01|schema cache/i.test(text);
}

function digits(phone: string): string {
  return String(phone ?? "").replace(/\D/g, "");
}

export function senderIsKnowledgeRecipient(phone: string): boolean {
  const to = digits(phone);
  if (KNOWLEDGE_UPDATES_RECIPIENT_MODE === "admin") {
    return to === digits(ADMIN_SUPPORT_ALERT_WHATSAPP);
  }
  return to.length >= 11;
}

function addSpend(spend: Spend, usage: { input_tokens?: number; output_tokens?: number } | null | undefined): void {
  const input = Number(usage?.input_tokens ?? 0);
  const output = Number(usage?.output_tokens ?? 0);
  if (input > 0) spend.inputTokens += input;
  if (output > 0) spend.outputTokens += output;
  spend.usd += input * HAIKU_IN_USD + output * HAIKU_OUT_USD;
}

function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.search(/[[{]/);
  if (start < 0) return null;
  try {
    return JSON.parse(trimmed.slice(start));
  } catch {
    return null;
  }
}

export function knowledgeUpdateCardOutgoing(text: string): MetaWhatsAppOutgoing {
  const body = formatWhatsAppRtlBody([...text.trim()].slice(0, 1023).join(""));
  return {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body || "\u200e" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "kw_add", title: "להוסיף" } },
          { type: "reply", reply: { id: "kw_skip", title: "לדלג" } },
          { type: "reply", reply: { id: "kw_fix", title: "לתקן" } },
        ],
      },
    },
  };
}

export async function sendKnowledgeUpdateTemplate(to: string): Promise<void> {
  const token = resolveMetaAccessToken();
  if (!token) throw new Error("missing_meta_token");
  const phone = digits(to);
  const res = await postWhatsAppGraphMessage({
    phoneNumberId: MARKETING_WA_PHONE_NUMBER_ID,
    to: phone,
    token,
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "template",
      template: {
        name: KNOWLEDGE_UPDATE_TEMPLATE,
        language: { code: "he" },
      },
    },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[knowledge-updates] template send failed", res.status);
    throw new Error(errText.slice(0, 300) || `http_${res.status}`);
  }
  await logMarketingWhatsAppMessage({
    leadPhone: phone,
    role: "assistant",
    content: KNOWLEDGE_UPDATE_TEMPLATE_BODY,
    model_used: "knowledge_update_template",
  });
}

export async function sendKnowledgeUpdateCard(to: string, text: string): Promise<void> {
  const phone = digits(to);
  await sendMetaWhatsAppMessage(MARKETING_WA_PHONE_NUMBER_ID, phone, knowledgeUpdateCardOutgoing(text));
  await logMarketingWhatsAppMessage({
    leadPhone: phone,
    role: "assistant",
    content: text,
    model_used: "knowledge_update_card",
  });
}

export async function sendKnowledgeUpdateText(to: string, text: string): Promise<void> {
  const phone = digits(to);
  await sendMetaWhatsAppMessage(MARKETING_WA_PHONE_NUMBER_ID, phone, { type: "text", text });
  await logMarketingWhatsAppMessage({
    leadPhone: phone,
    role: "assistant",
    content: text,
    model_used: "knowledge_update_card",
  });
}

async function classifyPairs(
  apiKey: string,
  pairs: Array<{ question: string; answer: string }>,
  spend: Spend,
  budgetUsd: number
): Promise<Array<{ general: boolean; oneOff: boolean; cluster: string }>> {
  const dropped = pairs.map(() => ({ general: false, oneOff: true, cluster: "" }));
  if (!pairs.length || spend.usd >= budgetUsd) return dropped;
  const lines = pairs
    .map((pair, index) => `${index + 1}. שאלה: ${maskPii(pair.question)}\nתשובה: ${maskPii(pair.answer)}`)
    .join("\n");
  const anthropic = new Anthropic({ apiKey });
  const params = buildHaikuRequest("knowledge-update-classify");
  const resp = await anthropic.messages.create({
    ...params,
    messages: [
      {
        role: "user",
        content: `לכל זוג, החלט אם השאלה כללית (מתאימה גם ללידים אחרים) או אישית (חשבון, תור, תשלום, הקפאה, תאריך של אדם אחד), ואם התשובה כוללת שם, פרט פרטי, או טובה חד-פעמית (הנחה "בשבילך").
cluster הוא נושא קצר בעברית. זוגות על אותו נושא חייבים אותו cluster.
החזר רק JSON array:
[{"i":1,"general":true,"one_off":false,"cluster":"חניה"}]

${lines}`,
      },
    ],
  });
  addSpend(spend, resp.usage);
  const read = readHaikuText("knowledge-update-classify", resp);
  if (read.truncated) return dropped;
  const parsed = parseModelJson(read.text);
  if (!Array.isArray(parsed)) return dropped;
  const out = dropped.slice();
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const item = row as { i?: unknown; general?: unknown; one_off?: unknown; cluster?: unknown };
    const index = Number(item.i) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= out.length) continue;
    out[index] = {
      general: item.general === true,
      oneOff: item.one_off === true,
      cluster: String(item.cluster ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
    };
  }
  return out;
}

async function generalizeAnswer(input: {
  apiKey: string;
  question: string;
  answers: string[];
  knowledge: string;
  feminine: boolean;
  spend: Spend;
  budgetUsd: number;
}): Promise<string | null> {
  if (input.spend.usd >= input.budgetUsd) return null;
  const voice = input.feminine
    ? "אפשר לפנות בלשון נקבה."
    : "נסח בלשון ניטרלית, בלי אתה או את.";
  const anthropic = new Anthropic({ apiKey: input.apiKey });
  const params = buildHaikuRequest("knowledge-update-generalize");
  const resp = await anthropic.messages.create({
    ...params,
    messages: [
      {
        role: "user",
        content: `נסח פריט ידע אחד, קצר, בעברית, מתוך תשובת בעל העסק. אל תוסיף עובדות שלא נאמרו. בלי שמות. השתמש במקף - ולא במקף ארוך.
${voice}
אם הידע הקיים כבר מכסה את זה, החזר רק COVERED.
אם התשובות לא עונות על השאלה, החזר רק SKIP.
אחרת החזר רק את משפט הידע, כתשובה ישירה לשאלה.

שאלה: ${maskPii(input.question)}
תשובות הבעלים: ${maskPii(input.answers.join("\n"))}
ידע קיים: ${maskPii(input.knowledge).slice(0, 4000)}`,
      },
    ],
  });
  addSpend(input.spend, resp.usage);
  const read = readHaikuText("knowledge-update-generalize", resp);
  if (read.truncated) return null;
  const text = normalizeKnowledgeText(read.text);
  const upper = text.replace(/[.!?]+$/g, "").trim().toUpperCase();
  if (!text || upper === "COVERED" || upper === "SKIP") return null;
  return text.slice(0, 400);
}

async function collectPairs(admin: Admin, slug: string, sinceIso: string): Promise<Array<{ leadKey: string; question: string; answer: string }>> {
  const { data: events, error } = await admin
    .from("messages")
    .select("session_id, created_at")
    .eq("business_slug", slug)
    .eq("role", "event")
    .in("model_used", [...HUMAN_REQUESTED_EVENT_MODELS])
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);
  const sessionIds = [...new Set((events ?? []).map((row) => String((row as { session_id?: string }).session_id ?? "")).filter(Boolean))];
  if (!sessionIds.length) return [];

  const messageSince = new Date(Date.parse(sinceIso) - 24 * 60 * 60 * 1000).toISOString();
  const messages: Array<{ session_id: string; role: string; content: string; model_used: string; created_at: string }> = [];
  for (let i = 0; i < sessionIds.length; i += 30) {
    const chunk = sessionIds.slice(i, i + 30);
    const { data, error: msgErr } = await admin
      .from("messages")
      .select("session_id, role, content, model_used, created_at")
      .in("session_id", chunk)
      .gte("created_at", messageSince)
      .order("created_at", { ascending: true })
      .limit(5000);
    if (msgErr) throw new Error(msgErr.message);
    for (const row of data ?? []) {
      messages.push({
        session_id: String((row as { session_id?: string }).session_id ?? ""),
        role: String((row as { role?: string }).role ?? ""),
        content: String((row as { content?: string }).content ?? ""),
        model_used: String((row as { model_used?: string }).model_used ?? ""),
        created_at: String((row as { created_at?: string }).created_at ?? ""),
      });
    }
  }

  const leadBySession = new Map<string, string>();
  for (const sessionId of sessionIds) {
    const phone = digits(waSessionIdParts(sessionId)?.phone ?? "");
    leadBySession.set(sessionId, phone || sessionId);
  }

  const bySession = new Map<string, typeof messages>();
  for (const message of messages) {
    const list = bySession.get(message.session_id) ?? [];
    list.push(message);
    bySession.set(message.session_id, list);
  }

  const pairs: Array<{ leadKey: string; question: string; answer: string }> = [];
  for (const event of events ?? []) {
    const sessionId = String((event as { session_id?: string }).session_id ?? "");
    const eventAt = Date.parse(String((event as { created_at?: string }).created_at ?? ""));
    if (!sessionId || !Number.isFinite(eventAt)) continue;
    const timeline = bySession.get(sessionId) ?? [];
    let question = "";
    const replies: Array<{ at: number; text: string }> = [];
    for (const message of timeline) {
      const at = Date.parse(message.created_at);
      if (!Number.isFinite(at) || at > eventAt + 72 * 60 * 60 * 1000) continue;
      if (message.role === "user" && at <= eventAt) question = message.content.trim();
      if (message.role === "assistant" && isHumanOutboundModel(message.model_used) && at >= eventAt) {
        replies.push({ at, text: message.content });
      }
    }
    const answer = pairHandoffWithOwnerReply({ eventAt, replies });
    if (!question || question.length < 8 || !answer || answer.length < 8) continue;
    if (question.startsWith("[heyzoe:")) continue;
    pairs.push({
      leadKey: leadBySession.get(sessionId) || sessionId,
      question: maskPii(question).slice(0, 500),
      answer: maskPii(answer).slice(0, 800),
    });
  }
  return pairs.slice(-PAIR_CAP);
}

export async function buildKnowledgeUpdates(input: {
  admin: Admin;
  now?: Date;
  persist: boolean;
  review?: boolean;
  budgetUsd?: number;
}): Promise<{
  week: string;
  suggestions: BuiltSuggestion[];
  reviews: KnowledgePairReview[];
  spendUsd: number;
  scanned: number;
  pairs: number;
}> {
  const now = input.now ?? new Date();
  const budgetUsd = input.budgetUsd ?? KNOWLEDGE_UPDATE_LLM_BUDGET_USD;
  const week = isoWeekKey(now);
  const since = new Date(now.getTime() - KNOWLEDGE_UPDATE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  const spend: Spend = { usd: 0, inputTokens: 0, outputTokens: 0 };
  const { data: businesses, error } = await input.admin
    .from("businesses")
    .select("id, slug, name")
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  if (input.persist) {
    const expired = await input.admin
      .from("knowledge_update_suggestions")
      .update({ status: "expired" })
      .in("status", ["pending", "sent"])
      .neq("iso_week", week);
    if (expired.error && !isMissingKnowledgeUpdateTable(expired.error)) {
      console.error("[knowledge-updates] expire failed", expired.error.message);
    }
  }

  const suggestions: BuiltSuggestion[] = [];
  const reviews: KnowledgePairReview[] = [];
  let pairs = 0;
  for (const business of businesses ?? []) {
    const businessId = Number((business as { id?: number }).id);
    const slug = String((business as { slug?: string }).slug ?? "").trim();
    const businessName = String((business as { name?: string }).name ?? slug).trim() || slug;
    if (!businessId || !slug) continue;
    if (spend.usd >= budgetUsd) break;
    let rawPairs: Array<{ leadKey: string; question: string; answer: string }> = [];
    try {
      rawPairs = await collectPairs(input.admin, slug, since);
    } catch {
      console.error("[knowledge-updates] pair collect failed", slug);
      continue;
    }
    pairs += rawPairs.length;
    if (!rawPairs.length || !apiKey) continue;
    try {
    const pack = await getBusinessKnowledgePack(slug);
    const knowledge = [
      ...(pack?.knowledgeQa ?? []).flatMap((pair) => [pair.question, pair.answer]),
      ...(pack?.traits ?? []),
    ].join("\n");
    const feminine = resolveWaReplyAddressingMode(pack) === "feminine";
    const classified: ClassifiedPair[] = [];
    for (let i = 0; i < rawPairs.length; i += 8) {
      const chunk = rawPairs.slice(i, i + 8);
      const labels = await classifyPairs(apiKey, chunk, spend, budgetUsd);
      chunk.forEach((pair, index) => {
        const label = labels[index] ?? { general: false, oneOff: true, cluster: "" };
        classified.push({ ...pair, ...label });
      });
    }
    const selected = selectWeeklySuggestions(classified, knowledge);
    const pairLabels: KnowledgePairLabel[] = input.review ? labelKnowledgePairs(classified, knowledge) : [];
    const knowledgeByCluster = new Map<string, string>();
    for (const cluster of selected) {
      if (spend.usd >= budgetUsd) break;
      const knowledgeText = await generalizeAnswer({
        apiKey,
        question: cluster.question,
        answers: cluster.ownerAnswers,
        knowledge,
        feminine,
        spend,
        budgetUsd,
      });
      if (!knowledgeText) continue;
      knowledgeByCluster.set(cluster.clusterKey, knowledgeText);
      suggestions.push({
        businessId,
        businessName,
        slug,
        clusterKey: cluster.clusterKey,
        question: cluster.question,
        knowledgeText,
        leadCount: cluster.leadCount,
        ownerAnswers: cluster.ownerAnswers.slice(0, 5),
      });
    }
    if (input.review) {
      classified.forEach((pair, index) => {
        const label = pairLabels[index] ?? { reason: "other" as const, clusterKey: "" };
        const knowledgeText = label.reason === "passed" ? (knowledgeByCluster.get(label.clusterKey) ?? "") : "";
        const passed = label.reason === "passed" && Boolean(knowledgeText);
        reviews.push({
          businessName,
          question: pair.question,
          answer: pair.answer,
          outcome: passed ? "passed" : "dropped",
          reason: passed ? "passed" : label.reason === "passed" ? "other" : label.reason,
          knowledgeText: passed ? knowledgeText : "",
        });
      });
    }
    } catch {
      console.error("[knowledge-updates] classify failed", slug);
      if (input.review) {
        for (const pair of rawPairs) {
          reviews.push({
            businessName,
            question: pair.question,
            answer: pair.answer,
            outcome: "dropped",
            reason: "other",
            knowledgeText: "",
          });
        }
      }
    }
  }

  if (input.persist && suggestions.length) {
    const { error: upsertErr } = await input.admin.from("knowledge_update_suggestions").upsert(
      suggestions.map((row) => ({
        business_id: row.businessId,
        iso_week: week,
        cluster_key: row.clusterKey,
        question: row.question,
        owner_answers: row.ownerAnswers,
        knowledge_text: row.knowledgeText,
        lead_count: row.leadCount,
        status: "pending",
      })),
      { onConflict: "business_id,iso_week,cluster_key", ignoreDuplicates: true }
    );
    if (upsertErr) {
      if (isMissingKnowledgeUpdateTable(upsertErr)) {
        console.error("[knowledge-updates] table missing, nothing stored");
      } else {
        throw new Error(upsertErr.message);
      }
    }
  }

  console.info("[knowledge-updates] built", {
    week,
    suggestions: suggestions.length,
    spendUsd: Number(spend.usd.toFixed(4)),
    persist: input.persist,
  });
  return { week, suggestions, reviews, spendUsd: spend.usd, scanned: (businesses ?? []).length, pairs };
}

async function templateIsApproved(): Promise<boolean> {
  try {
    const wabaId = await resolveMarketingWabaId();
    if (!wabaId) return false;
    const templates = await listWabaTemplates(wabaId);
    return templates.some(
      (row) => row.name === KNOWLEDGE_UPDATE_TEMPLATE && row.language === "he" && row.status === "APPROVED"
    );
  } catch (error) {
    console.error("[knowledge-updates] template lookup failed", error instanceof Error ? error.message : error);
    return false;
  }
}

async function loadOwnerPhones(admin: Admin): Promise<string[]> {
  const { data, error } = await admin
    .from("businesses")
    .select("owner_whatsapp_phone, owner_whatsapp_opted_in")
    .eq("is_active", true)
    .eq("owner_whatsapp_opted_in", true);
  if (error) return [];
  return (data ?? [])
    .map((row) => String((row as { owner_whatsapp_phone?: string }).owner_whatsapp_phone ?? ""))
    .filter(Boolean);
}

export async function deliverWeeklyKnowledgeUpdate(input: {
  decision: KnowledgeUpdateSendDecision;
  adminPhone: string;
  ownerPhones: string[];
  send: (to: string) => Promise<void>;
}): Promise<string[]> {
  const targets = deliverTargets(input);
  for (const phone of targets) {
    await input.send(phone);
  }
  return targets;
}

export async function runWeeklyKnowledgeUpdates(input: {
  admin: Admin;
  now?: Date;
  dryRun?: boolean;
}): Promise<{ reason: string; count: number }> {
  const now = input.now ?? new Date();
  if (input.dryRun) return { reason: "dry_run", count: 0 };
  if (!knowledgeUpdateDue(now)) return { reason: "not_due", count: 0 };
  const week = isoWeekKey(now);
  const { data: claim, error: claimErr } = await input.admin
    .from("knowledge_update_sends")
    .select("iso_week")
    .eq("iso_week", week)
    .maybeSingle();
  if (claimErr) {
    if (isMissingKnowledgeUpdateTable(claimErr)) {
      console.error("[knowledge-updates] table missing, skipped");
      return { reason: "missing_table", count: 0 };
    }
    throw new Error(claimErr.message);
  }
  if (claim) return { reason: "already", count: 0 };

  const { count, error: countErr } = await input.admin
    .from("knowledge_update_suggestions")
    .select("id", { count: "exact", head: true })
    .eq("iso_week", week)
    .eq("status", "pending");
  if (countErr) {
    if (isMissingKnowledgeUpdateTable(countErr)) return { reason: "missing_table", count: 0 };
    throw new Error(countErr.message);
  }
  let pending = count ?? 0;
  if (!pending) {
    const built = await buildKnowledgeUpdates({ admin: input.admin, now, persist: true });
    pending = built.suggestions.length;
  }
  const decision = sendDecision({
    due: true,
    alreadySent: false,
    count: pending,
    templateApproved: pending > 0 ? await templateIsApproved() : false,
    mode: KNOWLEDGE_UPDATES_RECIPIENT_MODE,
  });
  if (decision === "empty") {
    const { error } = await input.admin.from("knowledge_update_sends").insert({
      iso_week: week,
      suggestion_count: 0,
      recipient_mode: KNOWLEDGE_UPDATES_RECIPIENT_MODE,
      template_status: "empty",
    });
    if (error && !isMissingKnowledgeUpdateTable(error)) console.error("[knowledge-updates] empty claim failed", error.message);
    return { reason: "empty", count: 0 };
  }
  if (decision !== "send_admin" && decision !== "send_owners") {
    return { reason: decision, count: pending };
  }
  const ownerPhones = decision === "send_owners" ? await loadOwnerPhones(input.admin) : [];
  const { error: insertErr } = await input.admin.from("knowledge_update_sends").insert({
    iso_week: week,
    suggestion_count: pending,
    recipient_mode: KNOWLEDGE_UPDATES_RECIPIENT_MODE,
    template_status: "APPROVED",
  });
  if (insertErr) {
    if (isMissingKnowledgeUpdateTable(insertErr)) return { reason: "missing_table", count: pending };
    return { reason: "already", count: pending };
  }
  try {
    await deliverWeeklyKnowledgeUpdate({
      decision,
      adminPhone: ADMIN_SUPPORT_ALERT_WHATSAPP,
      ownerPhones,
      send: sendKnowledgeUpdateTemplate,
    });
  } catch (error) {
    await input.admin.from("knowledge_update_sends").delete().eq("iso_week", week);
    throw error;
  }
  return { reason: decision, count: pending };
}

async function businessIdsForOwner(admin: Admin, recipient: string): Promise<number[]> {
  const { data, error } = await admin
    .from("businesses")
    .select("id, owner_whatsapp_phone")
    .eq("is_active", true)
    .eq("owner_whatsapp_opted_in", true);
  if (error) return [];
  const want = digits(recipient);
  return (data ?? [])
    .filter((row) => digits(String((row as { owner_whatsapp_phone?: string }).owner_whatsapp_phone ?? "")) === want)
    .map((row) => Number((row as { id?: number }).id))
    .filter((id) => id > 0);
}

async function loadSession(admin: Admin, recipient: string, week: string): Promise<SessionRow | null> {
  const { data, error } = await admin
    .from("knowledge_update_sessions")
    .select("id, recipient, iso_week, opened_at, expires_at, suggestion_ids, current_index, awaiting_correction, summary_sent")
    .eq("recipient", recipient)
    .eq("iso_week", week)
    .maybeSingle();
  if (error) {
    if (isMissingKnowledgeUpdateTable(error)) return null;
    throw new Error(error.message);
  }
  if (!data) return null;
  const row = data as SessionRow;
  return { ...row, suggestion_ids: Array.isArray(row.suggestion_ids) ? row.suggestion_ids : [] };
}

async function businessName(admin: Admin, businessId: number): Promise<string> {
  const { data } = await admin.from("businesses").select("name").eq("id", businessId).maybeSingle();
  return String((data as { name?: string } | null)?.name ?? "").trim() || "העסק";
}

async function sendCardFor(admin: Admin, recipient: string, row: SuggestionRow): Promise<void> {
  const name = await businessName(admin, row.business_id);
  await sendKnowledgeUpdateCard(
    recipient,
    suggestionCardText({ businessName: name, question: row.question, knowledgeText: row.knowledge_text })
  );
}

async function writeBusinessKnowledge(admin: Admin, businessId: number, question: string, answer: string): Promise<boolean> {
  const { data, error } = await admin.from("businesses").select("social_links").eq("id", businessId).maybeSingle();
  if (error || !data) {
    console.error("[knowledge-updates] knowledge read failed", error?.message ?? "missing");
    return false;
  }
  const social =
    data.social_links && typeof data.social_links === "object" && !Array.isArray(data.social_links)
      ? { ...(data.social_links as Record<string, unknown>) }
      : {};
  const next = appendKnowledgeQa(parseKnowledgeQa(social.knowledge_qa), { question, answer });
  if (!next.added) return true;
  social.knowledge_qa = serializeKnowledgeQa(next.pairs);
  const saved = await admin.from("businesses").update({ social_links: social }).eq("id", businessId);
  if (saved.error) {
    console.error("[knowledge-updates] knowledge write failed", saved.error.message);
    return false;
  }
  return true;
}

async function finishSummary(admin: Admin, session: SessionRow): Promise<void> {
  const { data } = await admin
    .from("knowledge_update_suggestions")
    .select("status")
    .in("id", session.suggestion_ids);
  const counts = { added: 0, skipped: 0, corrected: 0 };
  for (const row of data ?? []) {
    const status = String((row as { status?: string }).status ?? "");
    if (status === "added") counts.added += 1;
    if (status === "skipped") counts.skipped += 1;
    if (status === "corrected") counts.corrected += 1;
  }
  await sendKnowledgeUpdateText(session.recipient, summaryText(counts));
  await admin.from("knowledge_update_sessions").update({ summary_sent: true, awaiting_correction: false }).eq("id", session.id);
}

async function openKnowledgeSession(admin: Admin, recipient: string, now: Date): Promise<void> {
  const week = isoWeekKey(now);
  const existing = await loadSession(admin, recipient, week);
  if (existing && sessionActive(existing.expires_at, now) && !existing.summary_sent) {
    const currentId = existing.suggestion_ids[existing.current_index];
    if (!currentId) {
      await finishSummary(admin, existing);
      return;
    }
    const { data } = await admin
      .from("knowledge_update_suggestions")
      .select("id, business_id, question, knowledge_text, status, lead_count")
      .eq("id", currentId)
      .maybeSingle();
    if (data) await sendCardFor(admin, recipient, data as SuggestionRow);
    return;
  }
  if (existing?.suggestion_ids.length) {
    await admin
      .from("knowledge_update_suggestions")
      .update({ status: "pending" })
      .in("id", existing.suggestion_ids)
      .eq("status", "sent");
  }
  let query = admin
    .from("knowledge_update_suggestions")
    .select("id, business_id, question, knowledge_text, status, lead_count")
    .eq("iso_week", week)
    .eq("status", "pending")
    .order("lead_count", { ascending: false })
    .limit(100);
  if (KNOWLEDGE_UPDATES_RECIPIENT_MODE === "owners") {
    const ids = await businessIdsForOwner(admin, recipient);
    if (!ids.length) {
      await sendKnowledgeUpdateText(recipient, "אין כרגע הצעות פתוחות.");
      return;
    }
    query = query.in("business_id", ids);
  }
  const { data, error } = await query;
  if (error) {
    if (isMissingKnowledgeUpdateTable(error)) return;
    throw new Error(error.message);
  }
  const rows = (data ?? []) as SuggestionRow[];
  if (!rows.length) {
    await sendKnowledgeUpdateText(recipient, "אין כרגע הצעות פתוחות.");
    return;
  }
  const ids = rows.map((row) => row.id);
  await admin.from("knowledge_update_suggestions").update({ status: "sent" }).in("id", ids).eq("status", "pending");
  const expires = new Date(now.getTime() + KNOWLEDGE_UPDATE_SESSION_MS).toISOString();
  const { error: sessionErr } = await admin.from("knowledge_update_sessions").upsert(
    {
      recipient,
      iso_week: week,
      opened_at: now.toISOString(),
      expires_at: expires,
      suggestion_ids: ids,
      current_index: 0,
      awaiting_correction: false,
      summary_sent: false,
    },
    { onConflict: "recipient,iso_week" }
  );
  if (sessionErr) throw new Error(sessionErr.message);
  await sendCardFor(admin, recipient, rows[0]!);
}

async function advanceSession(admin: Admin, session: SessionRow): Promise<void> {
  const nextIndex = session.current_index + 1;
  await admin
    .from("knowledge_update_sessions")
    .update({ current_index: nextIndex, awaiting_correction: false })
    .eq("id", session.id);
  const nextId = session.suggestion_ids[nextIndex];
  if (!nextId) {
    await finishSummary(admin, { ...session, current_index: nextIndex, awaiting_correction: false });
    return;
  }
  const { data } = await admin
    .from("knowledge_update_suggestions")
    .select("id, business_id, question, knowledge_text, status, lead_count")
    .eq("id", nextId)
    .maybeSingle();
  if (!data) {
    await finishSummary(admin, session);
    return;
  }
  await sendCardFor(admin, session.recipient, data as SuggestionRow);
}

export async function tryHandleKnowledgeUpdateInbound(input: {
  from: string;
  text: string;
  interactiveId?: string | null;
  kind?: string | null;
  now?: Date;
}): Promise<boolean> {
  if (!senderIsKnowledgeRecipient(input.from)) return false;
  const now = input.now ?? new Date();
  const recipient = digits(input.from);
  const week = isoWeekKey(now);
  let admin: Admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return false;
  }
  let session: SessionRow | null = null;
  try {
    session = await loadSession(admin, recipient, week);
  } catch (error) {
    console.error("[knowledge-updates] session read failed", error instanceof Error ? error.message : error);
    return false;
  }
  const active = session ? sessionActive(session.expires_at, now) : false;
  const action = inboundAction({
    text: input.text,
    interactiveId: input.interactiveId,
    kind: input.kind,
    senderIsPilot: true,
    session: session
      ? { active, awaitingCorrection: session.awaiting_correction, summarySent: session.summary_sent }
      : null,
  });
  if (!action.handled) return false;
  try {
    if (action.action === "open") {
      await openKnowledgeSession(admin, recipient, now);
      return true;
    }
    if (!session || action.action === "ignore" || action.action === "none") return true;
    const currentId = session.suggestion_ids[session.current_index];
    if (!currentId) {
      await finishSummary(admin, session);
      return true;
    }
    const { data } = await admin
      .from("knowledge_update_suggestions")
      .select("id, business_id, question, knowledge_text, status, lead_count")
      .eq("id", currentId)
      .maybeSingle();
    const row = data as SuggestionRow | null;
    if (!row) return true;
    if (action.action === "fix") {
      await admin.from("knowledge_update_sessions").update({ awaiting_correction: true }).eq("id", session.id);
      await sendKnowledgeUpdateText(recipient, "מה הנוסח הנכון לידע? ההודעה הבאה תחליף את הנוסח ותתווסף.");
      return true;
    }
    if (action.action === "correct") {
      const answer = normalizeKnowledgeText(input.text).slice(0, 400);
      if (!answer || !shouldWriteKnowledge("correct", row.status)) return true;
      const wrote = await writeBusinessKnowledge(admin, row.business_id, row.question, answer);
      if (!wrote) {
        await sendKnowledgeUpdateText(recipient, "לא הצלחתי לשמור את הידע. אפשר לנסות שוב.");
        return true;
      }
      const saved = await admin
        .from("knowledge_update_suggestions")
        .update({
          status: "corrected",
          knowledge_text: answer,
          decided_at: now.toISOString(),
          decided_via: "whatsapp",
        })
        .eq("id", row.id)
        .eq("status", "sent")
        .select("id");
      if (!saved.data?.length) return true;
      await advanceSession(admin, session);
      return true;
    }
    if (action.action === "skip") {
      const saved = await admin
        .from("knowledge_update_suggestions")
        .update({ status: "skipped", decided_at: now.toISOString(), decided_via: "whatsapp" })
        .eq("id", row.id)
        .eq("status", "sent")
        .select("id");
      if (!saved.data?.length) return true;
      await advanceSession(admin, session);
      return true;
    }
    if (action.action === "add") {
      if (!shouldWriteKnowledge("add", row.status)) return true;
      const wrote = await writeBusinessKnowledge(admin, row.business_id, row.question, row.knowledge_text);
      if (!wrote) {
        await sendKnowledgeUpdateText(recipient, "לא הצלחתי לשמור את הידע. אפשר לנסות שוב.");
        return true;
      }
      const saved = await admin
        .from("knowledge_update_suggestions")
        .update({ status: "added", decided_at: now.toISOString(), decided_via: "whatsapp" })
        .eq("id", row.id)
        .eq("status", "sent")
        .select("id");
      if (!saved.data?.length) return true;
      await advanceSession(admin, session);
    }
  } catch (error) {
    console.error("[knowledge-updates] inbound failed", error instanceof Error ? error.message : error);
  }
  return true;
}

export async function listWeeklyKnowledgeForBusiness(
  admin: Admin,
  businessId: number
): Promise<Array<{ id: string; question: string; knowledgeText: string; createdAt: string }>> {
  const { data, error } = await admin
    .from("knowledge_update_suggestions")
    .select("id, question, knowledge_text, created_at")
    .eq("business_id", businessId)
    .in("status", ["pending", "sent"])
    .order("lead_count", { ascending: false })
    .limit(10);
  if (error) {
    if (!isMissingKnowledgeUpdateTable(error)) {
      console.error("[knowledge-updates] dashboard list failed", error.message);
    }
    return [];
  }
  return (data ?? []).map((row) => ({
    id: String((row as { id?: string }).id ?? ""),
    question: String((row as { question?: string }).question ?? ""),
    knowledgeText: String((row as { knowledge_text?: string }).knowledge_text ?? ""),
    createdAt: String((row as { created_at?: string }).created_at ?? ""),
  }));
}
