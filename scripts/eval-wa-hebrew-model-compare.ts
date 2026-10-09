/**
 * Eval only. Compares WhatsApp free-text models on Hebrew quality and context.
 * Does not send WhatsApp, does not write database rows, does not change production.
 *
 *   npx tsx --env-file=.env.local scripts/eval-wa-hebrew-model-compare.ts <stage>
 *
 * Stages: classify | mine | flag | select | rebuild | run | judge | review | report
 *
 * Prompt builder: getBusinessKnowledgePack + buildSystemPrompt + loadZoePlatformGuidelines.
 * Those functions only SELECT. getBusinessKnowledgePack reads crm_api_key into memory
 * to set hasArboxConnection and does not put the key in the pack or on disk.
 * This script never calls logMessage, send helpers, insert, update, or delete.
 *
 * Lead text, outputs, and review.html go to gitignored eval-output/.
 * Phones and emails are masked before anything is written.
 */
import { mkdirSync, readFileSync, appendFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { CLAUDE_WHATSAPP_MAX_TOKENS, CLAUDE_WHATSAPP_MODEL, isAnthropicCreditExhausted, resolveClaudeApiKey } from "@/lib/claude";
import { buildSystemPrompt, getBusinessKnowledgePack, type BusinessKnowledgePack } from "@/lib/business-context";
import { loadZoePlatformGuidelines, type ZoePlatformGuidelines } from "@/lib/business-zoe-platform";
import { inferLeadAgeBandFromUserTexts } from "@/lib/wa-lead-audience";
import { buildIsraelNowSchedulePromptBlock } from "@/lib/wa-relative-day-class-slots";
import { formatFastPathHintLine } from "@/lib/wa-fast-path-hint";
import { assistantModelOrFilter, extractReplyRoute, parseModelUsed } from "@/lib/wa-reply-route";
import { resolveWaReplyAddressingMode, type WaReplyAddressingMode } from "@/lib/wa-assistant-reply-fixes";
import { isWaReactionLogContent } from "@/lib/wa-inbound-reaction";
import { scheduleBoardHistoryNote } from "@/lib/wa-studio-schedule-cta";
import { contactPhoneLookupVariants, waSessionIdParts } from "@/lib/phone-normalize";
import { joinInboundUserTexts } from "@/lib/wa-inbound-coalesce";

const OUT = path.join(process.cwd(), "eval-output");
const BUDGET_USD = 20;
const SINCE_MS = 30 * 24 * 60 * 60 * 1000;
const GENERATION_MODELS = [CLAUDE_WHATSAPP_MODEL, "gemini-2.5-flash"] as const;

type MsgRow = {
  id: string | number;
  created_at: string;
  business_slug: string;
  session_id: string | null;
  role: string;
  model_used: string | null;
  content: string | null;
};

type Usage = {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
};

type Flags = {
  non_word: string[];
  out_of_context_word: string[];
  garbled_phrase: string[];
  grammar_error: string[];
  ungrounded_gender: boolean;
  ignored_latest_message: boolean;
  claims_about_owner: boolean;
  should_handoff: boolean;
  sales_pitch_to_member: boolean;
  answered_latest_message?: boolean;
  invented_facts?: string[];
  length_ok?: boolean;
};

type Mined = {
  messageId: string;
  businessSlug: string;
  businessId: number | null;
  createdAt: string;
  modelUsed: string;
  route: string | null;
  arboxIsMember: boolean | null;
  firstName: string;
  addressing: WaReplyAddressingMode;
  replyPreview: string;
  lastUserPreview: string;
  turns: { role: "user" | "assistant"; content: string }[];
  flags?: Flags;
  flagScore?: number;
  flaggerError?: string;
};

type ModelConfig = {
  id: string;
  model: string;
  maxTokens: number;
  effort?: "low" | "medium";
  thinking?: "between_tools";
  note: string;
};

const CONFIGS: ModelConfig[] = [
  {
    id: "haiku-4-5",
    model: "claude-haiku-4-5",
    maxTokens: CLAUDE_WHATSAPP_MAX_TOKENS,
    note: "Production shape: no temperature, no effort, no thinking. max_tokens 768.",
  },
  {
    id: "haiku-5-5-low",
    model: "claude-haiku-5-5",
    maxTokens: 4096,
    effort: "low",
    note: "Adaptive thinking is on and counts toward max_tokens, so the cap is 4096 rather than 768. Temperature omitted.",
  },
  {
    id: "haiku-5-5-medium",
    model: "claude-haiku-5-5",
    maxTokens: 4096,
    effort: "medium",
    note: "Default effort. Same max_tokens headroom as the low config so thinking does not cut the reply.",
  },
  {
    id: "sonnet-5-5-low",
    model: "claude-sonnet-5-5",
    maxTokens: 1024,
    effort: "low",
    thinking: "between_tools",
    note: "Lowest effort level is low. between_tools is the lowest thinking setting and is allowed at low. No up-front thinking, so 1024 is enough for a short reply.",
  },
  {
    id: "sonnet-4-6",
    model: "claude-sonnet-4-6",
    maxTokens: CLAUDE_WHATSAPP_MAX_TOKENS,
    note: "Same params as production Haiku 4.5 (temperature omitted; the model would accept temperature). Docs: thinking is off when the thinking field is absent, so 768 is not eaten by thinking. Omitting effort uses the API default high.",
  },
];

type Price = {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  inputOver?: number;
  outputOver?: number;
  cacheWriteOver?: number;
  cacheReadOver?: number;
};

/** USD per million tokens. Verified 2026-10-09 against platform.claude.com pricing and model overviews. */
const PRICES: Record<string, Price> = {
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheWrite: 0.125,
    cacheRead: 0.01,
    inputOver: 0.5,
    outputOver: 2.5,
    cacheWriteOver: 0.625,
    cacheReadOver: 0.05,
  },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
};

class CreditAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditAbort";
  }
}

class SpendAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpendAbort";
  }
}

function ensureOut(): void {
  mkdirSync(OUT, { recursive: true });
}

function maskPii(text: string): string {
  return String(text ?? "")
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?<!\d)(?:\+972|972)[-\s]?5\d{8}(?!\d)/g, "[phone]")
    .replace(/(?<!\d)05\d{8}(?!\d)/g, "[phone]")
    .replace(/(?<!\d)0[2-489]\d{7}(?!\d)/g, "[phone]");
}

function maskValue(value: unknown): unknown {
  if (typeof value === "string") return maskPii(value);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.map((item) => maskValue(item));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    const rawKeys = new Set([
      "messageId",
      "createdAt",
      "modelUsed",
      "businessSlug",
      "path",
      "route",
      "hint",
      "callType",
      "model",
      "caseId",
      "configId",
      "id",
      "source",
      "kind",
      "stopReason",
      "personalRouteCommit",
      "label",
      "needle",
    ]);
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === "session_id" || key === "sessionId" || key === "phone" || key === "email") continue;
      out[key] = rawKeys.has(key) && typeof item === "string" ? item : maskValue(item);
    }
    return out;
  }
  return String(value);
}

function writeJson(name: string, value: unknown): void {
  ensureOut();
  writeFileSync(path.join(OUT, name), JSON.stringify(maskValue(value), null, 2));
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(OUT, name), "utf8")) as T;
}

function hasFile(name: string): boolean {
  return existsSync(path.join(OUT, name));
}

function appendJsonl(name: string, value: unknown): void {
  ensureOut();
  appendFileSync(path.join(OUT, name), `${JSON.stringify(maskValue(value))}\n`);
}

