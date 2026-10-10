/**
 * Eval only. Same history pipeline on both sides. Hints are recomputed by the
 * checked-out code. Does not send WhatsApp, write rows, or call webhooks.
 *
 *   EVAL_OUT=... npx tsx --env-file=.env.local scripts/eval-clean-ab.ts run <before|after>
 *   EVAL_OUT=... npx tsx --env-file=.env.local scripts/eval-clean-ab.ts judge
 *   EVAL_OUT=... npx tsx --env-file=.env.local scripts/eval-clean-ab.ts segment
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveClaudeApiKey } from "@/lib/claude";
import { buildHaikuRequest, claudeTextBlocks } from "@/lib/ai-models";
import { buildSystemPrompt, getBusinessKnowledgePack, type BusinessKnowledgePack } from "@/lib/business-context";
import { loadZoePlatformGuidelines } from "@/lib/business-zoe-platform";
import { inferLeadAgeBandFromUserTexts } from "@/lib/wa-lead-audience";
import { buildIsraelNowSchedulePromptBlock } from "@/lib/wa-relative-day-class-slots";
import { collectPreClaudeHint } from "@/lib/wa-pre-claude-hint";
import { formatFastPathHintLine } from "@/lib/wa-fast-path-hint";
import { extractReplyRoute } from "@/lib/wa-reply-route";
import { joinInboundUserTexts } from "@/lib/wa-inbound-coalesce";

const OUT = process.env.EVAL_OUT?.trim() || path.join(process.cwd(), "eval-output");
const BUDGET = 5.5;
const SAMPLES = 5;
const CASES: { id: string; label: string; control: boolean }[] = [
  { id: "4c4d68d5-4078-4d1e-9c4d-49c1b0fbb39f", label: "tali-ask", control: false },
  { id: "deee9b4a-4c95-45e4-ab87-34fb7a7160f4", label: "gili", control: false },
  { id: "b6fcceea-c5f1-411d-8a09-b92bff1365bd", label: "tali-pick", control: false },
  { id: "a94c5924-9cd9-4bb1-912a-b7f3756330c7", label: "rotem", control: false },
  { id: "df7c0bc2-7abd-48e3-8431-4504d7bd62e9", label: "misfire-1", control: false },
  { id: "9b5607fd-99f0-47b4-98ba-ba2cb4684900", label: "misfire-2", control: false },
  { id: "9a5ea0a3-f331-4174-a7a1-6052b6075f12", label: "misfire-3", control: false },
  { id: "f93b3dfc-9a31-40c5-825c-99a2c966dfc7", label: "misfire-4", control: false },
  { id: "2484075a-73f4-4817-9135-f5fb38cd90f2", label: "misfire-5", control: false },
  { id: "e81b45ac-b532-40de-93ca-97c86fde28a7", label: "misfire-6", control: false },
  { id: "13ab1453-00a9-440a-b9b6-9e8cdc790bc2", label: "misfire-7", control: false },
  { id: "2c2bbdfe-f028-4dc2-affc-90283639a087", label: "misfire-8", control: false },
  { id: "53a29095-98cf-4c0a-9e06-928beb68154e", label: "misfire-9", control: false },
  { id: "7e74ab62-e887-43a2-8aac-6aa7d53631b7", label: "misfire-10", control: false },
  { id: "edb7c08f-e05d-4f66-90e7-b916a729ee79", label: "c1", control: true },
  { id: "270c9a1c-1895-4e69-8bd5-f9fa4880cca2", label: "c2", control: true },
  { id: "9711c596-7405-43da-81d2-80ad6090d29d", label: "c3", control: true },
  { id: "39a1e6e0-c263-40d6-8ae3-965a03d77610", label: "c4", control: true },
  { id: "a1281ec7-2a97-4281-9bd5-5a0b3820cbb9", label: "c5", control: true },
  { id: "981a06e1-e306-491e-b0f0-ee488d1a07f4", label: "c6", control: true },
  { id: "92163b35-cbbf-48de-b1c2-133210176e44", label: "c7", control: true },
  { id: "b8958a57-856a-44f4-966e-0d0bcc09f1cd", label: "c8", control: true },
  { id: "ed2dcc91-3bbc-4e8f-8dfa-58654c3dad61", label: "c9", control: true },
  { id: "8841980f-8fb5-4544-aef4-32af103a3937", label: "c10", control: true },
  { id: "b512f124-2d9d-432a-bd6d-c94f3053565e", label: "c11", control: true },
  { id: "412a14f5-bf1b-48ed-80ab-6149819a10e9", label: "c12", control: true },
  { id: "a21f9685-e2c4-4f87-bd0a-0f3d8104c2fd", label: "c13", control: true },
  { id: "f892d6aa-c56f-4502-89a7-1a1b3c2c4e7b", label: "c14", control: true },
  { id: "ba127076-946a-4a40-a86a-defea62a53e5", label: "c15", control: true },
];

type Msg = {
  id: string;
  created_at: string;
  business_slug: string;
  session_id: string | null;
  role: string;
  model_used: string | null;
  content: string | null;
};

type Sample = { route: string | null; body: string; hint: string | null };
type RunRow = { label: string; control: boolean; latest: string; samples: Sample[] };

function mask(text: string): string {
  return String(text ?? "")
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?<!\d)(?:\+972|972|0)\d(?:[-\s]?\d){7,8}(?!\d)/g, "[phone]")
    .replace(/\s+/g, " ")
    .trim();
}

function spent(): number {
  let total = 0;
  for (const name of ["ab-spend-before.jsonl", "ab-spend-after.jsonl", "ab-spend-segment.jsonl", "ab-spend-fix.jsonl"]) {
    try {
      total += readFileSync(path.join(OUT, name), "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .reduce((sum, line) => sum + (Number(JSON.parse(line).cost) || 0), 0);
    } catch {
      /* missing */
    }
  }
  return total;
}

