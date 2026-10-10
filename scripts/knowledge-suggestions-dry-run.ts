/**
 * Dry run of the weekly knowledge builder. Reads production data, calls Haiku,
 * writes nothing. Output is masked and stays in gitignored eval-output/.
 *
 *   npx tsx --env-file=.env.local scripts/knowledge-suggestions-dry-run.ts
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  buildKnowledgeUpdates,
  measureAnswerableHandoffs,
  type KnowledgePairReview,
  type KnowledgeRuleReview,
} from "@/lib/knowledge-updates-run";
import { maskPii, type KnowledgeReviewReason } from "@/lib/knowledge-updates";

const REVIEW_REASONS: KnowledgeReviewReason[] = [
  "passed",
  "personal",
  "one-off favor or private",
  "already covered",
  "not grounded",
  "other",
];

function oneLine(text: string): string {
  return maskPii(text)
    .replace(/שמי\s+(\S+)\s+\S+/g, "שמי $1")
    .replace(/\s+/g, " ")
    .trim();
}

function reviewHeader(built: {
  reviews: KnowledgePairReview[];
  ruleReviews: KnowledgeRuleReview[];
  pairs: number;
}): string {
  const businesses = new Set([
    ...built.reviews.map((row) => row.businessName),
    ...built.ruleReviews.map((row) => row.businessName),
  ]).size;
  const passed = built.reviews.filter((row) => row.outcome === "passed").length;
  const dropped = REVIEW_REASONS.filter((reason) => reason !== "passed")
    .map((reason) => `${reason} ${built.reviews.filter((row) => row.reason === reason).length}`)
    .join(", ");
  const rulesPassed = built.ruleReviews.filter((row) => row.outcome === "passed").length;
  const ruleReasons = [...new Set(built.ruleReviews.map((row) => row.reason).filter((reason) => reason !== "passed"))];
  const rulesDropped = ruleReasons
    .map((reason) => `${reason} ${built.ruleReviews.filter((row) => row.reason === reason).length}`)
    .join(", ");
  return [
    "# Knowledge suggestions review",
    "",
    `Businesses: ${businesses}`,
    `Pairs: ${built.pairs}`,
    `Passed: ${passed}`,
    `Dropped: ${dropped}`,
    `Rules: ${built.ruleReviews.length}`,
    `Rules passed: ${rulesPassed}`,
    `Rules dropped: ${rulesDropped || "none"}`,
    "",
  ].join("\n");
}

function businessSection(name: string, rows: KnowledgePairReview[], rules: KnowledgeRuleReview[]): string {
  const lines = [`## ${oneLine(name)}`, ""];
  for (const reason of REVIEW_REASONS) {
    const group = rows.filter((row) => row.reason === reason);
    if (!group.length) continue;
    lines.push(`### ${reason === "passed" ? "Passed" : reason}`, "");
    for (const row of group) {
      lines.push(`Q: ${oneLine(row.question)}`);
      lines.push(`A: ${oneLine(row.answer)}`);
      lines.push(
        row.outcome === "passed" ? "Result: passed" : `Result: dropped, ${row.reason}`
      );
      if (row.outcome === "passed") lines.push(`Knowledge: ${oneLine(row.knowledgeText)}`);
      lines.push("");
    }
  }
  if (rules.length) {
    lines.push("### Rules extracted", "");
    for (const rule of rules) {
      lines.push(`Rule: ${oneLine(rule.text)}`);
      lines.push(`Times: ${rule.times}`);
      lines.push(rule.outcome === "passed" ? "Result: passed" : `Result: dropped, ${rule.reason}`);
      if (rule.conflict) lines.push(`Conflict: ${oneLine(rule.conflict)}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

function writeReview(built: {
  reviews: KnowledgePairReview[];
  ruleReviews: KnowledgeRuleReview[];
  pairs: number;
}): string[] {
  const header = reviewHeader(built);
  const byBusiness = new Map<string, KnowledgePairReview[]>();
  for (const row of built.reviews) {
    const list = byBusiness.get(row.businessName) ?? [];
    list.push(row);
    byBusiness.set(row.businessName, list);
  }
  const rulesByBusiness = new Map<string, KnowledgeRuleReview[]>();
  for (const row of built.ruleReviews) {
    const list = rulesByBusiness.get(row.businessName) ?? [];
    list.push(row);
    rulesByBusiness.set(row.businessName, list);
  }
  const names = [...new Set([...byBusiness.keys(), ...rulesByBusiness.keys()])];
  const sections = names.map((name) => businessSection(name, byBusiness.get(name) ?? [], rulesByBusiness.get(name) ?? []));
  const parts: string[] = [];
  let current = header;
  for (const section of sections) {
    const next = `${current}${section}\n`;
    if (current !== header && next.length > 25000) {
      parts.push(current);
      current = `${section}\n`;
    } else {
      current = next;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.length ? parts : [`${header}\n`];
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error("missing_anthropic_key");
  const admin = createSupabaseAdminClient();
  const replacePending = process.argv.includes("--replace-pending");
  const built = await buildKnowledgeUpdates({
    admin,
    persist: false,
    review: true,
    budgetUsd: 2,
    replacePending,
  });
  const byBusiness = new Map<string, typeof built.suggestions>();
  for (const row of built.suggestions) {
    const list = byBusiness.get(row.slug) ?? [];
    list.push(row);
    byBusiness.set(row.slug, list);
  }
  const lines = [
    "# Knowledge suggestions dry run",
    "",
    `week: ${built.week}`,
    `businesses_scanned: ${built.scanned}`,
    `pairs: ${built.pairs}`,
    `suggestions: ${built.suggestions.length}`,
    `spend_usd: ${built.spendUsd.toFixed(4)}`,
    "",
  ];
  for (const [slug, rows] of byBusiness) {
    lines.push(`## ${slug}`);
    for (const row of rows) {
      lines.push(`- leads: ${row.leadCount}`);
      lines.push(`  question: ${maskPii(row.question)}`);
      lines.push(`  knowledge: ${maskPii(row.knowledgeText)}`);
    }
    lines.push("");
  }
  mkdirSync("eval-output", { recursive: true });
  writeFileSync("eval-output/knowledge-suggestions-dryrun.md", lines.join("\n"));
  const reviewParts = writeReview(built);
  const reviewPaths = reviewParts.map((_, index) => `eval-output/knowledge-suggestions-review-${index + 1}.md`);
  reviewParts.forEach((part, index) => writeFileSync(reviewPaths[index]!, part));
  if (reviewParts.length < 2) rmSync("eval-output/knowledge-suggestions-review-2.md", { force: true });
  rmSync("eval-output/knowledge-suggestions-review.md", { force: true });
  const handoffs = await measureAnswerableHandoffs({
    admin,
    rules: built.suggestions
      .filter((row) => row.clusterKey.startsWith("rule:"))
      .map((row) => ({ slug: row.slug, businessName: row.businessName, text: row.knowledgeText })),
  });
  const handoffLines = [
    "# Handoffs a general answer could have covered",
    "",
    ...handoffs.counts.map((row) => `${row.business}: ${row.count}`),
    "",
    ...handoffs.examples.flatMap((row) => [
      `## ${oneLine(row.business)}`,
      `Q: ${oneLine(row.question)}`,
      `Zoe: ${row.zoe}`,
      `Rule: ${oneLine(row.rule)}`,
      "",
    ]),
  ];
  writeFileSync("eval-output/knowledge-handoff-measure.md", handoffLines.join("\n"));
  writeFileSync(
    "eval-output/knowledge-suggestions-spend.jsonl",
    `${JSON.stringify({ at: new Date().toISOString(), usd: Number(built.spendUsd.toFixed(4)), suggestions: built.suggestions.length })}\n`,
    { flag: "a" }
  );
  console.log(
    JSON.stringify({
      week: built.week,
      scanned: built.scanned,
      pairs: built.pairs,
      suggestions: built.suggestions.length,
      rulesPassed: built.ruleReviews.filter((row) => row.outcome === "passed").length,
      handoffs: handoffs.counts,
      businesses: byBusiness.size,
      spendUsd: Number(built.spendUsd.toFixed(4)),
      reviewFiles: reviewPaths.map((path, index) => ({ path, chars: reviewParts[index]?.length ?? 0 })),
    })
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