function readJsonl<T>(name: string): T[] {
  if (!hasFile(name)) return [];
  return readFileSync(path.join(OUT, name), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function firstName(raw: string | null | undefined): string {
  const token = String(raw ?? "")
    .replace(/[0-9+@].*$/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)[0];
  return token ? maskPii(token) : "";
}

function readOnlyAdmin(): SupabaseClient {
  const admin = createSupabaseAdminClient();
  return new Proxy(admin, {
    get(target, prop, receiver) {
      if (prop === "rpc" || prop === "auth" || prop === "storage") {
        throw new Error("eval is select-only");
      }
      if (prop === "from") {
        return (table: string) => guardQuery(target.from(table));
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as SupabaseClient;
}

function guardQuery<T extends object>(builder: T): T {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (prop === "insert" || prop === "update" || prop === "upsert" || prop === "delete") {
        return () => {
          throw new Error("eval is select-only");
        };
      }
      if (prop === "then") {
        const thenFn = Reflect.get(target, prop, receiver);
        return typeof thenFn === "function" ? thenFn.bind(target) : thenFn;
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result = value.apply(target, args);
        if (result && typeof result === "object" && typeof (result as { then?: unknown }).then !== "function") {
          return guardQuery(result as object);
        }
        return result;
      };
    },
  }) as T;
}

function asRows(data: unknown): MsgRow[] {
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is MsgRow => Boolean(row) && typeof row === "object");
}

function phoneFromSession(sessionId: string): string {
  const parts = waSessionIdParts(sessionId);
  if (parts?.phone) return parts.phone.replace(/^\+/, "");
  const tail = sessionId.slice(sessionId.lastIndexOf("_") + 1).replace(/^\+/, "");
  if (/^\d{9,15}$/.test(tail)) return tail;
  return "";
}

function sessionShape(sessionId: string | null): { len: number; wa: boolean; underscores: number; tailDigits: number } {
  const value = String(sessionId ?? "");
  const tail = value.slice(value.lastIndexOf("_") + 1).replace(/^\+/, "");
  return {
    len: value.length,
    wa: value.startsWith("wa_"),
    underscores: value ? value.split("_").length - 1 : 0,
    tailDigits: /^\d+$/.test(tail) ? tail.length : 0,
  };
}

function classifyPath(modelUsed: string | null, generationNearby: boolean): string {
  const parsed = parseModelUsed(modelUsed);
  const base = parsed.model;
  if (!base) return "other:empty";
  if (base === "claude-haiku-4-5" || base === "gemini-2.5-flash") {
    if (parsed.route || generationNearby) return "llm_generation";
    return "llm_generation_unconfirmed";
  }
  if (base.startsWith("closed_playbook") || base.startsWith("wa_closed") || base.includes("playbook")) {
    return "closed_playbook";
  }
  if (base === "static" || base === "greeting" || base === "predefined_choice_guard") return "static_or_menu";
  if (base === "lead_template") return "trigger";
  if (base.startsWith("sales_flow") || base.startsWith("flow_") || base.startsWith("sf_")) return "flow_step";
  if (base === "wa_business_app" || base === "manual_handoff") return "human";
  if (base.includes("faq")) return "faq";
  if (base === "wa_route_handoff" || base.includes("handoff")) return "handoff_playbook";
  if (base.includes("fast")) return "fast_path";
  return `other:${base}`;
}

function emptyFlags(): Flags {
  return {
    non_word: [],
    out_of_context_word: [],
    garbled_phrase: [],
    grammar_error: [],
    ungrounded_gender: false,
    ignored_latest_message: false,
    claims_about_owner: false,
    should_handoff: false,
    sales_pitch_to_member: false,
  };
}

function coerceFlags(raw: unknown): Flags {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = (key: string): string[] =>
    Array.isArray(src[key]) ? src[key].map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 8) : [];
  const flag = (key: string): boolean => src[key] === true;
  const flags: Flags = {
    non_word: list("non_word"),
    out_of_context_word: list("out_of_context_word"),
    garbled_phrase: list("garbled_phrase"),
    grammar_error: list("grammar_error"),
    ungrounded_gender: flag("ungrounded_gender"),
    ignored_latest_message: flag("ignored_latest_message"),
    claims_about_owner: flag("claims_about_owner"),
    should_handoff: flag("should_handoff"),
    sales_pitch_to_member: flag("sales_pitch_to_member"),
  };
  if ("answered_latest_message" in src) flags.answered_latest_message = src.answered_latest_message === true;
  if ("length_ok" in src) flags.length_ok = src.length_ok === true;
  if ("invented_facts" in src) flags.invented_facts = list("invented_facts");
  return flags;
}

function flagScore(flags: Flags): number {
  return (
    flags.non_word.length * 5 +
    flags.out_of_context_word.length * 4 +
    flags.garbled_phrase.length * 3 +
    flags.grammar_error.length * 3 +
    (flags.claims_about_owner ? 5 : 0) +
    (flags.ignored_latest_message ? 4 : 0) +
    (flags.should_handoff ? 4 : 0) +
    (flags.sales_pitch_to_member ? 3 : 0) +
    (flags.ungrounded_gender ? 2 : 0)
  );
}

function isFlagged(flags: Flags): boolean {
  return flagScore(flags) > 0;
}

function hebrewError(flags: Flags): boolean {
  return (
    flags.non_word.length > 0 ||
    flags.out_of_context_word.length > 0 ||
    flags.garbled_phrase.length > 0 ||
    flags.grammar_error.length > 0
  );
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no json object");
  return JSON.parse(trimmed.slice(start, end + 1));
}

function priceFor(model: string, promptTokens: number): Price {
  const row = PRICES[model];
  if (!row) throw new Error(`no price for ${model}`);
  if (model === "claude-haiku-5-5" && promptTokens > 100_000 && row.inputOver) {
    return {
      input: row.inputOver,
      output: row.outputOver ?? row.output,
      cacheWrite: row.cacheWriteOver ?? row.cacheWrite,
      cacheRead: row.cacheReadOver ?? row.cacheRead,
    };
  }
  return row;
}

function costFromUsage(model: string, usage: Usage): number {
  const prompt = usage.input + usage.cacheWrite + usage.cacheRead;
  const price = priceFor(model, prompt);
  return (
    (usage.input * price.input +
      usage.cacheWrite * price.cacheWrite +
      usage.cacheRead * price.cacheRead +
      usage.output * price.output) /
    1e6
  );
}

function noCacheCost(model: string, promptTokens: number, outputTokens: number): number {
  const price = priceFor(model, promptTokens);
  return (promptTokens * price.input + outputTokens * price.output) / 1e6;
}

function spentSoFar(): number {
  return readJsonl<{ cost?: number }>("spend.jsonl").reduce((sum, row) => sum + (Number(row.cost) || 0), 0);
}

function noteSpend(row: { stage: string; model: string; cost: number; usage: Usage }): void {
  appendJsonl("spend.jsonl", row);
}

function assertBudget(nextEstimate: number): void {
  const spent = spentSoFar();
  if (spent + nextEstimate > BUDGET_USD) {
    throw new SpendAbort(
      `budget cap $${BUDGET_USD}: spent $${spent.toFixed(4)}, next call estimate $${nextEstimate.toFixed(4)}`
    );
  }
}

type ApiBody = Record<string, unknown>;

async function anthropic(apiKey: string, pathname: string, body: ApiBody): Promise<{
  json: Record<string, unknown>;
  ms: number;
}> {
  const started = Date.now();
  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(`https://api.anthropic.com${pathname}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    const safe = maskPii(raw).slice(0, 500);
    if (res.status === 402 || /credit balance is too low|purchase credits/i.test(raw)) {
      const err = new CreditAbort(`Anthropic credit error ${res.status}`);
      if (isAnthropicCreditExhausted(Object.assign(new Error(safe), { status: res.status }))) {
        throw err;
      }
      throw err;
    }
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      lastError = `Claude ${res.status}: ${safe}`;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Claude ${res.status}: ${safe}`);
    return { json: JSON.parse(raw) as Record<string, unknown>, ms: Date.now() - started };
  }
  throw new Error(lastError || "Claude retries exhausted");
}

function usageFrom(json: Record<string, unknown>): Usage {
  const usage = (json.usage ?? {}) as Record<string, unknown>;
  const num = (key: string): number => {
    const value = Number(usage[key] ?? 0);
    return Number.isFinite(value) ? value : 0;
  };
  return {
    input: num("input_tokens"),
    output: num("output_tokens"),
    cacheWrite: num("cache_creation_input_tokens"),
    cacheRead: num("cache_read_input_tokens"),
  };
}

function textFrom(json: Record<string, unknown>): { text: string; stopReason: string } {
  const blocks = Array.isArray(json.content) ? json.content : [];
  const text = blocks
    .filter((block): block is { type?: string; text?: string } => Boolean(block) && typeof block === "object")
    .filter((block) => block.type === "text")
    .map((block) => String(block.text ?? ""))
    .join("\n")
    .trim();
  return { text, stopReason: String(json.stop_reason ?? "") };
}

function generationBody(config: ModelConfig, system: string, messages: { role: string; content: string }[]): ApiBody {
  const body: ApiBody = {
    model: config.model,
    max_tokens: config.maxTokens,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages,
  };
  if (config.effort) body.output_config = { effort: config.effort };
  if (config.thinking) body.thinking = { type: config.thinking };
  return body;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index]!, index);
    }
  }
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function businessIdBySlug(admin: SupabaseClient, cache: Map<string, number | null>, slug: string): Promise<number | null> {
  if (cache.has(slug)) return cache.get(slug) ?? null;
  const { data, error } = await admin.from("businesses").select("id").eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  const id = data && typeof data === "object" && "id" in data ? Number((data as { id: unknown }).id) : null;
  const value = Number.isFinite(id) ? id : null;
  cache.set(slug, value);
  return value;
}