function note(file: string, cost: number, model: string): void {
  mkdirSync(OUT, { recursive: true });
  appendFileSync(path.join(OUT, file), `${JSON.stringify({ cost, model })}\n`);
}

function haikuCost(input: number, output: number): number {
  return (input * 0.1 + output * 0.5) / 1e6;
}

function sonnetCost(input: number, output: number): number {
  return (input * 2 + output * 10) / 1e6;
}

function usageOf(json: Record<string, unknown>): { input: number; output: number } {
  const usage = (json.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
  return { input: Number(usage.input_tokens ?? 0), output: Number(usage.output_tokens ?? 0) };
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
      await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Claude ${res.status}: ${mask(raw).slice(0, 240)}`);
    return JSON.parse(raw) as Record<string, unknown>;
  }
  throw new Error(last || "Claude failed");
}

async function deliver(input: {
  body: string;
  route: string | null;
  text: string;
  prior: string;
  hint: string | null;
  pack: BusinessKnowledgePack;
  at: Date;
}): Promise<string> {
  const mod = await import("@/lib/wa-lead-day-trial");
  if (typeof mod.explicitClassChoiceApplies !== "function") return input.body;
  const addressing = await import("@/lib/wa-assistant-reply-fixes");
  const services = input.pack.salesFlowServices ?? [];
  const choice = mod.resolveExplicitClassChoice({
    text: input.text,
    services,
    now: input.at,
    priorText: input.prior,
  });
  const trialAsk = Boolean(
    mod.resolveLeadDayTrialAsk({ text: input.text, arboxIsMember: false, trialRegistered: false, now: input.at })
  );
  if (
    mod.explicitClassChoiceApplies({
      route: input.route,
      choice,
      trialAsk,
      hintCategory: input.hint,
      text: input.text,
    })
  ) {
    const plan = mod.explicitChoiceReply({
      choice,
      addressingMode: addressing.resolveWaReplyAddressingMode(input.pack),
      hasTrialSignup: Boolean(input.pack.salesFlowConfig || input.pack.ctaLink?.trim()),
    });
    if (plan.action === "confirm") {
      return `מהמם! נדאג לשבץ אותך ל${plan.slot.serviceName} ביום ${plan.slot.dayName} בשעה ${plan.slot.time}`;
    }
    if (plan.action === "text") return plan.text;
  }
  if (choice.kind === "day_only" && input.route === "schedule") {
    return mod.buildLeadDayTrialOfferReply({ day: choice.day, services, now: input.at }) ?? input.body;
  }
  return input.body;
}

async function runPhase(phase: "before" | "after" | "segment" | "fix"): Promise<void> {
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const admin = createSupabaseAdminClient();
  const guidelines = await loadZoePlatformGuidelines();
  const params = buildHaikuRequest("wa-generation", "claude-haiku-5-5");
  const packs = new Map<string, BusinessKnowledgePack | null>();
  const spendFile = phase === "segment" ? "ab-spend-segment.jsonl" : `ab-spend-${phase}.jsonl`;
  const results: RunRow[] = [];
  const only = (process.env.AB_ONLY ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const cases = only.length ? CASES.filter((item) => only.includes(item.label)) : CASES;
  const segment = phase === "segment";
  for (const item of cases) {
    if (spent() > BUDGET) throw new Error("budget cap");
    const { data, error } = await admin
      .from("messages")
      .select("id, created_at, business_slug, session_id, role, model_used, content")
      .eq("id", item.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as Msg | null;
    if (!row?.session_id) {
      console.log(`skip ${item.label}`);
      continue;
    }
    if (!packs.has(row.business_slug)) packs.set(row.business_slug, await getBusinessKnowledgePack(row.business_slug));
    const pack = packs.get(row.business_slug);
    if (!pack) continue;
    const { data: historyRows, error: historyError } = await admin
      .from("messages")
      .select("id, created_at, role, model_used, content")
      .eq("business_slug", row.business_slug)
      .eq("session_id", row.session_id)
      .lt("created_at", row.created_at)
      .order("created_at", { ascending: false })
      .limit(10);
    if (historyError) throw new Error(historyError.message);
    const history = ((historyRows ?? []) as Msg[]).slice().reverse().filter((turn) => turn.role === "user" || turn.role === "assistant");
    history.push(row);
    let splitAt = history.length;
    while (splitAt > 0 && history[splitAt - 1]?.role === "user") splitAt -= 1;
    const prior = history.slice(0, splitAt);
    const trailing = history.slice(splitAt);
    const joined = joinInboundUserTexts("", trailing.map((turn) => ({ content: String(turn.content ?? "") })));
    const promptText = joined;
    const latest = joined;
    if (segment) {
      throw new Error("time-gap segmentation was measured and not shipped");
    }
    const hint = collectPreClaudeHint(latest)?.category ?? null;
    const hintLine = hint ? formatFastPathHintLine({ matcher: "stored", category: hint }) : "";
    const userContent = `${promptText.trim()}${hintLine ? `\n\n${hintLine}` : ""}\n\nהשורה הראשונה בתשובתך חייבת להיות [[route:X]] ורק אחריה הטקסט ללקוחה.`;
    const at = new Date(row.created_at);
    const system = buildSystemPrompt(
      pack,
      row.business_slug,
      "whatsapp",
      {
        israelNowScheduleBlock: buildIsraelNowSchedulePromptBlock(pack.salesFlowServices ?? [], at),
        leadAgeBand: inferLeadAgeBandFromUserTexts([...prior.filter((turn) => turn.role === "user").map((turn) => String(turn.content ?? "")), latest]),
        salesFlowCurrentlyOpen: prior.some((turn) => turn.role === "assistant" && /sales_flow|flow_continuation/i.test(String(turn.model_used ?? ""))),
      },
      guidelines,
      latest
    );
    const messages = [
      ...prior.map((turn) => ({ role: turn.role as "user" | "assistant", content: String(turn.content ?? "").slice(0, 4000) })),
      { role: "user" as const, content: userContent },
    ];
    const samples: Sample[] = [];
    for (let sample = 0; sample < SAMPLES; sample += 1) {
      if (spent() > BUDGET) throw new Error("budget cap");
      const json = await anthropic(apiKey, "/v1/messages", { ...params, system, messages });
      const usage = usageOf(json);
      note(spendFile, haikuCost(usage.input, usage.output), "claude-haiku-5-5");
      const parsed = extractReplyRoute(claudeTextBlocks(json as { content?: unknown }));
      const body =
        phase === "before"
          ? parsed.body
          : await deliver({
              body: parsed.body,
              route: parsed.route,
              text: latest,
              prior: String([...prior].reverse().find((turn) => turn.role === "user")?.content ?? ""),
              hint,
              pack,
              at,
            });
      samples.push({ route: parsed.route, body: mask(body).slice(0, 700), hint });
    }
    results.push({ label: item.label, control: item.control, latest: mask(latest).slice(0, 400), samples });
    console.log(`ran ${phase} ${item.label} spent $${spent().toFixed(4)}`);
  }
  writeFileSync(path.join(OUT, `ab-runs-${phase}.json`), JSON.stringify({ results }, null, 2));
}

type Judge = {
  answered_latest_message: boolean;
  honored_explicit_choice: boolean;
  wrong_list_or_link: boolean;
  empty: boolean;
  hebrew_error: string;
};

async function judgeFile(phase: string): Promise<void> {
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const file = JSON.parse(readFileSync(path.join(OUT, `ab-runs-${phase}.json`), "utf8")) as { results: RunRow[] };
  const judged = [];
  for (const row of file.results) {
    const samples = [];
    for (const sample of row.samples) {
      if (spent() > BUDGET) throw new Error("budget cap");
      let parsed: Judge | null = null;
      for (let attempt = 0; attempt < 3 && !parsed; attempt += 1) {
        const json = await anthropic(apiKey, "/v1/messages", {
        model: "claude-sonnet-5-5",
        max_tokens: 800,
          output_config: { effort: "low" },
          messages: [
            {
              role: "user",
              content: `Judge one Hebrew WhatsApp reply. JSON only, no markdown:
{"answered_latest_message":true,"honored_explicit_choice":true,"wrong_list_or_link":false,"empty":false,"hebrew_error":""}
honored_explicit_choice is true when the latest message did not name a class, day, or time, or when the reply confirms that choice or asks one short question about it. It is false when the reply ignores a named day, time, or class.
wrong_list_or_link is true when the reply sends a full timetable or a generic schedule link after the lead already named a slot or a class.
hebrew_error is a short quote of a real Hebrew mistake, else "".
Latest:
${row.latest}
Reply:
${sample.body}`,
            },
          ],
        });
        const usage = usageOf(json);
        note(`ab-spend-${phase}.jsonl`, sonnetCost(usage.input, usage.output), "claude-sonnet-5-5");
        const text = claudeTextBlocks(json as { content?: unknown });
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start < 0 || end <= start) continue;
        try {
          parsed = JSON.parse(text.slice(start, end + 1)) as Judge;
        } catch {
          parsed = null;
        }
      }
      if (!parsed) {
        console.warn(`judge fallback ${row.label}`);
        parsed = {
          answered_latest_message: false,
          honored_explicit_choice: false,
          wrong_list_or_link: false,
          empty: false,
          hebrew_error: "judge_failed",
        };
      }
      samples.push({ ...sample, ...parsed });
    }
    judged.push({ label: row.label, control: row.control, latest: row.latest, samples });
    writeFileSync(path.join(OUT, `ab-judge-${phase}.json`), JSON.stringify({ judged }, null, 2));
    console.log(`judged ${phase} ${row.label} spent $${spent().toFixed(4)}`);
  }
  writeFileSync(path.join(OUT, `ab-judge-${phase}.json`), JSON.stringify({ judged }, null, 2));
}

function missCount(samples: { answered_latest_message: boolean; honored_explicit_choice: boolean; wrong_list_or_link: boolean; empty: boolean; hebrew_error: string }[], key: "answered_latest_message" | "honored_explicit_choice" | "wrong_list_or_link" | "empty" | "hebrew_error"): number {
  return samples.filter((sample) => {
    if (key === "hebrew_error") return Boolean(String(sample.hebrew_error ?? "").trim());
    if (key === "wrong_list_or_link" || key === "empty") return sample[key] === true;
    return sample[key] !== true;
  }).length;
}

async function flips(): Promise<void> {
  const before = JSON.parse(readFileSync(path.join(OUT, "ab-judge-before.json"), "utf8")) as {
    judged: { label: string; control: boolean; latest: string; samples: Judge[] }[];
  };
  const after = JSON.parse(readFileSync(path.join(OUT, "ab-judge-after.json"), "utf8")) as {
    judged: { label: string; control: boolean; latest: string; samples: (Judge & { body: string })[] }[];
  };
  const beforeRuns = JSON.parse(readFileSync(path.join(OUT, "ab-runs-before.json"), "utf8")) as { results: RunRow[] };
  const keys = ["answered_latest_message", "honored_explicit_choice", "wrong_list_or_link", "empty", "hebrew_error"] as const;
  const lines = ["# A/B flips", "", "A flip is a metric the before code passed in a majority of samples and the after code missed in a majority.", ""];
  const byLabel = new Map(after.judged.map((row) => [row.label, row]));
  const beforeBody = new Map(beforeRuns.results.map((row) => [row.label, row]));
  for (const row of before.judged) {
    const next = byLabel.get(row.label);
    if (!next) continue;
    for (const key of keys) {
      const beforeMiss = missCount(row.samples, key);
      const afterMiss = missCount(next.samples, key);
      const majority = Math.floor(SAMPLES / 2) + 1;
      if (beforeMiss < majority && afterMiss >= majority) {
        lines.push(`## ${row.label} ${key}`);
        lines.push("");
        lines.push(`Latest: ${row.latest}`);
        lines.push("");
        lines.push(`Before misses ${beforeMiss}/${row.samples.length}, after misses ${afterMiss}/${next.samples.length}.`);
        lines.push("");
        const bodies = beforeBody.get(row.label);
        bodies?.samples.forEach((sample, index) => {
          lines.push(`- before ${index + 1}: ${sample.body}`);
        });
        next.samples.forEach((sample, index) => {
          lines.push(`- after ${index + 1}: ${sample.body}`);
        });
        lines.push("");
      }
    }
  }
  if (lines.length === 4) lines.push("No majority flips.");
  writeFileSync(path.join(OUT, "ab-flips.md"), lines.join("\n"));
  console.log(`flips written, spent $${spent().toFixed(4)}`);
}

async function main(): Promise<void> {
  const [cmd, phase] = process.argv.slice(2);
  if (cmd === "run" && (phase === "before" || phase === "after" || phase === "segment" || phase === "fix")) {
    await runPhase(phase);
    return;
  }
  if (cmd === "judge" && (phase === "before" || phase === "after" || phase === "segment" || phase === "fix")) {
    await judgeFile(phase);
    return;
  }
  if (cmd === "flips") {
    await flips();
    return;
  }
  throw new Error("usage: run|judge <before|after|segment|fix> | flips");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "eval failed");
  process.exit(1);
});
