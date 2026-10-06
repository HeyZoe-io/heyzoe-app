/**
 * Offline eval: Stage 0 fits and does_not_fit rows through the hint path.
 * Not part of CI. Real Haiku, one call per row, the shared route prompt plus the hint line.
 *
 *   npx tsx --env-file=.env.local scripts/eval-fast-path-hints.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { CLAUDE_WHATSAPP_MAX_TOKENS, CLAUDE_WHATSAPP_MODEL, resolveClaudeApiKey } from "@/lib/claude";
import { decideHintAction, formatFastPathHintLine } from "@/lib/wa-fast-path-hint";
import { buildReplyRoutePromptBlock, extractReplyRoute } from "@/lib/wa-reply-route";

const CATEGORY: Record<string, string> = {
  human_agent: "human_agent",
  playbook_medical: "medical",
  signup_flow: "signup",
  playbook_freeze: "freeze",
  playbook_discount: "discount",
  schedule_lookup: "schedule_lookup",
  booked_class_move_product_pick: "registration_no_member",
  membership_lookup: "membership_lookup",
  playbook_class_cancel: "class_cancel",
  reschedule_or_app_failed: "reschedule",
  booked_class_move_app: "booked_class_move_app",
  playbook_cancellation: "cancellation",
  booking_mutation: "booking_mutation",
  schedule_board: "schedule",
};

type Judged = { matcher: string; verdict: string; inbound: string; id: string };
type Sample = { id: string; context?: string[] };

function closedResponse(category: string, raw: string): boolean {
  const extracted = extractReplyRoute(raw);
  if (category === "schedule") return extracted.tagStatus === "ok" && extracted.route === "schedule";
  return (
    decideHintAction({ hint: { matcher: "eval", category }, extracted }) === "use_hint"
  );
}

async function ask(system: string, user: string, apiKey: string): Promise<{ text: string; input: number; output: number }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_WHATSAPP_MODEL,
      max_tokens: CLAUDE_WHATSAPP_MAX_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (json.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
  return {
    text,
    input: json.usage?.input_tokens ?? 0,
    output: json.usage?.output_tokens ?? 0,
  };
}

async function main() {
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const judged = JSON.parse(readFileSync("/tmp/heyzoe-fast-path-judged.json", "utf8")) as { rows: Judged[] };
  const hits = JSON.parse(readFileSync("/tmp/heyzoe-fast-path-hits.json", "utf8")) as { samples: Sample[] };
  const byId = new Map(hits.samples.map((row) => [row.id, row]));
  const rows = judged.rows.filter(
    (row) => (row.verdict === "fits" || row.verdict === "does_not_fit") && CATEGORY[row.matcher]
  );
  const system = `את זואי, עוזרת הוואטסאפ של הסטודיו. עני בעברית קצרה.\n\n${buildReplyRoutePromptBlock()}`;
  let input = 0;
  let output = 0;
  let cursor = 0;
  const out: Array<Judged & { category: string; route: string | null; closed: boolean; ok: boolean; text: string }> = [];

  async function worker() {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      const row = rows[index];
      if (!row) return;
      const category = CATEGORY[row.matcher] ?? "";
      const sample = byId.get(row.id);
      const context = (sample?.context ?? [`user: ${row.inbound}`]).join("\n");
      const user = `${context}\n\n${formatFastPathHintLine({ matcher: row.matcher, category })}`;
      const reply = await ask(system, user, apiKey);
      input += reply.input;
      output += reply.output;
      const extracted = extractReplyRoute(reply.text);
      const closed = closedResponse(category, reply.text);
      const ok = row.verdict === "fits" ? closed : !closed;
      out.push({ ...row, category, route: extracted.route, closed, ok, text: extracted.body });
      if (out.length % 20 === 0) console.log(`done ${out.length}/${rows.length}`);
    }
  }

  await Promise.all(Array.from({ length: 6 }, () => worker()));
  const fits = out.filter((row) => row.verdict === "fits");
  const misses = out.filter((row) => row.verdict === "does_not_fit");
  const fitsOk = fits.filter((row) => row.ok).length;
  const missOk = misses.filter((row) => row.ok).length;
  const summary = {
    rows: out.length,
    fits: fits.length,
    fitsClosed: fitsOk,
    fitsRate: fits.length ? fitsOk / fits.length : 0,
    doesNotFit: misses.length,
    doesNotFitBlocked: missOk,
    doesNotFitRate: misses.length ? missOk / misses.length : 0,
    input,
    output,
    costUsd: (input / 1_000_000) * 1 + (output / 1_000_000) * 5,
    failures: out.filter((row) => !row.ok).map((row) => ({
      matcher: row.matcher,
      verdict: row.verdict,
      route: row.route,
      closed: row.closed,
      inbound: row.inbound,
      text: row.text,
    })),
  };
  writeFileSync("/tmp/heyzoe-hint-eval.json", JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, failures: summary.failures.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