async function lookupLead(
  admin: SupabaseClient,
  businessId: number | null,
  sessionId: string
): Promise<{
  firstName: string;
  arboxIsMember: boolean | null;
  phase: string | null;
  contactMatched: boolean;
  phoneDigits: number;
}> {
  const empty = { firstName: "", arboxIsMember: null, phase: null, contactMatched: false, phoneDigits: 0 };
  if (!businessId) return empty;
  const phone = phoneFromSession(sessionId);
  if (!phone) return empty;
  const variants = contactPhoneLookupVariants(phone);
  const phones = variants.length ? variants : [phone];
  const { data, error } = await admin
    .from("contacts")
    .select("full_name, arbox_is_member, session_phase")
    .eq("business_id", businessId)
    .in("phone", phones)
    .limit(1)
    .maybeSingle();
  if (error) {
    if (/arbox_is_member|session_phase|full_name|column/i.test(error.message)) {
      return { ...empty, phoneDigits: phone.replace(/\D/g, "").length };
    }
    throw new Error(error.message);
  }
  const digits = phone.replace(/\D/g, "").length;
  if (!data || typeof data !== "object") return { ...empty, phoneDigits: digits };
  const row = data as { full_name?: unknown; arbox_is_member?: unknown; session_phase?: unknown };
  const member = row.arbox_is_member;
  return {
    firstName: firstName(typeof row.full_name === "string" ? row.full_name : ""),
    arboxIsMember: member === true ? true : member === false ? false : null,
    phase: typeof row.session_phase === "string" ? row.session_phase : null,
    contactMatched: true,
    phoneDigits: digits,
  };
}

