/**
 * Offline eval: real Claude Haiku + the real Tights WhatsApp prompt.
 * Not part of CI. A booking_change phrasing tagged schedule fails the run.
 *
 *   npx tsx --env-file=.env.local scripts/eval-wa-reply-route.ts
 */
import { CLAUDE_WHATSAPP_MAX_TOKENS, CLAUDE_WHATSAPP_MODEL, resolveClaudeApiKey } from "@/lib/claude";
import { buildSystemPrompt, getBusinessKnowledgePack } from "@/lib/business-context";
import { extractReplyRoute, type WaReplyRoute } from "@/lib/wa-reply-route";

type Expected = WaReplyRoute;

const CASES: Array<{ text: string; expected: Expected }> = [
  { text: "תמחקו אותי מהשיעור ותעבירו אותי ליום שני", expected: "booking_change" },
  { text: "אפשר להזיז אותי מחמישי לשני ב-8:30?", expected: "booking_change" },
  { text: "נרשמתי לשיעור הלא נכון, תסדרו לי לשני בבוקר", expected: "booking_change" },
  { text: "אני לא מצליחה לבטל באפליקציה את השיעור של מחר ב-19:00", expected: "booking_change" },
  { text: "היי תמחקו אותי בבקשה מהשיעור של יום ראשון הקרוב ותעבירו אותי ליום שני ב08.30 אי אפשר דרך האפליקציה", expected: "booking_change" },
  { text: "תוציאו אותי מהשיעור של היום ותשימו אותי מחר בבוקר", expected: "booking_change" },
  { text: "נרשמתי בטעות ל-18:00, רציתי את השיעור של 19:30", expected: "booking_change" },
  { text: "אפשר להחליף לי את השיעור של ראשון לשלישי?", expected: "booking_change" },
  { text: "לא מצליחה להיכנס לאפליקציה לבטל את מחר", expected: "booking_change" },
  { text: "תורידו אותי מהרשימה של חמישי ב-17:00", expected: "booking_change" },
  { text: "מה יש ביום שני בבוקר?", expected: "schedule" },
  { text: "יש שיעורים אחרי 18:00?", expected: "schedule" },
  { text: "מתי יש פילאטיס השבוע?", expected: "schedule" },
  { text: "מתי יש שיעור?", expected: "schedule" },
  { text: "אפשר לראות את מערכת השעות?", expected: "schedule" },
  { text: "מה יש מחר בערב?", expected: "schedule" },
  { text: "איזה אימונים יש ביום שלישי?", expected: "schedule" },
  { text: "יש משהו בבוקר בימי חמישי?", expected: "schedule" },
  { text: "כמה עולה כרטיסייה?", expected: "answer" },
  { text: "צריך להביא מזרן?", expected: "answer" },
  { text: "תודה רבה", expected: "answer" },
  { text: "איפה אתם נמצאים?", expected: "answer" },
  { text: "יש חניה?", expected: "answer" },
  { text: "מה ההבדל בין הפילאטיס ליוגה?", expected: "answer" },
  { text: "אני רוצה לדבר עם המנהלת", expected: "handoff" },
  { text: "יש לי תלונה על השיעור", expected: "handoff" },
  { text: "אפשר לקבל החזר?", expected: "handoff" },
  { text: "כואב לי הברך, מה אפשר לעשות?", expected: "handoff" },
  { text: "תעבירי אותי למישהי אנושית בבקשה", expected: "handoff" },
  { text: "שלום, מה נשמע?", expected: "answer" },
];

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
  if (!res.ok) {
    throw new Error(`Claude ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  return (json.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
}

async function main() {
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const knowledge = await getBusinessKnowledgePack("tights");
  const system = buildSystemPrompt(knowledge, "tights", "whatsapp", undefined, undefined, "היי");
  let correct = 0;
  let bookingToSchedule = 0;
  const rows: string[] = [];
  for (const item of CASES) {
    const raw = await ask(system, item.text, apiKey);
    const parsed = extractReplyRoute(raw);
    const got = parsed.tagStatus === "ok" ? parsed.route : parsed.tagStatus;
    const ok = got === item.expected;
    if (ok) correct += 1;
    if (item.expected === "booking_change" && got === "schedule") bookingToSchedule += 1;
    rows.push(`${ok ? "ok" : "MISS"} expected=${item.expected} got=${got} | ${item.text}`);
  }
  console.log(rows.join("\n"));
  console.log(`accuracy ${correct}/${CASES.length}`);
  console.log(`booking_change->schedule ${bookingToSchedule}`);
  if (bookingToSchedule > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
