/**
 * Real Haiku: schedule route follows the business timetable source.
 * Hours are checked here against the loaded schedule slots, not in production code.
 *
 *   npx tsx --env-file=.env.local scripts/eval-schedule-source.ts
 */
import { CLAUDE_WHATSAPP_MAX_TOKENS, CLAUDE_WHATSAPP_MODEL, resolveClaudeApiKey } from "@/lib/claude";
import { buildSystemPrompt, getBusinessKnowledgePack } from "@/lib/business-context";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { extractReplyRoute } from "@/lib/wa-reply-route";
import { resolveScheduleResponse, type ScheduleSource } from "@/lib/wa-schedule-response";

const CASES: Array<{ slug: string; source: ScheduleSource }> = [
  { slug: "tights", source: "image" },
  { slug: "omers-place", source: "link" },
  { slug: "master-yigal-arbiv-ikma-israel", source: "data" },
  { slug: "sportykef-1589", source: "none" },
];

const PHRASINGS = [
  "מתי מתקיימים שיעורי עיצוב וחיטוב",
  "אפשר לקבל מערכת שעות של השבוע?",
  "מה יש ביום שני בבוקר?",
  "יש שיעורים אחרי 18:00?",
  "מתי יש פילאטיס השבוע?",
];

function collectTimes(text: string, into: Set<string>) {
  for (const time of text.match(/\d{1,2}:\d{2}/g) ?? []) into.add(time);
}

/** Hours stored on this business (slots, descriptions, FAQs). Shared prompt examples are not included. */
async function businessTimes(slug: string): Promise<{ times: Set<string>; hasSlots: boolean }> {
  const admin = createSupabaseAdminClient();
  const { data: biz } = await admin.from("businesses").select("id").eq("slug", slug).maybeSingle();
  const times = new Set<string>();
  let hasSlots = false;
  if (!biz?.id) return { times, hasSlots };
  const { data: services } = await admin
    .from("services")
    .select("description")
    .eq("business_id", biz.id);
  for (const row of services ?? []) {
    const raw = String(row.description ?? "");
    try {
      const meta = JSON.parse(raw) as {
        schedule_slots?: Array<{ time?: string }>;
        description_text?: string;
        benefit_line?: string;
      };
      for (const slot of meta.schedule_slots ?? []) {
        const time = String(slot.time ?? "").trim();
        if (time) {
          times.add(time);
          hasSlots = true;
        }
      }
      collectTimes(String(meta.description_text ?? ""), times);
      collectTimes(String(meta.benefit_line ?? ""), times);
    } catch {
      collectTimes(raw, times);
    }
  }
  const { data: faqs } = await admin.from("faqs").select("answer").eq("business_id", biz.id);
  for (const row of faqs ?? []) collectTimes(String(row.answer ?? ""), times);
  return { times, hasSlots };
}

async function ask(system: string, user: string, apiKey: string): Promise<string> {
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
  const json = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  return (json.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
}

function hoursOutsideData(text: string, allowed: Set<string>): string[] {
  const found = text.match(/\d{1,2}:\d{2}/g) ?? [];
  return found.filter((time) => !allowed.has(time));
}

async function main() {
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const failures: string[] = [];
  for (const item of CASES) {
    const knowledge = await getBusinessKnowledgePack(item.slug);
    if (!knowledge) throw new Error(`missing knowledge ${item.slug}`);
    const { times: allowed, hasSlots } = await businessTimes(item.slug);
    const system = buildSystemPrompt(knowledge, item.slug, "whatsapp");
    const missing = "מתי מתקיים שיעור קרקס אווירי?";
    for (const text of [...PHRASINGS, missing]) {
      const raw = await ask(system, text, apiKey);
      const extracted = extractReplyRoute(raw);
      const resolved =
        extracted.route === "schedule"
          ? resolveScheduleResponse({
              slug: item.slug,
              schedulePublicUrl: knowledge.schedulePublicUrl,
              arboxLink: knowledge.arboxLink,
              hasScheduleData: hasSlots,
              claudeBody: extracted.body,
            })
          : null;
      const sent =
        resolved?.kind === "image"
          ? ""
          : resolved?.kind === "link" || resolved?.kind === "handoff"
            ? resolved.text
            : resolved?.kind === "body"
              ? resolved.text
              : extracted.body;
      const invented = hoursOutsideData(sent, allowed);
      const askedDay = sent.includes("על איזה יום מדובר");
      const sourceOk = !resolved || resolved.source === item.source;
      const routeOk = text === missing || extracted.route === "schedule";
      const dayOk = text === missing || !askedDay;
      const ok = invented.length === 0 && sourceOk && routeOk && dayOk;
      const line = [
        item.slug,
        item.source,
        extracted.route ?? "missing",
        resolved?.kind ?? "body-as-answer",
        invented.join(",") || "-",
        askedDay ? "asked-day" : "-",
        text,
      ].join(" | ");
      console.log(ok ? "ok" : "FAIL", line);
      if (!ok) failures.push(line);
    }
  }
  if (failures.length) {
    console.error(`schedule-source failures: ${failures.length}`);
    process.exit(1);
  }
  console.log("eval-schedule-source: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