async function usageNear(
  admin: SupabaseClient,
  businessId: number | null,
  createdAt: string
): Promise<{ model: string; callType: string; createdAt: string; deltaMs: number }[]> {
  if (!businessId) return [];
  const at = Date.parse(createdAt);
  if (!Number.isFinite(at)) return [];
  const { data, error } = await admin
    .from("ai_usage")
    .select("model, call_type, created_at")
    .eq("business_id", businessId)
    .gte("created_at", new Date(at - 60_000).toISOString())
    .lte("created_at", new Date(at + 60_000).toISOString())
    .limit(20);
  if (error) {
    if (/ai_usage|relation|column/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  if (!Array.isArray(data)) return [];
  return data.map((row) => {
    const item = row as { model?: unknown; call_type?: unknown; created_at?: unknown };
    const created = String(item.created_at ?? "");
    return {
      model: String(item.model ?? ""),
      callType: String(item.call_type ?? ""),
      createdAt: created,
      deltaMs: Math.abs(Date.parse(created) - at),
    };
  });
}

function historyFromRows(rows: MsgRow[]): { role: "user" | "assistant"; content: string; at: string; model: string }[] {
  const chronological = [...rows].reverse();
  const out: { role: "user" | "assistant"; content: string; at: string; model: string }[] = [];
  for (const row of chronological) {
    if (row.role !== "user" && row.role !== "assistant") continue;
    const raw = String(row.content ?? "").trim();
    if (!raw || raw === "[revoke]" || raw.startsWith("[unsupported]") || isWaReactionLogContent(raw)) continue;
    if (raw.startsWith("[media]")) {
      const note = scheduleBoardHistoryNote(raw, row.model_used);
      if (!note) continue;
      out.push({ role: "assistant", content: note, at: row.created_at, model: String(row.model_used ?? "") });
      continue;
    }
    out.push({
      role: row.role,
      content: raw.slice(0, 12_000),
      at: row.created_at,
      model: String(row.model_used ?? ""),
    });
  }
  return out;
}

async function windowBefore(
  admin: SupabaseClient,
  row: MsgRow
): Promise<{ role: "user" | "assistant"; content: string; at: string; model: string }[]> {
  if (!row.session_id) return [];
  const { data, error } = await admin
    .from("messages")
    .select("id, created_at, business_slug, session_id, role, model_used, content")
    .eq("business_slug", row.business_slug)
    .eq("session_id", row.session_id)
    .lt("created_at", row.created_at)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  return historyFromRows(asRows(data));
}

async function turnsBefore(admin: SupabaseClient, row: MsgRow, count: number): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const history = await windowBefore(admin, row);
  return history.slice(-count).map((turn) => ({ role: turn.role, content: maskPii(turn.content) }));
}

const SEARCHES: { label: string; needle: string }[] = [
  { label: "rotem", needle: "וננסדר" },
  { label: "rotem_alt", needle: "בלייקינס" },
  { label: "participate", needle: "מי בעצם תשתתף" },
  { label: "cancellation_policy", needle: "ביטול/החלפת אימון ניתן לבצע עד 12 שעות" },
  { label: "anat", needle: "אני בטוחה שיש כאן בלבול" },
];

async function stageClassify(): Promise<void> {
  const admin = readOnlyAdmin();
  const slugs = new Map<string, number | null>();
  const packs = new Map<string, BusinessKnowledgePack | null>();
  const cases = [];
  for (const search of SEARCHES) {
    const { data, error } = await admin
      .from("messages")
      .select("id, created_at, business_slug, session_id, role, model_used, content")
      .gte("created_at", "2026-09-01T00:00:00.000Z")
      .ilike("content", `%${search.needle}%`)
      .order("created_at", { ascending: false })
      .limit(8);
    if (error) throw new Error(error.message);
    const matches = [];
    for (const row of asRows(data)) {
      const businessId = await businessIdBySlug(admin, slugs, row.business_slug);
      const lead = row.session_id
        ? await lookupLead(admin, businessId, row.session_id)
        : { firstName: "", arboxIsMember: null, phase: null, contactMatched: false, phoneDigits: 0 };
      const usage = await usageNear(admin, businessId, row.created_at);
      const generationNearby = usage.some((item) => item.callType === "generation");
      let addressing: WaReplyAddressingMode = "neutral";
      if (!packs.has(row.business_slug)) {
        packs.set(row.business_slug, await getBusinessKnowledgePack(row.business_slug));
      }
      addressing = resolveWaReplyAddressingMode(packs.get(row.business_slug) ?? null);
      const nearbyQuery = row.session_id
        ? await admin
            .from("messages")
            .select("id, created_at, business_slug, session_id, role, model_used, content")
            .eq("business_slug", row.business_slug)
            .eq("session_id", row.session_id)
            .gte("created_at", new Date(Date.parse(row.created_at) - 12 * 60 * 60_000).toISOString())
            .lte("created_at", new Date(Date.parse(row.created_at) + 30 * 60_000).toISOString())
            .order("created_at", { ascending: true })
            .limit(40)
        : { data: [], error: null };
      if (nearbyQuery.error) throw new Error(nearbyQuery.error.message);
      matches.push({
        messageId: String(row.id),
        createdAt: row.created_at,
        businessSlug: row.business_slug,
        businessId,
        role: row.role,
        modelUsed: row.model_used,
        path: classifyPath(row.model_used, generationNearby),
        route: parseModelUsed(row.model_used).route,
        hint: parseModelUsed(row.model_used).hint,
        arboxIsMember: lead.arboxIsMember,
        contactMatched: lead.contactMatched,
        phoneDigits: lead.phoneDigits,
        sessionShape: sessionShape(row.session_id),
        currentSessionPhase: lead.phase,
        firstName: lead.firstName,
        addressing,
        contentPreview: maskPii(String(row.content ?? "")).slice(0, 400),
        aiUsage: usage.map((item) => ({
          model: item.model,
          callType: item.callType,
          createdAt: item.createdAt,
          deltaMs: item.deltaMs,
        })),
        prior: row.session_id
          ? asRows(
              (
                await admin
                  .from("messages")
                  .select("id, created_at, business_slug, session_id, role, model_used, content")
                  .eq("business_slug", row.business_slug)
                  .eq("session_id", row.session_id)
                  .lt("created_at", row.created_at)
                  .order("created_at", { ascending: false })
                  .limit(12)
              ).data
            )
              .reverse()
              .map((item) => ({
                role: item.role,
                createdAt: item.created_at,
                modelUsed: item.model_used,
                path: classifyPath(item.model_used, false),
                preview: maskPii(String(item.content ?? "")).slice(0, 180),
              }))
          : [],
        nearby: asRows(nearbyQuery.data).map((item) => ({
          messageId: String(item.id),
          role: item.role,
          createdAt: item.created_at,
          modelUsed: item.model_used,
          path: classifyPath(item.model_used, false),
          preview: maskPii(String(item.content ?? "")).slice(0, 220),
        })),
      });
    }
    cases.push({ label: search.label, needle: search.needle, matches });
    console.log(`${search.label}: ${matches.length} match(es)`);
  }
  writeJson("stage1.json", {
    personalRouteCommit: "a67b625d 2026-10-06 12:53:37 +0300",
    cases,
  });
  console.log("wrote eval-output/stage1.json");
}

async function stageMine(): Promise<void> {
  const admin = readOnlyAdmin();
  const since = new Date(Date.now() - SINCE_MS).toISOString();
  const slugs = new Map<string, number | null>();
  const leads = new Map<string, Awaited<ReturnType<typeof lookupLead>>>();
  const mined: Mined[] = [];
  const pageSize = 400;
  let offset = 0;
  for (;;) {
    const { data, error } = await admin
      .from("messages")
      .select("id, created_at, business_slug, session_id, role, model_used, content")
      .eq("role", "assistant")
      .gte("created_at", since)
      .or(assistantModelOrFilter([...GENERATION_MODELS]))
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = asRows(data);
    if (!rows.length) break;
    const pageKept = await mapPool(rows, 6, async (row) => {
      const parsed = parseModelUsed(row.model_used);
      if (parsed.model !== "claude-haiku-4-5" && parsed.model !== "gemini-2.5-flash") return null;
      const businessId = await businessIdBySlug(admin, slugs, row.business_slug);
      const generationNearby = parsed.route
        ? true
        : (await usageNear(admin, businessId, row.created_at)).some((item) => item.callType === "generation");
      if (!parsed.route && !generationNearby) return null;
      const leadKey = `${businessId ?? 0}|${row.session_id ?? ""}`;
      let lead = leads.get(leadKey);
      if (!lead) {
        lead = row.session_id
          ? await lookupLead(admin, businessId, row.session_id)
          : { firstName: "", arboxIsMember: null, phase: null, contactMatched: false, phoneDigits: 0 };
        leads.set(leadKey, lead);
      }
      const turns = await turnsBefore(admin, row, 3);
      const lastUser = [...turns].reverse().find((turn) => turn.role === "user");
      const item: Mined = {
        messageId: String(row.id),
        businessSlug: row.business_slug,
        businessId,
        createdAt: row.created_at,
        modelUsed: String(row.model_used ?? ""),
        route: parsed.route,
        arboxIsMember: lead.arboxIsMember,
        firstName: lead.firstName,
        addressing: "neutral",
        replyPreview: maskPii(String(row.content ?? "")).slice(0, 4000),
        lastUserPreview: lastUser?.content.slice(0, 280) ?? "",
        turns,
      };
      return item;
    });
    for (const item of pageKept) {
      if (item) mined.push(item);
    }
    console.log(`mined page offset ${offset}, kept ${mined.length}`);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  const byRoute: Record<string, number> = {};
  const byBusiness: Record<string, number> = {};
  for (const row of mined) {
    const key = row.route ?? "(no route)";
    byRoute[key] = (byRoute[key] ?? 0) + 1;
    byBusiness[row.businessSlug] = (byBusiness[row.businessSlug] ?? 0) + 1;
  }
  writeJson("mined.json", { since, count: mined.length, byRoute, businesses: Object.keys(byBusiness).length, rows: mined });
  console.log(`generation replies confirmed: ${mined.length} across ${Object.keys(byBusiness).length} businesses`);
}

const FLAG_SYSTEM = `You flag one Hebrew WhatsApp reply from Zoe, a studio bot.
Return only a JSON object. No markdown.
[phone] and [email] are redactions, never errors.
Lead gender is not stored. audience_addressing "feminine" means the business prompt tells Zoe to use feminine singular, so feminine address is grounded in that rule and is not ungrounded_gender. "neutral" means the gender-neutrality rules apply. Set ungrounded_gender true only when audience_addressing is not feminine, the reply uses gendered second person toward the lead (את/אתה, תרצי/תרצה, feminine or masculine verbs aimed at the lead), and the lead gender is not clear from the first name or the conversation.
known_member true means the contact is a known existing member. false or null means unknown, not "not a member". The generation prompt does not receive this flag. Use the conversation too.
Keys:
non_word: string[] tokens that are not Hebrew words
out_of_context_word: string[] real words that do not make sense here
garbled_phrase: string[] short quotes
grammar_error: string[] short quotes such as wrong gender or number agreement
ungrounded_gender: boolean
ignored_latest_message: boolean — the reply misses what the lead just said, or answers an older question the lead has moved past
claims_about_owner: boolean — asserts or denies what the owner or instructor said, did, promised, or plans, without that being in the conversation
should_handoff: boolean — the lead wrote personally to the instructor or owner, or an existing member raised attendance or a relationship matter, and Zoe answered instead of handing off
sales_pitch_to_member: boolean — generic marketing to someone who is clearly an existing member
Use empty arrays and false when absent. Ignore emoji, punctuation, and normal slang.`;

async function stageFlag(): Promise<void> {
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const mined = readJson<{ rows: Mined[] }>("mined.json");
  const done = new Map(readJsonl<{ messageId: string; flags: Flags; error?: string }>("flags.jsonl").map((row) => [row.messageId, row]));
  const todo = mined.rows.filter((row) => !done.has(row.messageId));
  const sample = todo[0];
  let inputGuess = 900;
  if (sample) {
    const counted = await anthropic(apiKey, "/v1/messages/count_tokens", {
      model: "claude-haiku-5-5",
      system: FLAG_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify({ turns: sample.turns, reply: sample.replyPreview }).slice(0, 4000) }],
    });
    inputGuess = Number((counted.json as { input_tokens?: number }).input_tokens ?? inputGuess);
  }
  const outGuess = 180;
  const each = noCacheCost("claude-haiku-5-5", inputGuess, outGuess);
  const estimate = each * todo.length;
  console.log(
    `flagger estimate: ${todo.length} calls x ~${inputGuess} in + ${outGuess} out = $${estimate.toFixed(3)} (haiku-5-5 low tier, thinking off). spent $${spentSoFar().toFixed(3)}`
  );
  if (estimate > 4 && todo.length > 0) {
    throw new SpendAbort(`flagger estimate $${estimate.toFixed(2)} is above the $4 slice reserved before generation. Narrow the mine before rerunning flag.`);
  }
  assertBudget(Math.min(estimate, each * 4));
  const packs = new Map<string, WaReplyAddressingMode>();
  await mapPool(todo, 4, async (row) => {
    if (!packs.has(row.businessSlug)) {
      const pack = await getBusinessKnowledgePack(row.businessSlug);
      packs.set(row.businessSlug, resolveWaReplyAddressingMode(pack));
    }
    const addressing = packs.get(row.businessSlug) ?? "neutral";
    const user = JSON.stringify({
      audience_addressing: addressing,
      known_member: row.arboxIsMember === true,
      lead_first_name: row.firstName,
      turns: row.turns,
      reply: row.replyPreview,
    });
    try {
      assertBudget(each * 2);
      const res = await anthropic(apiKey, "/v1/messages", {
        model: "claude-haiku-5-5",
        max_tokens: 500,
        thinking: { type: "disabled" },
        output_config: { effort: "low" },
        system: FLAG_SYSTEM,
        messages: [{ role: "user", content: user }],
      });
      const usage = usageFrom(res.json);
      const cost = costFromUsage("claude-haiku-5-5", usage);
      noteSpend({ stage: "flag", model: "claude-haiku-5-5", cost, usage });
      const { text } = textFrom(res.json);
      const flags = coerceFlags(parseJsonObject(text));
      appendJsonl("flags.jsonl", { messageId: row.messageId, flags, error: "" });
    } catch (error) {
      if (error instanceof CreditAbort || error instanceof SpendAbort) throw error;
      appendJsonl("flags.jsonl", {
        messageId: row.messageId,
        flags: emptyFlags(),
        error: error instanceof Error ? maskPii(error.message).slice(0, 240) : "flagger failed",
      });
    }
  });
  const flagsById = new Map(readJsonl<{ messageId: string; flags: Flags; error?: string }>("flags.jsonl").map((row) => [row.messageId, row]));
  const rows = mined.rows.map((row) => {
    const hit = flagsById.get(row.messageId);
    const flags = hit?.flags ?? emptyFlags();
    return { ...row, addressing: packs.get(row.businessSlug) ?? row.addressing, flags, flagScore: flagScore(flags), flaggerError: hit?.error || undefined };
  });
  const breakdown = {
    scanned: rows.length,
    flagged: rows.filter((row) => row.flags && isFlagged(row.flags)).length,
    flaggerErrors: rows.filter((row) => row.flaggerError).length,
    non_word: rows.filter((row) => (row.flags?.non_word.length ?? 0) > 0).length,
    out_of_context_word: rows.filter((row) => (row.flags?.out_of_context_word.length ?? 0) > 0).length,
    garbled_phrase: rows.filter((row) => (row.flags?.garbled_phrase.length ?? 0) > 0).length,
    grammar_error: rows.filter((row) => (row.flags?.grammar_error.length ?? 0) > 0).length,
    ungrounded_gender: rows.filter((row) => row.flags?.ungrounded_gender).length,
    ignored_latest_message: rows.filter((row) => row.flags?.ignored_latest_message).length,
    claims_about_owner: rows.filter((row) => row.flags?.claims_about_owner).length,
    should_handoff: rows.filter((row) => row.flags?.should_handoff).length,
    sales_pitch_to_member: rows.filter((row) => row.flags?.sales_pitch_to_member).length,
  };
  writeJson("mined.json", { ...mined, count: rows.length, breakdown, rows });
  writeJson("flag-breakdown.json", breakdown);
  console.log(JSON.stringify(breakdown));
  console.log(`spent after flag $${spentSoFar().toFixed(4)}`);
}

