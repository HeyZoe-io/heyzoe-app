/**
 * Dry run of the weekly knowledge builder. Reads production data, calls Haiku,
 * writes nothing. Output is masked and stays in gitignored eval-output/.
 *
 *   npx tsx --env-file=.env.local scripts/knowledge-suggestions-dry-run.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { buildKnowledgeUpdates, type KnowledgePairReview } from "@/lib/knowledge-updates-run";
import { maskPii, type KnowledgeReviewReason } from "@/lib/knowledge-updates";

const REVIEW_REASONS: KnowledgeReviewReason[] = [
  "passed",
  "personal",
  "one-off favor or private",
  "single lead",
  "already covered",
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
  pairs: number;
}): string {
  const businesses = new Set(built.reviews.map((row) => row.businessName)).size;
  const passed = built.reviews.filter((row) => row.outcome === "passed").length;
  const dropped = REVIEW_REASONS.filter((reason) => reason !== "passed")
    .map((reason) => `${reason} ${built.reviews.filter((row) => row.reason === reason).length}`)
    .join(", ");
  return [
    "# Knowledge suggestions review",
    "",
    `Businesses: ${businesses}`,
    `Pairs: ${built.pairs}`,
    `Passed: ${passed}`,
    `Dropped: ${dropped}`,
    "",
  ].join("\n");
}

function businessSection(name: string, rows: KnowledgePairReview[]): string {
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
  return lines.join("\n");
}

function writeReview(built: { reviews: KnowledgePairReview[]; pairs: number }): string[] {
  const header = reviewHeader(built);
  const byBusiness = new Map<string, KnowledgePairReview[]>();
  for (const row of built.reviews) {
    const list = byBusiness.get(row.businessName) ?? [];
    list.push(row);
    byBusiness.set(row.businessName, list);
  }
  const sections = [...byBusiness.entries()].map(([name, rows]) => businessSection(name, rows));
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
  const built = await buildKnowledgeUpdates({ admin, persist: false, review: true, budgetUsd: 1 });
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
  const reviewPaths =
    reviewParts.length === 1
      ? ["eval-output/knowledge-suggestions-review.md"]
      : reviewParts.map((_, index) => `eval-output/knowledge-suggestions-review-${index + 1}.md`);
  reviewParts.forEach((part, index) => writeFileSync(reviewPaths[index]!, part));
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
