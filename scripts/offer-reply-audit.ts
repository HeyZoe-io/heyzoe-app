/**
 * SELECT-only audit. Does not send WhatsApp, write rows, or call webhooks.
 *
 *   npx tsx --env-file=.env.local scripts/offer-reply-audit.ts
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveClaudeApiKey } from "@/lib/claude";
import { claudeTextBlocks } from "@/lib/ai-models";
import { modelUsedBase } from "@/lib/wa-reply-route";
import { isAffirmativeCatalogFamilyConfirm } from "@/lib/wa-opening-service-list-pick-bridge";

const OUT = path.join(process.cwd(), "eval-output");
const SPEND = "offer-reply-spend.jsonl";
const BUDGET = 5;
const SINCE = "2026-09-10T00:00:00.000Z";

type Row = {
  id: string;
  business_slug: string;
  session_id: string;
  created_at: string;
  content: string;
  model_used: string;
};

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
  appendFileSync(path.join(OUT, SPEND), `${JSON.stringify({ cost, model, stage: "audit" })}\n`);
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
  const raw = await res.text();
  if (!res.ok) throw new Error(`Claude ${res.status}: ${mask(raw).slice(0, 180)}`);
  return JSON.parse(raw) as Record<string, unknown>;
}

async function countLike(pattern: string): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { count, error } = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .gte("created_at", SINCE)
    .like("model_used", pattern);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function loadLike(pattern: string, limit: number): Promise<Row[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("messages")
    .select("id, business_slug, session_id, created_at, content, model_used")
    .gte("created_at", SINCE)
    .like("model_used", pattern)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

async function around(row: Row): Promise<{ userId: string; user: string; prevModel: string; nextModel: string }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("messages")
    .select("id, role, content, model_used, created_at")
    .eq("business_slug", row.business_slug)
    .eq("session_id", row.session_id)
    .lt("created_at", row.created_at)
    .order("created_at", { ascending: false })
    .limit(4);
  if (error) throw new Error(error.message);
  const prev = (data ?? []) as { id?: string; role: string; content: string; model_used: string }[];
  const user = prev.find((turn) => turn.role === "user");
  const assistant = prev.find((turn) => turn.role === "assistant");
  const { data: nextRows, error: nextError } = await admin
    .from("messages")
    .select("role, model_used")
    .eq("business_slug", row.business_slug)
    .eq("session_id", row.session_id)
    .gt("created_at", row.created_at)
    .order("created_at", { ascending: true })
    .limit(4);
  if (nextError) throw new Error(nextError.message);
  const nextAssistant = ((nextRows ?? []) as { role: string; model_used: string }[]).find(
    (turn) => turn.role === "assistant"
  );
  return {
    userId: String(user?.id ?? row.id),
    user: String(user?.content ?? ""),
    prevModel: modelUsedBase(assistant?.model_used),
    nextModel: modelUsedBase(nextAssistant?.model_used),
  };
}

async function judgeAccepted(apiKey: string, offer: string, inbound: string): Promise<boolean> {
  if (spent() > BUDGET) throw new Error("budget cap");
  const json = await anthropic(apiKey, {
    model: "claude-haiku-5-5",
    max_tokens: 80,
    output_config: { effort: "low" },
    thinking: { type: "disabled" },
    messages: [
      {
        role: "user",
        content: `The business had just offered: "${mask(offer)}".
The lead wrote: "${mask(inbound).slice(0, 400)}".
Did this message accept that offer? A side question is not acceptance. Asking to see classes after "want us to find a class?" is acceptance. JSON only: {"accepted":true}`,
      },
    ],
  });
  const usage = (json.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
  note((Number(usage.input_tokens ?? 0) * 0.1 + Number(usage.output_tokens ?? 0) * 0.5) / 1e6, "claude-haiku-5-5");
  const text = claudeTextBlocks(json as { content?: unknown });
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return false;
  try {
    return Boolean((JSON.parse(text.slice(start, end + 1)) as { accepted?: boolean }).accepted);
  } catch {
    return false;
  }
}

type Fire = { id: string; path: string; inbound: string; accepted: boolean | null };

async function main(): Promise<void> {
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const counts = {
    signup_intent_flow_entry: await countLike("signup_intent_flow_entry%"),
    find_class_ask: await countLike("interest_answer_find_class_ask%"),
    try_class_offer: await countLike("try_class_info_offer%"),
    lead_day_offer: await countLike("lead_day_trial_offer%"),
    catalog_family: await countLike("sales_flow_catalog_family_pick%"),
    service_repick_menu: await countLike("sales_flow_cta_repick_service_menu%"),
    menu_nudge: await countLike("pending_service_menu_nudge%"),
  };
  console.log(JSON.stringify(counts));

  const signup = await loadLike("signup_intent_flow_entry%", Math.min(counts.signup_intent_flow_entry, 250));
  const fires: Record<string, Fire[]> = {
    find_class: [],
    try_class: [],
    lead_day_trial: [],
    catalog_family: [],
    service_repick: [],
    service_menu: [],
  };

  for (const row of signup) {
    const ctx = await around(row);
    const inbound = mask(ctx.user).slice(0, 240);
    if (ctx.prevModel === "interest_answer_find_class_ask") {
      fires.find_class.push({ id: ctx.userId, path: "find_class", inbound, accepted: null });
    } else if (ctx.prevModel === "try_class_info_offer" || ctx.prevModel.startsWith("try_class_info_offer")) {
      fires.try_class.push({ id: ctx.userId, path: "try_class", inbound, accepted: null });
    }
  }

  const leadDay = await loadLike("lead_day_trial_offer%", Math.min(counts.lead_day_offer, 200));
  for (const row of leadDay) {
    if (!String(row.content ?? "").includes("[heyzoe:lead_day_trial]")) continue;
    const ctx = await around(row);
    fires.lead_day_trial.push({
      id: ctx.userId,
      path: "lead_day_trial",
      inbound: mask(ctx.user).slice(0, 240),
      accepted: null,
    });
  }

  const catalog = await loadLike("sales_flow_catalog_family_pick%", Math.min(counts.catalog_family, 120));
  for (const row of catalog) {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("messages")
      .select("id, role, content")
      .eq("business_slug", row.business_slug)
      .eq("session_id", row.session_id)
      .gt("created_at", row.created_at)
      .order("created_at", { ascending: true })
      .limit(3);
    if (error) throw new Error(error.message);
    const nextUser = ((data ?? []) as { id: string; role: string; content: string }[]).find(
      (turn) => turn.role === "user"
    );
    if (!nextUser || !isAffirmativeCatalogFamilyConfirm(nextUser.content)) continue;
    fires.catalog_family.push({
      id: nextUser.id,
      path: "catalog_family",
      inbound: mask(nextUser.content).slice(0, 240),
      accepted: null,
    });
  }

  const repick = await loadLike("sales_flow_cta_repick_service_menu%", Math.min(counts.service_repick_menu, 80));
  for (const row of repick) {
    const ctx = await around(row);
    fires.service_repick.push({
      id: ctx.userId,
      path: "service_repick",
      inbound: mask(ctx.user).slice(0, 240),
      accepted: null,
    });
  }

  const nudges = await loadLike("pending_service_menu_nudge%", Math.min(counts.menu_nudge, 80));
  for (const row of nudges) {
    const ctx = await around(row);
    fires.service_menu.push({
      id: ctx.userId,
      path: "service_menu",
      inbound: mask(ctx.user).slice(0, 240),
      accepted: null,
    });
  }

  const offers: Record<string, string> = {
    find_class: "רוצה שנמצא את השיעור המתאים עבורך?",
    try_class: "בא לך שאשלח לך את מידע מסודר על השיעורים ומתי אפשר להגיע לשיעור ניסיון?",
    lead_day_trial: "תרצי להצטרף לאחד מהם?",
    catalog_family: "האם זה האימון שמעניין אותך?",
    service_repick: "תרצו שנבחר יחד אימון אחר מהרשימה?",
    service_menu: "בחרי את האימון שמעניין אותך מהרשימה",
  };

  const judged: Fire[] = [];
  for (const pathName of Object.keys(fires)) {
    const sample = fires[pathName]!.slice(0, 15);
    for (const fire of sample) {
      fire.accepted = await judgeAccepted(apiKey, offers[pathName] ?? "", fire.inbound);
      judged.push(fire);
      console.log(`${pathName} accepted=${fire.accepted} spent=$${spent().toFixed(4)}`);
    }
  }

  const admin = createSupabaseAdminClient();
  const { data: oriaRows, error: oriaError } = await admin
    .from("messages")
    .select("id, created_at, content")
    .eq("business_slug", "or-ia-wellness-vlub")
    .gte("created_at", "2026-10-10T00:00:00.000Z")
    .ilike("content", "%סופר פארם%")
    .order("created_at", { ascending: false })
    .limit(3);
  if (oriaError) throw new Error(oriaError.message);
  const oria = ((oriaRows ?? []) as { id: string; content: string }[])[0] ?? null;

  const misfires = judged.filter((fire) => fire.accepted === false);
  const accepts = judged.filter((fire) => fire.accepted === true).slice(0, 10);
  const lines = [
    "# Offer reply audit",
    "",
    `Window from ${SINCE}. Counts are 30-day model hits. Fires below are the classified sample, not always the full count.`,
    "",
    "## Counts",
    "",
    ...Object.entries(counts).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "Call scheduling is a day/time slot pick, not a yes/no offer. Payment links are chosen from the current class mention, not from accepting a previous question.",
    "",
    "## Sampled fires",
    "",
  ];
  for (const pathName of Object.keys(fires)) {
    const sample = judged.filter((fire) => fire.path === pathName);
    const bad = sample.filter((fire) => fire.accepted === false).length;
    lines.push(
      `- ${pathName}: classified ${fires[pathName]!.length}, judged ${sample.length}, misfires ${bad}${
        sample.length ? ` (${Math.round((bad / sample.length) * 100)}%)` : ""
      }`
    );
  }
  lines.push("", `Spend so far $${spent().toFixed(4)}`, "");
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, "offer-reply-audit.md"), lines.join("\n"));
  writeFileSync(
    path.join(OUT, "offer-reply-cases.json"),
    JSON.stringify(
      {
        oria: oria ? { id: oria.id, inbound: mask(oria.content).slice(0, 240) } : null,
        misfires: misfires.map((fire) => ({ id: fire.id, path: fire.path, inbound: fire.inbound })),
        accepts: accepts.map((fire) => ({ id: fire.id, path: fire.path, inbound: fire.inbound })),
      },
      null,
      2
    )
  );
  console.log(`audit written, spent $${spent().toFixed(4)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "audit failed");
  process.exit(1);
});