type Selected = Mined & { kind: "problem" | "control"; source: string };

const NON_WORD_DENY = new Set(["המכבים", "ניתן", "החוות", "הכנה"]);

function groundedFlags(flags: Flags, reply: string): Flags {
  const keep = (items: string[]): string[] =>
    items.filter((item) => {
      const token = item.trim();
      return token.length >= 2 && token.length <= 120 && reply.includes(token);
    });
  const mixed = reply.match(/[\u0590-\u05FF]{1,4}[A-Za-z]{4,}|[A-Za-z]{4,}[\u0590-\u05FF]{1,4}/g) ?? [];
  const nonWord = [...keep(flags.non_word).filter((token) => token.length >= 4 && !NON_WORD_DENY.has(token)), ...mixed];
  return {
    ...flags,
    non_word: [...new Set(nonWord)].slice(0, 8),
    out_of_context_word: keep(flags.out_of_context_word),
    garbled_phrase: keep(flags.garbled_phrase),
    grammar_error: keep(flags.grammar_error),
  };
}

function stageSelect(): void {
  const mined = readJson<{ rows: Mined[] }>("mined.json");
  const stage1 = hasFile("stage1.json")
    ? readJson<{ cases: { label: string; matches: { messageId: string; path: string; role: string }[] }[] }>("stage1.json")
    : { cases: [] };
  const forcedIds = new Map<string, string>();
  for (const item of stage1.cases) {
    if (item.label === "cancellation_policy" || item.label === "rotem_alt") continue;
    for (const match of item.matches) {
      if (match.role === "assistant" && match.path === "llm_generation") forcedIds.set(match.messageId, item.label);
    }
  }
  const byId = new Map(mined.rows.map((row) => [row.messageId, row]));
  const problem: Selected[] = [];
  const used = new Set<string>();
  const perBusiness = new Map<string, number>();
  for (const [messageId, source] of forcedIds) {
    const row = byId.get(messageId);
    if (!row || used.has(messageId)) continue;
    problem.push({ ...row, kind: "problem", source });
    used.add(messageId);
    perBusiness.set(row.businessSlug, (perBusiness.get(row.businessSlug) ?? 0) + 1);
  }
  const ranked = mined.rows
    .filter((row) => row.flags && !used.has(row.messageId))
    .map((row) => {
      const flags = groundedFlags(row.flags ?? emptyFlags(), row.replyPreview);
      return { ...row, flags, flagScore: flagScore(flags) };
    })
    .filter((row) => (row.flagScore ?? 0) >= 8);
  ranked.sort((a, b) => (b.flagScore ?? 0) - (a.flagScore ?? 0));
  for (const row of ranked) {
    if (problem.length >= 15) break;
    const count = perBusiness.get(row.businessSlug) ?? 0;
    if (count >= 2 && problem.length < 12) continue;
    problem.push({ ...row, kind: "problem", source: "flagged" });
    used.add(row.messageId);
    perBusiness.set(row.businessSlug, count + 1);
  }
  const controlsPool = mined.rows.filter((row) => row.flags && !isFlagged(row.flags) && !row.flaggerError && !used.has(row.messageId));
  const rand = mulberry32(20261009);
  controlsPool.sort((a, b) => hashSeed(a.messageId) - hashSeed(b.messageId) || (rand() < 0.5 ? -1 : 1));
  const control: Selected[] = [];
  const controlBiz = new Map<string, number>();
  for (const row of controlsPool) {
    if (control.length >= 15) break;
    const count = controlBiz.get(row.businessSlug) ?? 0;
    if (count >= 2) continue;
    control.push({ ...row, kind: "control", source: "unflagged" });
    controlBiz.set(row.businessSlug, count + 1);
  }
  writeJson("selected.json", { problem: problem.length, control: control.length, rows: [...problem, ...control] });
  console.log(`selected problem ${problem.length}, control ${control.length}`);
}

type Built = {
  caseId: string;
  messageId: string;
  kind: "problem" | "control";
  source: string;
  businessSlug: string;
  firstName: string;
  addressing: WaReplyAddressingMode;
  arboxIsMember: boolean | null;
  turns: { role: "user" | "assistant"; content: string }[];
  haiku45Tokens: number;
  haiku55Tokens: number;
  over100k: boolean;
  knowledgeExcerpt: string;
};

function knowledgeExcerpt(system: string): string {
  const start = system.indexOf("ידע עסקי:");
  const end = system.indexOf("טלפון שירות לקוחות");
  if (start < 0) return system.slice(0, 4000);
  const slice = system.slice(start, end > start ? end : start + 6000);
  return slice.slice(0, 6000);
}

async function buildCasePrompt(
  admin: SupabaseClient,
  row: MsgRow,
  guidelines: ZoePlatformGuidelines,
  pack: BusinessKnowledgePack | null
): Promise<{ system: string; messages: { role: "user" | "assistant"; content: string }[]; turns: { role: "user" | "assistant"; content: string }[] } | null> {
  const history = await windowBefore(admin, row);
  let split = history.length;
  while (split > 0 && history[split - 1]?.role === "user") split -= 1;
  const prior = history.slice(0, split);
  const trailing = history.slice(split);
  if (!trailing.length || !pack) return null;
  const currentText = joinInboundUserTexts(
    "",
    trailing.map((turn) => ({ content: turn.content }))
  );
  const hint = parseModelUsed(row.model_used).hint;
  let userContent = currentText;
  if (hint) userContent = `${userContent}\n\n${formatFastPathHintLine({ matcher: "stored", category: hint })}`;
  userContent = `${userContent.trim()}\n\nהשורה הראשונה בתשובתך חייבת להיות [[route:X]] ורק אחריה הטקסט ללקוחה.`;
  const leadAgeBand = inferLeadAgeBandFromUserTexts([...prior.filter((turn) => turn.role === "user").map((turn) => turn.content), currentText]);
  const flowOpen = prior.some((turn) => turn.role === "assistant" && /sales_flow|flow_continuation/i.test(turn.model));
  const at = new Date(trailing[trailing.length - 1]?.at || row.created_at);
  const system = buildSystemPrompt(
    pack,
    row.business_slug,
    "whatsapp",
    {
      israelNowScheduleBlock: buildIsraelNowSchedulePromptBlock(pack.salesFlowServices ?? [], at),
      leadAgeBand,
      salesFlowCurrentlyOpen: flowOpen,
    },
    guidelines,
    currentText
  );
  const messages = [
    ...prior.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user" as const, content: userContent },
  ];
  const turns = [...prior.slice(-2).map((turn) => ({ role: turn.role, content: maskPii(turn.content) })), { role: "user" as const, content: maskPii(currentText) }].slice(-3);
  return { system, messages, turns };
}

