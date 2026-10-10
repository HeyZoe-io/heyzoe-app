/**
 * Replay eval. Direct Anthropic calls only. No WhatsApp, no webhooks, no crons.
 *
 *   npx tsx --env-file=.env.local scripts/offer-reply-eval.ts
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveClaudeApiKey } from "@/lib/claude";
import { buildHaikuRequest, claudeTextBlocks } from "@/lib/ai-models";
import { buildReplyRoutePromptBlock, extractReplyRoute } from "@/lib/wa-reply-route";
import {
  decideOfferReply,
  extractOfferReply,
  keywordFallbackOfferReply,
  offerReplyPromptLine,
  resolvePendingOffer,
} from "@/lib/wa-offer-reply";
import { FIND_CLASS_BRIDGE_HE } from "@/lib/wa-interest-find-class";

const OUT = path.join(process.cwd(), "eval-output");
const SPEND = "offer-reply-spend.jsonl";
const BUDGET = 5;
const SAMPLES = 5;

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

type Kind = "misfire" | "accept" | "control";
type Case = { id: string; label: string; kind: Kind };

const CASES: Case[] = [
  { id: "c7840999-7155-4da7-81fb-7098d018eb34", label: "oria-superpharm", kind: "misfire" },
  { id: "df7c0bc2-7abd-48e3-8431-4504d7bd62e9", label: "which-workouts", kind: "misfire" },
  { id: "1e9d62e1-a95b-4d59-9360-0d0d078b2a53", label: "which-floor", kind: "misfire" },
  { id: "d8d07482-6404-477d-9521-01d8d1705076", label: "for-a-girl", kind: "misfire" },
  { id: "967807e0-1277-4a0c-a8d1-87ce7af2212a", label: "catalog-yes", kind: "accept" },
  { id: "0a608c53-ada7-4512-a1d9-d937b3d6042f", label: "trial-word", kind: "accept" },
  { id: "e7e14335-0455-47e5-b93e-a70d96e7805d", label: "book-trial", kind: "accept" },
  { id: "d1ded90e-c76e-4312-bf31-9820cf9226e4", label: "trial-details", kind: "accept" },
  { id: "e2402a5c-6838-47ae-86aa-8674898bbd9e", label: "krav-trial", kind: "accept" },
  { id: "85b7632e-de05-4478-bd4e-6f9c4d016888", label: "interested-training", kind: "accept" },
  { id: "8385cffc-aed4-4a73-8bbd-88924daf785d", label: "how-to-register", kind: "accept" },
  { id: "baa9f370-0bd0-4c20-b999-55fb40cae981", label: "yoga-trial", kind: "accept" },
  { id: "aac408b9-35b8-40b2-8d87-38ec2978dafd", label: "how-trial-works", kind: "accept" },
  { id: "4bc07017-d16c-4751-bd5c-8425542577f7", label: "saturday-trial", kind: "accept" },
  ...CONTROLS.map((id, index) => ({ id, label: `c${index + 1}`, kind: "control" as const })),
];

function mask(text: string): string {
  return String(text ?? "")
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?<!\d)(?:\+972|972|0)\d(?:[-\s]?\d){7,8}(?!\d)/g, "[phone]")
    .replace(/\s+/g, " ")
    .trim();
}

function spent(): number {
  try {
    return readFileSync(path.join(OUT, SPEND), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .reduce((sum, line) => sum + (Number(JSON.parse(line).cost) || 0), 0);
  } catch {
    return 0;
  }
}

function note(cost: number, model: string): void {
  mkdirSync(OUT, { recursive: true });
  appendFileSync(path.join(OUT, SPEND), `${JSON.stringify({ cost, model, stage: "replay" })}\n`);
}

function haikuCost(input: number, output: number): number {
  return (input * 0.1 + output * 0.5) / 1e6;
}
function sonnetCost(input: number, output: number): number {
  return (input * 2 + output * 10) / 1e6;
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
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Claude ${res.status}: ${mask(raw).slice(0, 180)}`);
    return JSON.parse(raw) as Record<string, unknown>;
  }
  throw new Error(last || "Claude failed");
}

type Sample = { handling: string; body: string; tag: string };

function handlingOf(raw: string, inbound: string, pending: ReturnType<typeof resolvePendingOffer>, phase: "before" | "after"): { handling: string; body: string; tag: string } {
  const offer = extractOfferReply(raw);
  const route = extractReplyRoute(phase === "before" ? raw : offer.body);
  const body = mask(route.body).slice(0, 500);
  if (!pending) {
    const open = route.route === "interest" || route.route === "signup";
    return { handling: open ? "accept" : "other", body, tag: "none" };
  }
  if (phase === "before") {
    const fallback = keywordFallbackOfferReply({ path: pending.path, route: route.route, inbound });
    const handling = fallback === "accept" ? "accept" : fallback === "question" ? "question" : fallback;
    return { handling, body, tag: "keyword" };
  }
  const decision = decideOfferReply({
    status: offer.status,
    reply: offer.reply,
    pending,
    fallback: keywordFallbackOfferReply({ path: pending.path, route: route.route, inbound }),
  });
  const handling =
    decision.action === "accept"
      ? "accept"
      : decision.action === "reask" || decision.action === "answer"
        ? "question"
        : decision.action;
  return { handling, body, tag: offer.status === "ok" ? offer.reply ?? "missing" : offer.status };
}

async function main(): Promise<void> {
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const routeLine = "השורה הראשונה בתשובתך חייבת להיות [[route:X]] ורק אחריה הטקסט ללקוחה.";
  const offerLine = offerReplyPromptLine(FIND_CLASS_BRIDGE_HE);
  const without = await anthropic(apiKey, "/v1/messages/count_tokens", {
    model: "claude-haiku-5-5",
    messages: [{ role: "user", content: routeLine }],
  });
  const withLine = await anthropic(apiKey, "/v1/messages/count_tokens", {
    model: "claude-haiku-5-5",
    messages: [{ role: "user", content: `${routeLine}\n${offerLine}` }],
  });
  const tokenDelta = Number(withLine.input_tokens ?? 0) - Number(without.input_tokens ?? 0);
  console.log(`token delta ${tokenDelta}`);

  const params = buildHaikuRequest("wa-generation", "claude-haiku-5-5");
  const generation = { ...params, max_tokens: 600 };
  const system = `${buildReplyRoutePromptBlock()}\nעני בעברית, קצר, בלי אנגלית מיותרת.`;
  const admin = createSupabaseAdminClient();
  const results: {
    label: string;
    kind: Kind;
    latest: string;
    pending: string | null;
    before: Sample[];
    after: Sample[];
  }[] = [];

  for (const item of CASES) {
    if (spent() > BUDGET - 0.4) throw new Error("budget cap");
    const { data, error } = await admin
      .from("messages")
      .select("id, created_at, business_slug, session_id, role, content")
      .eq("id", item.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as { created_at: string; business_slug: string; session_id: string; content: string } | null;
    if (!row?.session_id) {
      console.log(`skip ${item.label}`);
      continue;
    }
    const { data: historyRows, error: historyError } = await admin
      .from("messages")
      .select("created_at, role, model_used, content")
      .eq("business_slug", row.business_slug)
      .eq("session_id", row.session_id)
      .lt("created_at", row.created_at)
      .order("created_at", { ascending: false })
      .limit(6);
    if (historyError) throw new Error(historyError.message);
    const history = ((historyRows ?? []) as { role: string; model_used: string; content: string }[])
      .slice()
      .reverse()
      .filter((turn) => turn.role === "user" || turn.role === "assistant");
    const pending = resolvePendingOffer({
      modelsNewestFirst: [...history].reverse().filter((turn) => turn.role === "assistant").map((turn) => turn.model_used),
      lastAssistantContent: [...history].reverse().find((turn) => turn.role === "assistant")?.content ?? "",
    });
    const latest = mask(row.content).slice(0, 500);
    const prior = history.slice(-4).map((turn) => ({
      role: turn.role as "user" | "assistant",
      content: mask(turn.content).slice(0, 500),
    }));
    const before: Sample[] = [];
    const after: Sample[] = [];
    for (const phase of ["before", "after"] as const) {
      const userContent = `${latest}\n\n${routeLine}${phase === "after" && pending ? `\n${offerReplyPromptLine(pending.summary)}` : ""}`;
      for (let sample = 0; sample < SAMPLES; sample += 1) {
        if (spent() > BUDGET - 0.4) throw new Error("budget cap");
        const json = await anthropic(apiKey, "/v1/messages", {
          ...generation,
          system,
          messages: [...prior, { role: "user", content: userContent }],
        });
        const usage = (json.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
        note(haikuCost(Number(usage.input_tokens ?? 0), Number(usage.output_tokens ?? 0)), "claude-haiku-5-5");
        const text = claudeTextBlocks(json as { content?: unknown });
        const decided = handlingOf(text, latest, pending, phase);
        (phase === "before" ? before : after).push(decided);
      }
    }
    results.push({
      label: item.label,
      kind: item.kind,
      latest,
      pending: pending?.path ?? null,
      before,
      after,
    });
    console.log(`ran ${item.label} pending=${pending?.path ?? "none"} spent=$${spent().toFixed(4)}`);
  }

  writeFileSync(path.join(OUT, "offer-reply-runs.json"), JSON.stringify({ tokenDelta, results }, null, 2));

  type Judge = {
    correct_offer_handling: boolean;
    answered_latest_message: boolean;
    empty: boolean;
    hebrew_error: string;
  };
  const judged = [];
  for (const row of results) {
    const samples = [];
    for (const phase of ["before", "after"] as const) {
      for (const sample of phase === "before" ? row.before : row.after) {
        if (spent() > BUDGET) throw new Error("budget cap");
        const expect =
          row.kind === "misfire"
            ? "Do not open a signup flow. Answer the question."
            : row.kind === "accept"
              ? "Opening the class or signup flow is correct."
              : "No pending offer unless the history shows one. Do not get worse at answering the latest message.";
        const json = await anthropic(apiKey, "/v1/messages", {
          model: "claude-sonnet-5-5",
          max_tokens: 220,
          output_config: { effort: "low" },
          messages: [
            {
              role: "user",
              content: `Judge one Hebrew WhatsApp reply. JSON only:
{"correct_offer_handling":true,"answered_latest_message":true,"empty":false,"hebrew_error":""}
Expected: ${expect}
Code handling: ${sample.handling}
Latest: ${row.latest}
Reply: ${sample.body || "(empty)"}
hebrew_error is a short quote of a real Hebrew mistake, else "".`,
            },
          ],
        });
        const usage = (json.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
        note(sonnetCost(Number(usage.input_tokens ?? 0), Number(usage.output_tokens ?? 0)), "claude-sonnet-5-5");
        const text = claudeTextBlocks(json as { content?: unknown });
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        let parsed: Judge = {
          correct_offer_handling: false,
          answered_latest_message: false,
          empty: !sample.body.trim(),
          hebrew_error: "judge_failed",
        };
        if (start >= 0 && end > start) {
          try {
            parsed = JSON.parse(text.slice(start, end + 1)) as Judge;
          } catch {
            /* keep fallback */
          }
        }
        samples.push({ phase, handling: sample.handling, tag: sample.tag, ...parsed });
      }
    }
    judged.push({ label: row.label, kind: row.kind, pending: row.pending, samples });
    console.log(`judged ${row.label} spent=$${spent().toFixed(4)}`);
  }
  writeFileSync(path.join(OUT, "offer-reply-judge.json"), JSON.stringify({ tokenDelta, judged }, null, 2));
  console.log(`eval done tokenDelta=${tokenDelta} spent=$${spent().toFixed(4)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "eval failed");
  process.exit(1);
});
