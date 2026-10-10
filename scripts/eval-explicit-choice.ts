/**
 * Eval only. Before/after the hint wording and the explicit-slot builder.
 * Does not send WhatsApp, does not write database rows, does not call webhooks or crons.
 *
 *   npx tsx --env-file=.env.local scripts/eval-explicit-choice.ts <hints|run|judge>
 *
 * Spend is tracked in eval-output/choice-spend.jsonl. Cap $5.50.
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
import { extractReplyRoute, parseModelUsed } from "@/lib/wa-reply-route";
import { joinInboundUserTexts } from "@/lib/wa-inbound-coalesce";
import { resolveWaReplyAddressingMode } from "@/lib/wa-assistant-reply-fixes";
import {
  buildLeadDayTrialOfferReply,
  explicitChoiceReply,
  explicitClassChoiceApplies,
  resolveExplicitClassChoice,
  resolveLeadDayTrialAsk,
} from "@/lib/wa-lead-day-trial";

const OUT = path.join(process.cwd(), "eval-output");
const BUDGET = 5.5;
const SAMPLES = 3;
const OLD_HINT = (category: string) =>
  `Possible intent detected by keyword: ${category}. Verify against the conversation; it may be wrong.`;

const FIXED = [
  { id: "4c4d68d5-4078-4d1e-9c4d-49c1b0fbb39f", label: "tali-ask" },
  { id: "b6fcceea-0000-0000-0000-000000000000", label: "tali-pick-placeholder" },
  { id: "deee9b4a-4c95-45e4-ab87-34fb7a7160f4", label: "gili" },
];
const CONTROLS = [
  "edb7c08f-e05d-4f66-90e7-b916a729ee79",
  "270c9a1c-1895-4e69-8bd5-f9fa4880cca2",
  "9711c596-7405-43da-81d2-80ad6090d29d",
  "39a1e6e0-c263-40d6-8ae3-965a03d77610",
  "a1281ec7-2a97-4281-9bd5-5a0b3820cbb9",
  "981a06e1-e306-491e-b0f0-ee488d1a07f4",
  "92163b35-cbbf-48de-b1c2-133210176e44",
  "b8958a57-856a-44f4-966e-0d0bcc09f1cd",
  "ed2dcc91-3bbc-4e8f-8dfa-58654c3dad61",
  "8841980f-8fb5-4544-aef4-32af103a3937",
  "b512f124-2d9d-432a-bd6d-c94f3053565e",
  "412a14f5-bf1b-48ed-80ab-6149819a10e9",
  "a21f9685-e2c4-4f87-bd0a-0f3d8104c2fd",
  "f892d6aa-c56f-4502-89a7-1a1b3c2c4e7b",
  "ba127076-946a-4a40-a86a-defea62a53e5",
];

type CaseRow = { id: string; label: string; control: boolean };
type Msg = {
  id: string;
  created_at: string;
  business_slug: string;
  session_id: string | null;
  role: string;
  model_used: string | null;
  content: string | null;
};

function mask(text: string): string {
  return String(text ?? "")
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?<!\d)(?:\+972|972|0)\d(?:[-\s]?\d){7,8}(?!\d)/g, "[phone]");
}

function ensure(): void {
  mkdirSync(OUT, { recursive: true });
}

function spent(): number {
  try {
    return readFileSync(path.join(OUT, "choice-spend.jsonl"), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .reduce((sum, line) => sum + (Number(JSON.parse(line).cost) || 0), 0);
  } catch {
    return 0;
  }
}

function note(cost: number, model: string): void {
  ensure();
  appendFileSync(path.join(OUT, "choice-spend.jsonl"), `${JSON.stringify({ cost, model })}\n`);
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

async function anthropic(apiKey: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`anthropic ${res.status} ${mask(JSON.stringify(json.error ?? json)).slice(0, 240)}`);
  return json;
}

async function resolveCases(): Promise<CaseRow[]> {
  const admin = createSupabaseAdminClient();
  const cases: CaseRow[] = [{ id: FIXED[0]!.id, label: "tali-ask", control: false }, { id: FIXED[2]!.id, label: "gili", control: false }];
  const { data: pick } = await admin
    .from("messages")
    .select("id")
    .eq("business_slug", "omers-place")
    .eq("role", "user")
    .ilike("content", "Mom&baby%")
    .gte("created_at", "2026-10-09T00:00:00Z")
    .lt("created_at", "2026-10-10T00:00:00Z")
    .limit(1)
    .maybeSingle();
  if (pick?.id) cases.push({ id: String(pick.id), label: "tali-pick", control: false });
  const { data: rotemAssistant } = await admin
    .from("messages")
    .select("created_at, session_id")
    .eq("business_slug", "tshelgine-8774")
    .eq("role", "assistant")
    .like("model_used", "%hint=day_timetable%")
    .gte("created_at", "2026-10-08T20:00:00Z")
    .lt("created_at", "2026-10-08T21:00:00Z")
    .limit(1)
    .maybeSingle();
  if (rotemAssistant?.session_id) {
    const { data: rotemUser } = await admin
      .from("messages")
      .select("id")
      .eq("business_slug", "tshelgine-8774")
      .eq("session_id", rotemAssistant.session_id)
      .eq("role", "user")
      .lt("created_at", rotemAssistant.created_at)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rotemUser?.id) cases.push({ id: String(rotemUser.id), label: "rotem", control: false });
  }
  const judged = JSON.parse(readFileSync(path.join(OUT, "hint-misfire-judged.json"), "utf8")) as {
    judged?: { match?: boolean; user?: string; slug?: string }[];
  };
  let n = 0;
  for (const row of judged.judged ?? []) {
    if (row.match !== false || n >= 10 || !row.user || !row.slug) continue;
    const needle = row.user.replace(/\s+/g, " ").trim().slice(0, 24);
    const { data } = await admin
      .from("messages")
      .select("id")
      .eq("business_slug", row.slug)
      .eq("role", "user")
      .ilike("content", `${needle}%`)
      .gte("created_at", "2026-09-10T00:00:00Z")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data?.id || cases.some((item) => item.id === String(data.id))) continue;
    cases.push({ id: String(data.id), label: `misfire-${n + 1}`, control: false });
    n += 1;
  }
  CONTROLS.forEach((id, index) => cases.push({ id, label: `c${index + 1}`, control: true }));
  return cases;
}

function bodyOf(raw: string): { route: string | null; body: string } {
  const extracted = extractReplyRoute(raw);
  return { route: extracted.route, body: extracted.body.trim() };
}

function deliverAfter(input: {
  body: string;
  route: string | null;
  text: string;
  prior: string;
  hint: string | null;
  pack: BusinessKnowledgePack;
  at: Date;
}): string {
  const services = input.pack.salesFlowServices ?? [];
  const choice = resolveExplicitClassChoice({
    text: input.text,
    services,
    now: input.at,
    priorText: input.prior,
  });
  const trialAsk = Boolean(
    resolveLeadDayTrialAsk({ text: input.text, arboxIsMember: false, trialRegistered: false, now: input.at })
  );
  if (
    explicitClassChoiceApplies({
      route: input.route,
      choice,
      trialAsk,
      hintCategory: input.hint,
      text: input.text,
    })
  ) {
    const plan = explicitChoiceReply({
      choice,
      addressingMode: resolveWaReplyAddressingMode(input.pack),
      hasTrialSignup: Boolean(input.pack.salesFlowConfig || input.pack.ctaLink?.trim()),
    });
    if (plan.action === "confirm") {
      return `מהמם! נדאג לשבץ אותך ל${plan.slot.serviceName} ביום ${plan.slot.dayName} בשעה ${plan.slot.time}`;
    }
    if (plan.action === "text") return plan.text;
  }
  if (choice.kind === "day_only" && input.route === "schedule") {
    return buildLeadDayTrialOfferReply({ day: choice.day, services, now: input.at }) ?? input.body;
  }
  return input.body;
}

async function stageHints(): Promise<void> {
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const admin = createSupabaseAdminClient();
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data, error } = await admin
    .from("messages")
    .select("id, created_at, business_slug, session_id, model_used, content")
    .eq("role", "assistant")
    .gte("created_at", since)
    .like("model_used", "%hint=%")
    .order("created_at", { ascending: false })
    .limit(400);
  if (error) throw new Error(error.message);
  const byHint = new Map<string, Msg[]>();
  for (const row of (data ?? []) as Msg[]) {
    const hint = parseModelUsed(row.model_used).hint;
    if (!hint || hint === "day_timetable") continue;
    const list = byHint.get(hint) ?? [];
    if (list.length >= 8) continue;
    list.push(row);
    byHint.set(hint, list);
  }
  const judged: { hint: string; slug: string; match: boolean; user: string }[] = [];
  for (const [hint, rows] of byHint) {
    for (const row of rows) {
      if (spent() > BUDGET) throw new Error("budget cap");
      const { data: turns } = await admin
        .from("messages")
        .select("role, content, created_at")
        .eq("business_slug", row.business_slug)
        .eq("session_id", row.session_id)
        .lt("created_at", row.created_at)
        .order("created_at", { ascending: false })
        .limit(6);
      const latest = ((turns ?? []) as { role: string; content: string | null }[]).find((turn) => turn.role === "user");
      const window = ((turns ?? []) as { role: string; content: string | null }[])
        .slice()
        .reverse()
        .map((turn) => `${turn.role}: ${mask(String(turn.content ?? "")).slice(0, 280)}`)
        .join("\n");
      const json = await anthropic(apiKey, {
        model: "claude-haiku-5-5",
        max_tokens: 80,
        output_config: { effort: "low" },
        messages: [
          {
            role: "user",
            content: `Did the keyword category "${hint}" match what the lead meant in their LATEST message? Answer JSON only: {"match":true|false}\n\n${window}`,
          },
        ],
      });
      const usage = usageOf(json);
      note(haikuCost(usage.input, usage.output), "claude-haiku-5-5");
      const text = claudeTextBlocks(json as { content?: unknown });
      const match = /"match"\s*:\s*true/.test(text);
      judged.push({ hint, slug: row.business_slug, match, user: mask(String(latest?.content ?? "")).slice(0, 180) });
    }
  }
  const rates: Record<string, { n: number; misfire: number; rate: number; decision: string }> = {
    day_timetable: { n: 20, misfire: 15, rate: 0.75, decision: "disable" },
  };
  for (const [hint] of byHint) {
    const mine = judged.filter((row) => row.hint === hint);
    const misfire = mine.filter((row) => !row.match).length;
    const rate = mine.length ? misfire / mine.length : 0;
    rates[hint] = { n: mine.length, misfire, rate, decision: rate > 0.3 ? "disable" : "keep" };
  }
  ensure();
  writeFileSync(path.join(OUT, "hint-category-judged.json"), JSON.stringify({ rates, judged }, null, 2));
  console.log(JSON.stringify(rates));
  console.log(`hint judge spent $${spent().toFixed(4)}`);
}

async function stageRun(): Promise<void> {
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const admin = createSupabaseAdminClient();
  const cases = await resolveCases();
  writeFileSync(path.join(OUT, "choice-cases.json"), JSON.stringify(cases, null, 2));
  console.log(`cases ${cases.length} spent $${spent().toFixed(4)}`);
  const guidelines = await loadZoePlatformGuidelines();
  const packs = new Map<string, BusinessKnowledgePack | null>();
  const params = buildHaikuRequest("wa-generation", "claude-haiku-5-5");
  const results: unknown[] = [];
  for (const item of cases) {
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
    const { data: historyRows } = await admin
      .from("messages")
      .select("id, created_at, business_slug, session_id, role, model_used, content")
      .eq("business_slug", row.business_slug)
      .eq("session_id", row.session_id)
      .lt("created_at", row.created_at)
      .order("created_at", { ascending: false })
      .limit(8);
    const { data: nextAssistant } = await admin
      .from("messages")
      .select("model_used")
      .eq("business_slug", row.business_slug)
      .eq("session_id", row.session_id)
      .eq("role", "assistant")
      .gt("created_at", row.created_at)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const history = ((historyRows ?? []) as Msg[]).slice().reverse();
    const priorUsers = history.filter((turn) => turn.role === "user").map((turn) => String(turn.content ?? ""));
    const current = String(row.content ?? "").trim();
    const storedHint = parseModelUsed(String(nextAssistant?.model_used ?? "")).hint;
    const afterHint = collectPreClaudeHint(current)?.category ?? null;
    const at = new Date(row.created_at);
    const leadAgeBand = inferLeadAgeBandFromUserTexts([...priorUsers, current]);
    const system = buildSystemPrompt(pack, row.business_slug, "whatsapp", {
      israelNowScheduleBlock: buildIsraelNowSchedulePromptBlock(pack.salesFlowServices ?? [], at),
      leadAgeBand,
      salesFlowCurrentlyOpen: history.some((turn) => turn.role === "assistant" && /sales_flow|flow_continuation/i.test(String(turn.model_used ?? ""))),
    }, guidelines, current);
    const base = [
      ...history
        .filter((turn) => turn.role === "user" || turn.role === "assistant")
        .map((turn) => ({ role: turn.role as "user" | "assistant", content: String(turn.content ?? "").slice(0, 4000) })),
    ];
    const samples: unknown[] = [];
    for (const phase of ["before", "after"] as const) {
      const hintLine =
        phase === "before"
          ? storedHint
            ? OLD_HINT(storedHint)
            : ""
          : afterHint
            ? formatFastPathHintLine({ matcher: "stored", category: afterHint })
            : "";
      const userContent = `${joinInboundUserTexts(current, []).trim()}${hintLine ? `\n\n${hintLine}` : ""}\n\nהשורה הראשונה בתשובתך חייבת להיות [[route:X]] ורק אחריה הטקסט ללקוחה.`;
      for (let sample = 0; sample < SAMPLES; sample += 1) {
        if (spent() > BUDGET) throw new Error("budget cap");
        const json = await anthropic(apiKey, { ...params, system, messages: [...base, { role: "user", content: userContent }] });
        const usage = usageOf(json);
        note(haikuCost(usage.input, usage.output), "claude-haiku-5-5");
        const parsed = bodyOf(claudeTextBlocks(json as { content?: unknown }));
        const final =
          phase === "after"
            ? deliverAfter({
                body: parsed.body,
                route: parsed.route,
                text: current,
                prior: priorUsers.at(-1) ?? "",
                hint: afterHint,
                pack,
                at,
              })
            : parsed.body;
        samples.push({
          phase,
          route: parsed.route,
          body: mask(final).slice(0, 700),
          hint: phase === "before" ? storedHint : afterHint,
        });
      }
    }
    results.push({ label: item.label, control: item.control, latest: mask(current).slice(0, 400), samples });
    console.log(`ran ${item.label} spent $${spent().toFixed(4)}`);
  }
  writeFileSync(path.join(OUT, "choice-runs.json"), JSON.stringify({ results }, null, 2));
}

async function stageJudge(): Promise<void> {
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const file = JSON.parse(readFileSync(path.join(OUT, "choice-runs.json"), "utf8")) as {
    results: { label: string; control: boolean; latest: string; samples: { phase: string; route: string | null; body: string }[] }[];
  };
  const judged = [];
  for (const row of file.results) {
    const samples = [];
    for (const sample of row.samples) {
      if (spent() > BUDGET) throw new Error("budget cap");
      const json = await anthropic(apiKey, {
        model: "claude-sonnet-5-5",
        max_tokens: 220,
        output_config: { effort: "low" },
        messages: [
          {
            role: "user",
            content: `Judge one Hebrew WhatsApp reply. JSON only:
{"answered_latest_message":true,"honored_explicit_choice":true,"wrong_list_or_link":false,"empty":false,"hebrew_error":""}
honored_explicit_choice is true when the latest message did not name a class, day, or time, or when the reply confirms that choice or asks one short question about it. It is false when the reply ignores a named day, time, or class.
wrong_list_or_link is true when the reply sends a full timetable or a generic schedule link after the lead already named a slot or a class.
hebrew_error is a short quote of a real Hebrew mistake, else "".
Latest:
${row.latest}
Body:
${sample.body || "(empty)"}`,
          },
        ],
      });
      const usage = usageOf(json);
      note(sonnetCost(usage.input, usage.output), "claude-sonnet-5-5");
      const text = claudeTextBlocks(json as { content?: unknown });
      const match = text.match(/\{[\s\S]*\}/);
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(match?.[0] ?? "{}") as Record<string, unknown>;
      } catch {
        parsed = {};
      }
      samples.push({
        phase: sample.phase,
        answered_latest_message: parsed.answered_latest_message === true,
        honored_explicit_choice: parsed.honored_explicit_choice === true,
        wrong_list_or_link: parsed.wrong_list_or_link === true,
        empty: parsed.empty === true || !sample.body,
        hebrew_error: String(parsed.hebrew_error ?? ""),
      });
    }
    judged.push({ label: row.label, control: row.control, samples });
    console.log(`judged ${row.label} spent $${spent().toFixed(4)}`);
  }
  const summary: Record<string, unknown> = {};
  for (const phase of ["before", "after"] as const) {
    const rows = judged.flatMap((row) =>
      row.samples
        .filter((sample) => sample.phase === phase)
        .map((sample) => ({
          control: row.control,
          answered_latest_message: sample.answered_latest_message === true,
          honored_explicit_choice: sample.honored_explicit_choice === true,
          wrong_list_or_link: sample.wrong_list_or_link === true,
          empty: sample.empty === true,
          hebrew_error: String(sample.hebrew_error ?? ""),
        }))
    );
    const rate = (pick: (sample: (typeof rows)[number]) => boolean, control: boolean) => {
      const mine = rows.filter((sample) => sample.control === control);
      const hit = mine.filter(pick).length;
      return `${hit}/${mine.length}`;
    };
    summary[phase] = {
      target_latest: rate((sample) => sample.answered_latest_message === false, false),
      target_choice: rate((sample) => sample.honored_explicit_choice === false, false),
      target_wrong_list: rate((sample) => sample.wrong_list_or_link === true, false),
      target_empty: rate((sample) => sample.empty === true, false),
      target_hebrew: rate((sample) => Boolean(sample.hebrew_error), false),
      control_latest: rate((sample) => sample.answered_latest_message === false, true),
      control_wrong_list: rate((sample) => sample.wrong_list_or_link === true, true),
      control_hebrew: rate((sample) => Boolean(sample.hebrew_error), true),
    };
  }
  writeFileSync(path.join(OUT, "choice-judge.json"), JSON.stringify({ summary, spent: spent(), judged }, null, 2));
  console.log(JSON.stringify(summary));
  console.log(`total spent $${spent().toFixed(4)}`);
}

const stage = process.argv[2];
const run =
  stage === "hints" ? stageHints : stage === "run" ? stageRun : stage === "judge" ? stageJudge : null;
if (!run) {
  console.error("stage: hints | run | judge");
  process.exit(1);
}
run().catch((error) => {
  console.error(mask(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