async function stageRebuild(): Promise<void> {
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const selected = readJson<{ rows: Selected[] }>("selected.json");
  const admin = readOnlyAdmin();
  const guidelines = await loadZoePlatformGuidelines();
  const packs = new Map<string, BusinessKnowledgePack | null>();
  const built: Built[] = [];
  for (const [index, item] of selected.rows.entries()) {
    const { data, error } = await admin
      .from("messages")
      .select("id, created_at, business_slug, session_id, role, model_used, content")
      .eq("id", item.messageId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = data && typeof data === "object" ? (data as MsgRow) : null;
    if (!row) continue;
    if (!packs.has(row.business_slug)) packs.set(row.business_slug, await getBusinessKnowledgePack(row.business_slug));
    const prompt = await buildCasePrompt(admin, row, guidelines, packs.get(row.business_slug) ?? null);
    if (!prompt) {
      console.log(`skip ${item.messageId}: no user turn in the history window`);
      continue;
    }
    const count45 = await anthropic(apiKey, "/v1/messages/count_tokens", {
      model: "claude-haiku-4-5",
      system: prompt.system,
      messages: prompt.messages,
    });
    const count55 = await anthropic(apiKey, "/v1/messages/count_tokens", {
      model: "claude-haiku-5-5",
      system: prompt.system,
      messages: prompt.messages,
    });
    const haiku45Tokens = Number((count45.json as { input_tokens?: number }).input_tokens ?? 0);
    const haiku55Tokens = Number((count55.json as { input_tokens?: number }).input_tokens ?? 0);
    const caseId = `${item.kind === "problem" ? "p" : "c"}${String(index + 1).padStart(2, "0")}`;
    built.push({
      caseId,
      messageId: item.messageId,
      kind: item.kind,
      source: item.source,
      businessSlug: item.businessSlug,
      firstName: item.firstName,
      addressing: resolveWaReplyAddressingMode(packs.get(row.business_slug) ?? null),
      arboxIsMember: item.arboxIsMember,
      turns: prompt.turns,
      haiku45Tokens,
      haiku55Tokens,
      over100k: haiku55Tokens > 100_000,
      knowledgeExcerpt: maskPii(knowledgeExcerpt(prompt.system)),
    });
    console.log(`${caseId} haiku4.5=${haiku45Tokens} haiku5.5=${haiku55Tokens}${haiku55Tokens > 100_000 ? " OVER_100K" : ""}`);
  }
  const outside = built.filter((row) => row.haiku45Tokens < 30_000 || row.haiku45Tokens > 60_000);
  writeJson("built.json", {
    note: "buildSystemPrompt stamps expired-date notes with the clock at eval time. It has no now argument. The Israel schedule block uses the original user-message timestamp. Session phase, trial flags, and committed schedule are not stored on the message, so those blocks are omitted. salesFlowCurrentlyOpen is inferred from recent assistant model_used. Business config is current and may have changed.",
    outsideExpectedRange: outside.map((row) => ({ caseId: row.caseId, haiku45Tokens: row.haiku45Tokens })),
    over100k: built.filter((row) => row.over100k).map((row) => row.caseId),
    rows: built,
  });
  planSamples(built);
}

function expectedOutput(config: ModelConfig): number {
  if (config.id === "haiku-5-5-medium") return 1600;
  if (config.id === "haiku-5-5-low") return 900;
  if (config.id === "sonnet-5-5-low") return 350;
  return 280;
}

function cachedCaseCost(config: ModelConfig, promptTokens: number, samples: number): number {
  const price = priceFor(config.model, promptTokens);
  const messages = Math.min(2500, Math.round(promptTokens * 0.06));
  const system = Math.max(0, promptTokens - messages);
  const out = expectedOutput(config);
  const first = (system * price.cacheWrite + messages * price.input + out * price.output) / 1e6;
  const later = (system * price.cacheRead + messages * price.input + out * price.output) / 1e6;
  return first + Math.max(0, samples - 1) * later;
}

function planSamples(built: Built[]): void {
  let problemSamples = 5;
  let controlSamples = 3;
  let rows = built.slice();
  const estimateFor = (list: Built[], pSamples: number, cSamples: number): number => {
    let sum = 0;
    for (const row of list) {
      const samples = row.kind === "problem" ? pSamples : cSamples;
      for (const config of CONFIGS) {
        const tokens = config.model.includes("5-5") && config.model !== "claude-sonnet-4-6" ? row.haiku55Tokens : row.haiku45Tokens;
        const promptTokens = config.model === "claude-sonnet-4-6" || config.model === "claude-haiku-4-5" ? row.haiku45Tokens : tokens;
        sum += cachedCaseCost(config, promptTokens || row.haiku45Tokens, samples);
      }
    }
    const judgments = list.reduce((count, row) => count + (row.kind === "problem" ? pSamples : cSamples), 0) * CONFIGS.length;
    sum += judgments * noCacheCost("claude-sonnet-5-5", 2800, 350);
    return sum;
  };
  let estimate = estimateFor(rows, problemSamples, controlSamples);
  const notes: string[] = [];
  const shrink = (reason: string, apply: () => void) => {
    apply();
    notes.push(reason);
    estimate = estimateFor(rows, problemSamples, controlSamples);
  };
  while (estimate + spentSoFar() > 18) {
    if (controlSamples > 2) {
      shrink("control samples 3 -> 2", () => {
        controlSamples = 2;
      });
      continue;
    }
    if (problemSamples > 3) {
      shrink(`problem samples ${problemSamples} -> ${problemSamples - 1}`, () => {
        problemSamples -= 1;
      });
      continue;
    }
    if (controlSamples > 1) {
      shrink("control samples 2 -> 1", () => {
        controlSamples = 1;
      });
      continue;
    }
    const controls = rows.filter((row) => row.kind === "control");
    if (controls.length > 8) {
      shrink("dropped one control case", () => {
        const last = [...rows].reverse().find((row) => row.kind === "control");
        rows = rows.filter((row) => row !== last);
      });
      continue;
    }
    break;
  }
  writeJson("plan.json", {
    problemSamples,
    controlSamples,
    estimateUsd: Number(estimate.toFixed(3)),
    spentBeforeRun: Number(spentSoFar().toFixed(4)),
    notes,
    fitsBudget: estimate + spentSoFar() <= BUDGET_USD,
    caseIds: rows.map((row) => row.caseId),
  });
  console.log(
    `generation+judge estimate with cache $${estimate.toFixed(2)} plus spent $${spentSoFar().toFixed(2)}. problem samples ${problemSamples}, control samples ${controlSamples}, cases ${rows.length}. ${notes.join("; ") || "no reduction"}`
  );
  if (estimate + spentSoFar() > BUDGET_USD) {
    throw new SpendAbort("estimate still exceeds the cap after reductions. Not starting paid generation.");
  }
}

async function loadPromptForCase(caseId: string): Promise<{ system: string; messages: { role: "user" | "assistant"; content: string }[] } | null> {
  const built = readJson<{ rows: Built[] }>("built.json");
  const item = built.rows.find((row) => row.caseId === caseId);
  if (!item) return null;
  const admin = readOnlyAdmin();
  const guidelines = await loadZoePlatformGuidelines();
  const { data, error } = await admin
    .from("messages")
    .select("id, created_at, business_slug, session_id, role, model_used, content")
    .eq("id", item.messageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object") return null;
  const pack = await getBusinessKnowledgePack((data as MsgRow).business_slug);
  const prompt = await buildCasePrompt(admin, data as MsgRow, guidelines, pack);
  if (!prompt) return null;
  return { system: prompt.system, messages: prompt.messages };
}

type RunRow = {
  caseId: string;
  configId: string;
  sample: number;
  kind: "problem" | "control";
  text: string;
  route: string | null;
  latencyMs: number;
  usage: Usage;
  cost: number;
  costNoCache: number;
  stopReason: string;
  truncated: boolean;
  error?: string;
};

async function stageRun(): Promise<void> {
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const plan = readJson<{ problemSamples: number; controlSamples: number; caseIds: string[]; fitsBudget: boolean }>("plan.json");
  if (!plan.fitsBudget) throw new SpendAbort("plan is over budget");
  const built = readJson<{ rows: Built[] }>("built.json");
  const cases = built.rows.filter((row) => plan.caseIds.includes(row.caseId));
  const existing = new Set(readJsonl<RunRow>("runs.jsonl").map((row) => `${row.caseId}:${row.configId}:${row.sample}`));
  const skipped = new Set<string>();
  for (const item of cases) {
    const samples = item.kind === "problem" ? plan.problemSamples : plan.controlSamples;
    const needsCall = CONFIGS.some((config) => {
      if (skipped.has(config.id)) return false;
      return Array.from({ length: samples }, (_, sample) => `${item.caseId}:${config.id}:${sample}`).some((key) => !existing.has(key));
    });
    const prompt = needsCall ? await loadPromptForCase(item.caseId) : null;
    await mapPool(CONFIGS, 4, async (config) => {
      if (skipped.has(config.id)) return;
      for (let sample = 0; sample < samples; sample += 1) {
        const key = `${item.caseId}:${config.id}:${sample}`;
        if (existing.has(key)) continue;
        const promptTokens = config.model === "claude-haiku-4-5" || config.model === "claude-sonnet-4-6" ? item.haiku45Tokens : item.haiku55Tokens;
        const next = cachedCaseCost(config, promptTokens || item.haiku45Tokens, 1);
        assertBudget(Math.max(next, 0.02));
        if (!prompt) {
          appendJsonl("runs.jsonl", { caseId: item.caseId, configId: config.id, sample, kind: item.kind, text: "", route: null, latencyMs: 0, usage: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, cost: 0, costNoCache: 0, stopReason: "no_prompt", truncated: false, error: "prompt rebuild failed" });
          continue;
        }
        try {
          const body = generationBody(config, prompt.system, prompt.messages);
          const res = await anthropic(apiKey, "/v1/messages", body);
          const usage = usageFrom(res.json);
          const cost = costFromUsage(config.model, usage);
          const promptCount = usage.input + usage.cacheWrite + usage.cacheRead;
          const costNo = noCacheCost(config.model, promptCount, usage.output);
          noteSpend({ stage: "run", model: config.model, cost, usage });
          const { text, stopReason } = textFrom(res.json);
          const extracted = extractReplyRoute(text);
          const run: RunRow = {
            caseId: item.caseId,
            configId: config.id,
            sample,
            kind: item.kind,
            text: extracted.body,
            route: extracted.route,
            latencyMs: res.ms,
            usage,
            cost,
            costNoCache: costNo,
            stopReason,
            truncated: stopReason === "max_tokens",
          };
          appendJsonl("runs.jsonl", run);
          existing.add(key);
        } catch (error) {
          if (error instanceof CreditAbort || error instanceof SpendAbort) throw error;
          const message = error instanceof Error ? error.message : "call failed";
          if (/not_found|model/i.test(message) && /404|400/.test(message) && sample === 0) {
            skipped.add(config.id);
            appendJsonl("skipped-models.jsonl", { configId: config.id, model: config.model, error: message.slice(0, 300) });
            console.log(`skip config ${config.id}: ${message.slice(0, 180)}`);
            return;
          }
          throw error;
        }
      }
    });
    console.log(`ran ${item.caseId}, spent $${spentSoFar().toFixed(3)}`);
  }
}

const JUDGE_SYSTEM = `You score one Hebrew WhatsApp reply from Zoe.
Return only JSON. No markdown.
[phone] and [email] are redactions, not errors.
You receive the last turns, the visible reply (route tag already removed), audience_addressing, known_member, and the business knowledge excerpt.
If the visible reply is empty, Zoe stayed silent. Then every list is empty, every problem boolean is false, length_ok is true, answered_latest_message is false.
Otherwise use the same flag definitions as a Hebrew and judgment review:
non_word, out_of_context_word, garbled_phrase, grammar_error: string arrays
ungrounded_gender, ignored_latest_message, claims_about_owner, should_handoff, sales_pitch_to_member: booleans
answered_latest_message: boolean
invented_facts: string[] of prices, times, or policies in the reply that do not appear in the knowledge excerpt
length_ok: boolean — false when empty of substance while a reply was required, when it is an essay, or when it is cut off mid-word
Do not treat a route tag as text. The reply you see is what the lead would get.`;

async function stageJudge(): Promise<void> {
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const built = readJson<{ rows: Built[] }>("built.json");
  const byCase = new Map(built.rows.map((row) => [row.caseId, row]));
  const runs = readJsonl<RunRow>("runs.jsonl").filter((row) => !row.error);
  const done = new Set(readJsonl<{ caseId: string; configId: string; sample: number }>("judgments.jsonl").map((row) => `${row.caseId}:${row.configId}:${row.sample}`));
  const todo = runs.filter((row) => !done.has(`${row.caseId}:${row.configId}:${row.sample}`));
  let inputGuess = 2800;
  const probe = todo[0];
  const probeCase = probe ? byCase.get(probe.caseId) : undefined;
  if (probe && probeCase) {
    const counted = await anthropic(apiKey, "/v1/messages/count_tokens", {
      model: "claude-sonnet-5-5",
      system: JUDGE_SYSTEM,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            audience_addressing: probeCase.addressing,
            known_member: probeCase.arboxIsMember === true,
            lead_first_name: probeCase.firstName,
            turns: probeCase.turns,
            reply: probe.text,
            truncated: probe.truncated,
            knowledge_excerpt: probeCase.knowledgeExcerpt,
          }),
        },
      ],
    });
    inputGuess = Number((counted.json as { input_tokens?: number }).input_tokens ?? inputGuess);
  }
  const each = noCacheCost("claude-sonnet-5-5", inputGuess, 350);
  console.log(
    `judge estimate: ${todo.length} x ~${inputGuess} in + 350 out = $${(todo.length * each).toFixed(2)} (sonnet-5-5, between_tools, effort low). spent $${spentSoFar().toFixed(3)}`
  );
  if (spentSoFar() + todo.length * each > BUDGET_USD) {
    throw new SpendAbort("judge estimate exceeds the remaining budget");
  }
  await mapPool(todo, 4, async (run) => {
    const item = byCase.get(run.caseId);
    if (!item) return;
    assertBudget(each * 2);
    const user = JSON.stringify({
      audience_addressing: item.addressing,
      known_member: item.arboxIsMember === true,
      lead_first_name: item.firstName,
      turns: item.turns,
      reply: run.text,
      truncated: run.truncated,
      knowledge_excerpt: item.knowledgeExcerpt,
    });
    const res = await anthropic(apiKey, "/v1/messages", {
      model: "claude-sonnet-5-5",
      max_tokens: 700,
      thinking: { type: "between_tools" },
      output_config: { effort: "low" },
      system: JUDGE_SYSTEM,
      messages: [{ role: "user", content: user }],
    });
    const usage = usageFrom(res.json);
    const cost = costFromUsage("claude-sonnet-5-5", usage);
    noteSpend({ stage: "judge", model: "claude-sonnet-5-5", cost, usage });
    const { text } = textFrom(res.json);
    let flags = emptyFlags();
    let judgeError = "";
    try {
      flags = coerceFlags(parseJsonObject(text));
    } catch (error) {
      judgeError = error instanceof Error ? error.message : "parse";
    }
    appendJsonl("judgments.jsonl", { caseId: run.caseId, configId: run.configId, sample: run.sample, kind: run.kind, flags, judgeError });
  });
  console.log(`spent after judge $${spentSoFar().toFixed(4)}`);
  stageReport();
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function rate(hits: number, total: number): number {
  if (!total) return 0;
  return Math.round((1000 * hits) / total) / 10;
}

