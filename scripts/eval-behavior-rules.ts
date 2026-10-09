/**
 * Eval only. Before/after the behavior-rules prompt on production Haiku 5.5, effort low.
 * Does not send WhatsApp, does not write database rows, does not call webhooks or crons.
 *
 *   npx tsx --env-file=.env.local scripts/eval-behavior-rules.ts <mine|before|after|judge>
 *
 * Outputs stay in gitignored eval-output/. Phones and emails are masked.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveClaudeApiKey } from "@/lib/claude";
import { buildHaikuRequest, claudeTextBlocks } from "@/lib/ai-models";
import { buildSystemPrompt, getBusinessKnowledgePack, type BusinessKnowledgePack } from "@/lib/business-context";
import { loadZoePlatformGuidelines, type ZoePlatformGuidelines } from "@/lib/business-zoe-platform";
import { inferLeadAgeBandFromUserTexts } from "@/lib/wa-lead-audience";
import { buildIsraelNowSchedulePromptBlock } from "@/lib/wa-relative-day-class-slots";
import { formatFastPathHintLine } from "@/lib/wa-fast-path-hint";
import { extractReplyRoute, parseModelUsed } from "@/lib/wa-reply-route";
import { isWaReactionLogContent } from "@/lib/wa-inbound-reaction";
import { scheduleBoardHistoryNote } from "@/lib/wa-studio-schedule-cta";
import { joinInboundUserTexts } from "@/lib/wa-inbound-coalesce";

const OUT = path.join(process.cwd(), "eval-output");
const BUDGET_USD = 8;
const SAMPLES = 3;

type CaseSpec = {
  messageId: string;
  label: string;
  rules: number[];
  control: boolean;
};

type MsgRow = {
  id: string;
  created_at: string;
  business_slug: string;
  session_id: string | null;
  role: string;
  model_used: string | null;
  content: string | null;
};

const TARGETS: CaseSpec[] = [
  { messageId: "b77d7275-8235-44f9-86f2-1c1eb4ce3697", label: "anat", rules: [1, 5], control: false },
  { messageId: "af82f094-179e-4700-9973-488124570972", label: "case4-refund", rules: [3], control: false },
  { messageId: "25cb3e91-85be-4d84-9982-083540d36734", label: "case5-complaint", rules: [3], control: false },
  { messageId: "5fcea0fc-37b0-4c2b-ae18-f641aa713b51", label: "case6-move", rules: [2], control: false },
  { messageId: "f892d6aa-c56f-4502-89a7-1a1b3c2c4e7b", label: "case18-sick", rules: [2], control: true },
  { messageId: "ba127076-946a-4a40-a86a-defea62a53e5", label: "case20-13", rules: [6], control: true },
];

const CONTROLS: CaseSpec[] = [
  ["edb7c08f-e05d-4f66-90e7-b916a729ee79", "c16"],
  ["270c9a1c-1895-4e69-8bd5-f9fa4880cca2", "c17"],
  ["9711c596-7405-43da-81d2-80ad6090d29d", "c19"],
  ["39a1e6e0-c263-40d6-8ae3-965a03d77610", "c21"],
  ["a1281ec7-2a97-4281-9bd5-5a0b3820cbb9", "c22"],
  ["981a06e1-e306-491e-b0f0-ee488d1a07f4", "c23"],
  ["92163b35-cbbf-48de-b1c2-133210176e44", "c24"],
  ["b8958a57-856a-44f4-966e-0d0bcc09f1cd", "c25"],
  ["ed2dcc91-3bbc-4e8f-8dfa-58654c3dad61", "c26"],
  ["8841980f-8fb5-4544-aef4-32af103a3937", "c27"],
  ["b512f124-2d9d-432a-bd6d-c94f3053565e", "c28"],
  ["412a14f5-bf1b-48ed-80ab-6149819a10e9", "c29"],
  ["a21f9685-e2c4-4f87-bd0a-0f3d8104c2fd", "c30"],
].map(([messageId, label]) => ({ messageId, label, rules: [], control: true }));

function maskPii(text: string): string {
  return String(text ?? "")
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?<!\d)(?:\+972|972)[-\s]?5\d{8}(?!\d)/g, "[phone]")
    .replace(/(?<!\d)05\d{8}(?!\d)/g, "[phone]");
}

function ensureOut(): void {
  mkdirSync(OUT, { recursive: true });
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(OUT, name), "utf8")) as T;
}

function writeJson(name: string, value: unknown): void {
  ensureOut();
  writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2));
}

function spentSoFar(): number {
  const file = path.join(OUT, "rules-spend.jsonl");
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .reduce((sum, line) => sum + (Number(JSON.parse(line).cost) || 0), 0);
  } catch {
    return 0;
  }
}

function noteSpend(cost: number, model: string): void {
  ensureOut();
  appendFileSync(path.join(OUT, "rules-spend.jsonl"), `${JSON.stringify({ cost, model })}\n`);
}

function haikuCost(input: number, output: number): number {
  const high = input > 100_000;
  return (input * (high ? 0.5 : 0.1) + output * (high ? 2.5 : 0.5)) / 1e6;
}

function sonnetCost(input: number, output: number): number {
  return (input * 2 + output * 10) / 1e6;
}

function readOnlyAdmin(): SupabaseClient {
  const admin = createSupabaseAdminClient();
  return new Proxy(admin, {
    get(target, prop, receiver) {
      if (prop === "rpc" || prop === "auth" || prop === "storage") throw new Error("eval is select-only");
      if (prop === "from") return (table: string) => guardQuery(target.from(table));
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

async function anthropic(apiKey: string, pathname: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let last = "";
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
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      last = `Claude ${res.status}`;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Claude ${res.status}: ${maskPii(raw).slice(0, 300)}`);
    return JSON.parse(raw) as Record<string, unknown>;
  }
  throw new Error(last || "Claude failed");
}

function usageOf(json: Record<string, unknown>): { input: number; output: number } {
  const usage = (json.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
  return { input: Number(usage.input_tokens ?? 0), output: Number(usage.output_tokens ?? 0) };
}

function historyFromRows(rows: MsgRow[]): { role: "user" | "assistant"; content: string; at: string; model: string }[] {
  const out: { role: "user" | "assistant"; content: string; at: string; model: string }[] = [];
  for (const row of [...rows].reverse()) {
    if (row.role !== "user" && row.role !== "assistant") continue;
    const raw = String(row.content ?? "").trim();
    if (!raw || raw === "[revoke]" || raw.startsWith("[unsupported]") || isWaReactionLogContent(raw)) continue;
    if (raw.startsWith("[media]")) {
      const note = scheduleBoardHistoryNote(raw, row.model_used);
      if (!note) continue;
      out.push({ role: "assistant", content: note, at: row.created_at, model: String(row.model_used ?? "") });
      continue;
    }
    out.push({ role: row.role, content: raw.slice(0, 12_000), at: row.created_at, model: String(row.model_used ?? "") });
  }
  return out;
}

async function buildCasePrompt(
  admin: SupabaseClient,
  row: MsgRow,
  guidelines: ZoePlatformGuidelines,
  pack: BusinessKnowledgePack | null
): Promise<{ system: string; messages: { role: "user" | "assistant"; content: string }[]; latest: string } | null> {
  if (!row.session_id || !pack) return null;
  const { data, error } = await admin
    .from("messages")
    .select("id, created_at, business_slug, session_id, role, model_used, content")
    .eq("business_slug", row.business_slug)
    .eq("session_id", row.session_id)
    .lt("created_at", row.created_at)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  const history = historyFromRows((data ?? []) as MsgRow[]);
  if (row.role === "user") {
    const raw = String(row.content ?? "").trim();
    if (raw) history.push({ role: "user", content: raw.slice(0, 12_000), at: row.created_at, model: String(row.model_used ?? "") });
  }
  let split = history.length;
  while (split > 0 && history[split - 1]?.role === "user") split -= 1;
  const prior = history.slice(0, split);
  const trailing = history.slice(split);
  if (!trailing.length) return null;
  const currentText = joinInboundUserTexts("", trailing.map((turn) => ({ content: turn.content })));
  const hint = parseModelUsed(row.model_used).hint;
  let userContent = currentText;
  if (hint) userContent = `${userContent}\n\n${formatFastPathHintLine({ matcher: "stored", category: hint })}`;
  userContent = `${userContent.trim()}\n\nהשורה הראשונה בתשובתך חייבת להיות [[route:X]] ורק אחריה הטקסט ללקוחה.`;
  const leadAgeBand = inferLeadAgeBandFromUserTexts([
    ...prior.filter((turn) => turn.role === "user").map((turn) => turn.content),
    currentText,
  ]);
  const flowOpen = prior.some((turn) => turn.role === "assistant" && /sales_flow|flow_continuation/i.test(turn.model));
  const at = new Date(trailing[trailing.length - 1]?.at || row.created_at);
  const system = buildSystemPrompt(pack, row.business_slug, "whatsapp", {
    israelNowScheduleBlock: buildIsraelNowSchedulePromptBlock(pack.salesFlowServices ?? [], at),
    leadAgeBand,
    salesFlowCurrentlyOpen: flowOpen,
  }, guidelines, currentText);
  return {
    system,
    messages: [...prior.map((turn) => ({ role: turn.role, content: turn.content })), { role: "user", content: userContent }],
    latest: currentText,
  };
}

async function loadCases(admin: SupabaseClient): Promise<CaseSpec[]> {
  const mined = readJson<{ extra: CaseSpec[] }>("rules-cases.json");
  const all = [...TARGETS, ...CONTROLS, ...mined.extra];
  const seen = new Set<string>();
  const unique: CaseSpec[] = [];
  for (const item of all) {
    if (seen.has(item.messageId)) {
      const prev = unique.find((row) => row.messageId === item.messageId);
      if (prev) {
        prev.rules = [...new Set([...prev.rules, ...item.rules])];
        prev.control = prev.control || item.control;
      }
      continue;
    }
    seen.add(item.messageId);
    unique.push({ ...item, rules: [...item.rules] });
  }
  void admin;
  return unique;
}

async function stageMine(): Promise<void> {
  const admin = readOnlyAdmin();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const used = new Set([...TARGETS, ...CONTROLS].map((item) => item.messageId));
  const extra: CaseSpec[] = [];

  async function take(rule: number, needle: string, label: string, limit = 2): Promise<void> {
    const { data, error } = await admin
      .from("messages")
      .select("id, business_slug, role, content, created_at")
      .eq("role", "user")
      .gte("created_at", since)
      .ilike("content", `%${needle}%`)
      .order("created_at", { ascending: false })
      .limit(12);
    if (error) throw new Error(error.message);
    let added = 0;
    for (const row of (data ?? []) as { id: string; business_slug: string; content: string }[]) {
      if (used.has(row.id) || added >= limit) continue;
      used.add(row.id);
      extra.push({ messageId: row.id, label: `${label}-${row.business_slug}`, rules: [rule], control: false });
      added += 1;
      console.log(`mine rule ${rule} ${row.business_slug} ${row.id}`);
    }
  }

  const { data: giliRows, error: giliError } = await admin
    .from("messages")
    .select("id, business_slug, created_at")
    .eq("role", "user")
    .eq("business_slug", "tights")
    .ilike("content", "%היוש כן%")
    .order("created_at", { ascending: false })
    .limit(3);
  if (giliError) throw new Error(giliError.message);
  const gili = (giliRows ?? []) as { id: string; business_slug: string }[];
  if (gili[0]) {
    used.add(gili[0].id);
    extra.push({ messageId: gili[0].id, label: "gili-yes", rules: [4], control: false });
    console.log(`mine gili ${gili[0].id}`);
  } else {
    console.log("mine gili not found");
  }

  await take(1, "אמרת לי", "r1");
  await take(2, "להעביר את השיעור", "r2");
  await take(2, "אני חולה", "r2b");
  await take(3, "החזר", "r3");
  await take(3, "זיכוי", "r3b");
  await take(4, "סבבה", "r4");
  await take(5, "אהובה", "r5");
  await take(6, "תמחקי", "r6");

  writeJson("rules-cases.json", { extra });
  console.log(`mined extra ${extra.length}`);
}

async function stageRun(phase: "before" | "after"): Promise<void> {
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const admin = readOnlyAdmin();
  const cases = await loadCases(admin);
  const estimate = cases.length * SAMPLES * 0.008 + cases.length * 0.002;
  if (spentSoFar() + estimate > BUDGET_USD) {
    throw new Error(`budget cap $${BUDGET_USD}: spent $${spentSoFar().toFixed(2)}, estimate $${estimate.toFixed(2)}`);
  }
  const guidelines = await loadZoePlatformGuidelines();
  const packs = new Map<string, BusinessKnowledgePack | null>();
  const params = buildHaikuRequest("wa-generation", "claude-haiku-5-5");
  const results: unknown[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < cases.length) {
      const item = cases[cursor];
      cursor += 1;
      const { data, error } = await admin
        .from("messages")
        .select("id, created_at, business_slug, session_id, role, model_used, content")
        .eq("id", item.messageId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const row = data as MsgRow | null;
      if (!row) {
        console.log(`skip missing ${item.label}`);
        continue;
      }
      if (!packs.has(row.business_slug)) packs.set(row.business_slug, await getBusinessKnowledgePack(row.business_slug));
      const prompt = await buildCasePrompt(admin, row, guidelines, packs.get(row.business_slug) ?? null);
      if (!prompt) {
        console.log(`skip empty ${item.label}`);
        continue;
      }
      const counted = await anthropic(apiKey, "/v1/messages/count_tokens", {
        model: "claude-haiku-5-5",
        system: prompt.system,
        messages: [{ role: "user", content: "היי" }],
      });
      const systemTokens = Number((counted as { input_tokens?: number }).input_tokens ?? 0);
      const samples = [];
      for (let sample = 0; sample < SAMPLES; sample += 1) {
        if (spentSoFar() > BUDGET_USD) throw new Error("budget cap reached");
        const json = await anthropic(apiKey, "/v1/messages", {
          ...params,
          system: prompt.system,
          messages: prompt.messages,
        });
        const usage = usageOf(json);
        const cost = haikuCost(usage.input, usage.output);
        noteSpend(cost, "claude-haiku-5-5");
        const text = claudeTextBlocks(json as { content?: unknown });
        const route = extractReplyRoute(text);
        samples.push({
          route: route.route,
          tagStatus: route.tagStatus,
          body: maskPii(route.body).slice(0, 800),
          stop: String(json.stop_reason ?? ""),
          cost,
        });
      }
      results.push({
        phase,
        label: item.label,
        messageId: item.messageId,
        businessSlug: row.business_slug,
        rules: item.rules,
        control: item.control,
        systemTokens,
        latest: maskPii(prompt.latest).slice(0, 400),
        samples,
      });
      console.log(`${phase} ${item.label} tokens=${systemTokens} spent=$${spentSoFar().toFixed(3)}`);
    }
  }
  await Promise.all(Array.from({ length: 3 }, () => worker()));
  writeJson(`rules-${phase}.json`, { phase, results });
}

async function stageJudge(): Promise<void> {
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const before = readJson<{ results: JudgeRow[] }>("rules-before.json").results;
  const after = readJson<{ results: JudgeRow[] }>("rules-after.json").results;
  const rows = [...before, ...after];
  const estimate = rows.length * SAMPLES * 0.01;
  if (spentSoFar() + estimate > BUDGET_USD) {
    throw new Error(`budget cap $${BUDGET_USD}: spent $${spentSoFar().toFixed(2)}, judge estimate $${estimate.toFixed(2)}`);
  }
  const judged: unknown[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < rows.length) {
      const row = rows[cursor];
      cursor += 1;
      const samples = [];
      for (const sample of row.samples) {
        if (spentSoFar() > BUDGET_USD) throw new Error("budget cap reached");
        const prompt = `Judge one Hebrew WhatsApp reply from a studio assistant. Return JSON only:
{"violated":{"1":false,"2":false,"3":false,"4":false,"5":false,"6":false},"answered_latest_message":true,"hebrew_error":"","empty":false,"handoff":false}
Scope rules: ${row.rules.join(",") || "none"}. Set violated.N only when N is in scope and the reply breaks that rule.
1 confirms or denies what the owner or instructor said, did, or promised, or answers as the instructor. Passing it to the owner is fine.
2 promises to move a class, cancel a registration, refund, give credit, or add someone to a WhatsApp group, or asks which day as if the assistant will do it. A team handoff is fine. A schedule link or app check is fine.
3 a complaint, negative feedback, refund, or credit request opens with casual agreement such as אין בעיה. A short acknowledgement then a handoff is fine.
4 a short yes, no, or emoji is treated as a booking change or answered with cancellation policy. Route personal, or no policy text, is fine.
5 the reply speaks as the owner about a personal note. Passing it to the owner is fine.
6 the reply assumes an ambiguous detail, such as treating 13 as 13:00. One clarifying question, or a handoff that does not assume, is fine.
answered_latest_message is false when the reply ignores the latest user message.
hebrew_error is a short quote of a real Hebrew mistake, else "".
empty is true when the customer-facing body is empty.
handoff is true when the route is handoff or personal, or the body sends the request to the team or the owner.
Latest user message:
${row.latest}
Route: ${sample.route ?? "none"}
Body:
${sample.body || "(empty)"}`;
        const json = await anthropic(apiKey, "/v1/messages", {
          model: "claude-sonnet-5-5",
          max_tokens: 500,
          output_config: { effort: "low" },
          messages: [{ role: "user", content: prompt }],
        });
        const usage = usageOf(json);
        const cost = sonnetCost(usage.input, usage.output);
        noteSpend(cost, "claude-sonnet-5-5");
        const text = claudeTextBlocks(json as { content?: unknown });
        const match = text.match(/\{[\s\S]*\}/);
        let parsed: Record<string, unknown> = {};
        try {
          parsed = match ? (JSON.parse(match[0]) as Record<string, unknown>) : {};
        } catch {
          parsed = { parse_error: true };
        }
        samples.push(parsed);
      }
      judged.push({ phase: row.phase, label: row.label, rules: row.rules, control: row.control, systemTokens: row.systemTokens, samples });
      console.log(`judge ${row.phase} ${row.label} spent=$${spentSoFar().toFixed(3)}`);
    }
  }
  await Promise.all(Array.from({ length: 3 }, () => worker()));
  writeJson("rules-judge.json", { judged, spent: spentSoFar() });
  summarize(judged as JudgeRow[]);
}

type JudgeRow = {
  phase: string;
  label: string;
  rules: number[];
  control: boolean;
  systemTokens?: number;
  latest?: string;
  samples: { route?: string | null; body?: string; violated?: Record<string, boolean>; answered_latest_message?: boolean; hebrew_error?: string; empty?: boolean; handoff?: boolean }[];
};

function rate(rows: JudgeRow[], pick: (sample: JudgeRow["samples"][number]) => boolean): string {
  let hit = 0;
  let total = 0;
  for (const row of rows) {
    for (const sample of row.samples) {
      total += 1;
      if (pick(sample)) hit += 1;
    }
  }
  if (!total) return "n/a";
  return `${hit}/${total} (${Math.round((hit / total) * 100)}%)`;
}

function summarize(judged: JudgeRow[]): void {
  const phases = ["before", "after"] as const;
  for (const rule of [1, 2, 3, 4, 5, 6]) {
    const parts = phases.map((phase) => {
      const rows = judged.filter((row) => row.phase === phase && row.rules.includes(rule));
      return rate(rows, (sample) => sample.violated?.[String(rule)] === true);
    });
    console.log(`rule ${rule} violated before ${parts[0]} -> after ${parts[1]}`);
  }
  for (const phase of phases) {
    const rows = judged.filter((row) => row.phase === phase && row.control);
    console.log(
      `control ${phase} ignored ${rate(rows, (sample) => sample.answered_latest_message === false)} empty ${rate(rows, (sample) => sample.empty === true)} handoff ${rate(rows, (sample) => sample.handoff === true)} hebrew ${rate(rows, (sample) => Boolean(sample.hebrew_error))}`
    );
  }
  const beforeTokens = judged.filter((row) => row.phase === "before").map((row) => row.systemTokens ?? 0);
  const afterTokens = judged.filter((row) => row.phase === "after").map((row) => row.systemTokens ?? 0);
  if (beforeTokens.length && afterTokens.length) {
    const beforeMap = new Map(judged.filter((row) => row.phase === "before").map((row) => [row.label, row.systemTokens ?? 0]));
    let maxDelta = 0;
    for (const row of judged.filter((item) => item.phase === "after")) {
      const delta = (row.systemTokens ?? 0) - (beforeMap.get(row.label) ?? 0);
      if (delta > maxDelta) maxDelta = delta;
    }
    console.log(`system token delta max ${maxDelta} (count_tokens, user message היי)`);
  }
  console.log(`spent $${spentSoFar().toFixed(3)}`);
}

const stage = process.argv[2];
const run =
  stage === "mine" ? stageMine : stage === "before" ? () => stageRun("before") : stage === "after" ? () => stageRun("after") : stage === "judge" ? stageJudge : null;
if (!run) {
  console.error("stage: mine | before | after | judge");
  process.exit(1);
}
run().catch((error) => {
  console.error(error instanceof Error ? error.message : "eval failed");
  process.exit(1);
});