function stageReport(): void {
  const runs = readJsonl<RunRow>("runs.jsonl").filter((row) => !row.error);
  const judgments = readJsonl<{ caseId: string; configId: string; sample: number; kind: string; flags: Flags; judgeError?: string }>("judgments.jsonl");
  const judgeByKey = new Map(judgments.map((row) => [`${row.caseId}:${row.configId}:${row.sample}`, row]));
  const skipped = readJsonl<{ configId: string; model: string; error: string }>("skipped-models.jsonl");
  const breakdown = hasFile("flag-breakdown.json") ? readJson<Record<string, number>>("flag-breakdown.json") : {};
  const plan = hasFile("plan.json") ? readJson<Record<string, unknown>>("plan.json") : {};
  const built = hasFile("built.json") ? readJson<{ outsideExpectedRange: unknown; over100k: unknown; note: string }>("built.json") : null;
  const configs = CONFIGS.map((config) => {
    const mine = runs.filter((row) => row.configId === config.id);
    const judged = mine
      .map((row) => ({ run: row, judge: judgeByKey.get(`${row.caseId}:${row.configId}:${row.sample}`) }))
      .filter((row) => row.judge && !row.judge.judgeError);
    const slice = (kind: "problem" | "control") => {
      const rows = judged.filter((row) => row.run.kind === kind);
      const flags = rows.map((row) => row.judge!.flags);
      return {
        n: rows.length,
        hebrewErrorPct: rate(flags.filter(hebrewError).length, rows.length),
        ungroundedGenderPct: rate(flags.filter((flag) => flag.ungrounded_gender).length, rows.length),
        ignoredLatestPct: rate(flags.filter((flag) => flag.ignored_latest_message).length, rows.length),
        claimsAboutOwnerPct: rate(flags.filter((flag) => flag.claims_about_owner).length, rows.length),
        shouldHandoffPct: rate(flags.filter((flag) => flag.should_handoff).length, rows.length),
        salesPitchPct: rate(flags.filter((flag) => flag.sales_pitch_to_member).length, rows.length),
        inventedFactsPct: rate(flags.filter((flag) => (flag.invented_facts?.length ?? 0) > 0).length, rows.length),
        answeredLatestPct: rate(flags.filter((flag) => flag.answered_latest_message === true).length, rows.length),
        lengthOkPct: rate(flags.filter((flag) => flag.length_ok === true).length, rows.length),
      };
    };
    const lat = mine.map((row) => row.latencyMs);
    const avgOut = mine.length ? mine.reduce((sum, row) => sum + row.usage.output, 0) / mine.length : 0;
    const avgNoCache = mine.length ? mine.reduce((sum, row) => sum + row.costNoCache, 0) / mine.length : 0;
    const avgActual = mine.length ? mine.reduce((sum, row) => sum + row.cost, 0) / mine.length : 0;
    return {
      id: config.id,
      model: config.model,
      effort: config.effort ?? "(omitted)",
      thinking: config.thinking ?? "(default for model)",
      maxTokens: config.maxTokens,
      note: config.note,
      skipped: skipped.find((row) => row.configId === config.id)?.error ?? "",
      problem: slice("problem"),
      control: slice("control"),
      latencyP50Ms: Math.round(percentile(lat, 50)),
      latencyP95Ms: Math.round(percentile(lat, 95)),
      avgOutputTokens: Math.round(avgOut),
      avgCostNoCacheUsd: Number(avgNoCache.toFixed(5)),
      avgCostThisEvalUsd: Number(avgActual.toFixed(5)),
      monthly100PerDayNoCache: Number((avgNoCache * 100 * 30).toFixed(2)),
      monthly1000PerDayNoCache: Number((avgNoCache * 1000 * 30).toFixed(2)),
      truncated: mine.filter((row) => row.truncated).length,
      calls: mine.length,
    };
  });
  const report = {
    spentUsd: Number(spentSoFar().toFixed(4)),
    flagBreakdown: breakdown,
    plan,
    promptNote: built?.note ?? "",
    tokenRangeFlags: built?.outsideExpectedRange ?? [],
    over100k: built?.over100k ?? [],
    configs,
    docs: [
      "https://platform.claude.com/docs/en/models/haiku-4-5/overview",
      "https://platform.claude.com/docs/en/models/haiku-5-5/overview",
      "https://platform.claude.com/docs/en/models/sonnet-5-5/overview",
      "https://platform.claude.com/docs/en/models/sonnet-4-6/overview",
      "https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide",
      "https://platform.claude.com/docs/en/about-claude/pricing",
      "https://platform.claude.com/docs/en/build-with-claude/effort",
      "https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5",
    ],
  };
  writeJson("report.json", report);
  console.log(JSON.stringify({ spent: report.spentUsd, configs: configs.map((row) => ({ id: row.id, calls: row.calls, p50: row.latencyP50Ms, noCache: row.avgCostNoCacheUsd })) }));
}

function stageReview(): void {
  const built = readJson<{ rows: Built[] }>("built.json");
  const plan = readJson<{ caseIds: string[] }>("plan.json");
  const runs = readJsonl<RunRow>("runs.jsonl").filter((row) => !row.error && plan.caseIds.includes(row.caseId));
  const judgments = readJsonl<{ caseId: string; configId: string; sample: number; flags: Flags }>("judgments.jsonl");
  const judgeByKey = new Map(judgments.map((row) => [`${row.caseId}:${row.configId}:${row.sample}`, row.flags]));
  const cases = built.rows.filter((row) => plan.caseIds.includes(row.caseId)).slice(0, 30);
  const key: Record<string, { kind: string; source: string; labels: Record<string, { configId: string; sample: number }> }> = {};
  const pageCases = cases.map((item) => {
    const rand = mulberry32(hashSeed(item.caseId));
    const options = CONFIGS.map((config) => {
      const samples = runs.filter((row) => row.caseId === item.caseId && row.configId === config.id);
      if (!samples.length) return null;
      const pick = samples[Math.floor(rand() * samples.length)]!;
      return { configId: config.id, sample: pick.sample, text: pick.text, flags: judgeByKey.get(`${item.caseId}:${config.id}:${pick.sample}`) ?? null };
    }).filter((row): row is NonNullable<typeof row> => Boolean(row));
    for (let i = options.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      const swap = options[i]!;
      options[i] = options[j]!;
      options[j] = swap;
    }
    const letters = "ABCDE";
    const labels: Record<string, { configId: string; sample: number }> = {};
    const outputs = options.map((option, index) => {
      const letter = letters[index] ?? String(index + 1);
      labels[letter] = { configId: option.configId, sample: option.sample };
      return { letter, text: option.text, flags: option.flags };
    });
    key[item.caseId] = { kind: item.kind, source: item.source, labels };
    return { caseId: item.caseId, firstName: item.firstName, turns: item.turns, outputs };
  });
  writeJson("key.json", key);
  const data = JSON.stringify(pageCases).replace(/</g, "\\u003c");
  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>בדיקת תשובות זואי</title>
<style>
  body { margin: 0; font-family: "Arial Hebrew", "Segoe UI", "Noto Sans Hebrew", Arial, sans-serif; background: #f6f3ee; color: #1c1917; }
  header { position: sticky; top: 0; background: #1c1917; color: #faf7f2; padding: 12px 16px; display: flex; justify-content: space-between; gap: 12px; align-items: center; }
  header button, .row button, .best button { font: inherit; border: 0; border-radius: 999px; padding: 8px 14px; cursor: pointer; }
  header button { background: #f5d76e; color: #1c1917; }
  main { max-width: 880px; margin: 0 auto; padding: 16px; }
  article { background: #fff; border-radius: 16px; padding: 16px; margin: 0 0 16px; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
  .turn { padding: 8px 10px; border-radius: 12px; margin: 6px 0; white-space: pre-wrap; }
  .user { background: #e7f0e4; }
  .assistant { background: #f3efe8; }
  .out { border-top: 1px solid #eee; margin-top: 12px; padding-top: 12px; }
  .letter { font-weight: 700; }
  .reply { white-space: pre-wrap; line-height: 1.45; }
  .row, .best { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .row button.on { background: #1c1917; color: white; }
  .best button.on { background: #0f6b4c; color: white; }
  pre.flags { display: none; background: #faf7f2; padding: 8px; border-radius: 8px; white-space: pre-wrap; }
  pre.flags.show { display: block; }
  .muted { color: #57534e; font-size: 14px; }
</style>
</head>
<body>
<header>
  <div>לכל תשובה: תקין או לא תקין. בכל שיחה סמני גם את ההכי טובה.</div>
  <button id="export" type="button">ייצוא</button>
</header>
<main id="app"></main>
<script>
const CASES = ${data};
const storageKey = "heyzoe-wa-model-review";
const state = JSON.parse(localStorage.getItem(storageKey) || "{}");
function save() { localStorage.setItem(storageKey, JSON.stringify(state)); }
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
const app = document.getElementById("app");
for (const item of CASES) {
  state[item.caseId] = state[item.caseId] || { ratings: {}, best: "" };
  const art = document.createElement("article");
  const turns = item.turns.map((t) => '<div class="turn ' + t.role + '"><div class="muted">' + (t.role === "user" ? "ליד" : "זואי") + '</div>' + esc(t.content) + '</div>').join("");
  const outputs = item.outputs.map((o) => {
    const flags = esc(JSON.stringify(o.flags || {}, null, 2));
    return '<div class="out" data-letter="' + o.letter + '"><div class="letter">תשובה ' + o.letter + '</div><div class="reply">' + (o.text ? esc(o.text) : "אין טקסט ללקוח") + '</div><div class="row"><button type="button" data-rate="ok">תקין</button><button type="button" data-rate="bad">לא תקין</button><button type="button" data-flags>הצג סימונים</button></div><pre class="flags">' + flags + '</pre></div>';
  }).join("");
  const best = item.outputs.map((o) => '<button type="button" data-best="' + o.letter + '">' + o.letter + '</button>').join("");
  art.innerHTML = '<h2>שיחה ' + esc(item.caseId) + (item.firstName ? " · " + esc(item.firstName) : "") + '</h2>' + turns + outputs + '<div class="best"><span>הכי טובה:</span>' + best + '</div>';
  app.appendChild(art);
  function paint() {
    const cur = state[item.caseId];
    art.querySelectorAll(".out").forEach((node) => {
      const letter = node.getAttribute("data-letter");
      node.querySelectorAll("[data-rate]").forEach((btn) => {
        btn.classList.toggle("on", cur.ratings[letter] === btn.getAttribute("data-rate"));
      });
    });
    art.querySelectorAll("[data-best]").forEach((btn) => btn.classList.toggle("on", cur.best === btn.getAttribute("data-best")));
  }
  art.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const out = target.closest(".out");
    const letter = out ? out.getAttribute("data-letter") : "";
    if (target.hasAttribute("data-rate") && letter) {
      state[item.caseId].ratings[letter] = target.getAttribute("data-rate");
      save(); paint();
    }
    if (target.hasAttribute("data-flags") && out) {
      const pre = out.querySelector(".flags");
      if (pre) pre.classList.toggle("show");
      target.textContent = pre && pre.classList.contains("show") ? "הסתר סימונים" : "הצג סימונים";
    }
    if (target.hasAttribute("data-best")) {
      state[item.caseId].best = target.getAttribute("data-best");
      save(); paint();
    }
  });
  paint();
}
document.getElementById("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "zoe-review-choices.json";
  a.click();
});
</script>
</body>
</html>`;
  if (/claude-|haiku|sonnet/i.test(html)) throw new Error("review page leaked a model name");
  ensureOut();
  writeFileSync(path.join(OUT, "review.html"), html);
  console.log(`review.html cases ${pageCases.length}`);
}

async function main(): Promise<void> {
  const stage = process.argv[2] || "";
  console.log("anthropic key: " + (resolveClaudeApiKey() ? "set" : "missing"));
  if (stage === "classify") return stageClassify();
  if (stage === "mine") return stageMine();
  if (stage === "flag") return stageFlag();
  if (stage === "select") return stageSelect();
  if (stage === "rebuild") return stageRebuild();
  if (stage === "run") return stageRun();
  if (stage === "judge") return stageJudge();
  if (stage === "review") return stageReview();
  if (stage === "report") return stageReport();
  throw new Error("stage required: classify | mine | flag | select | rebuild | run | judge | review | report");
}

main().catch((error) => {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? maskPii(error.message) : "failed";
  if (name === "CreditAbort") {
    console.error("ABORT credit: " + message + ". Not recorded as a model failure. spent $" + spentSoFar().toFixed(4));
    process.exit(2);
  }
  if (name === "SpendAbort") {
    console.error("ABORT budget: " + message + ". spent $" + spentSoFar().toFixed(4));
    process.exit(3);
  }
  console.error(name + ": " + message);
  process.exit(1);
});
