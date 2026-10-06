/**
 * Real Haiku replay of the Omers pre-Claude misfires, plus nearby phrasings.
 * Not part of CI.
 *
 *   npx tsx --env-file=.env.local scripts/eval-pre-claude-incidents.ts
 */
import { CLAUDE_WHATSAPP_MAX_TOKENS, CLAUDE_WHATSAPP_MODEL, resolveClaudeApiKey } from "@/lib/claude";
import { buildSystemPrompt, getBusinessKnowledgePack } from "@/lib/business-context";
import { extractReplyRoute, type WaReplyRoute } from "@/lib/wa-reply-route";
import { collectPreClaudeHint } from "@/lib/wa-pre-claude-hint";
import { formatFastPathHintLine } from "@/lib/wa-fast-path-hint";
import { isWholeMessageTimetableRequest } from "@/lib/wa-send-before-claude";

type Turn = { role: "user" | "assistant"; content: string };
type Case = {
  id: string;
  history: Turn[];
  text: string;
  accept: Array<WaReplyRoute | "missing">;
  forbidScheduleLink: boolean;
};

const MOVE = "היי יש סיכוי להחליף שעה היום אני רשומה לחמש וחצי ואני רוצה לבוא בשש וחצי";
const WAIT =
  "ביום שישי נרשמתי לרשימת המתנה לשני אימונים, התפנו לשניהם אז ביטלתי אימון אחד נרשם לי ביטול מאוחר שצריך לבטל אותו כדי שאוכל לנצל את המנוי שלי";

const CASES: Case[] = [
  { id: "move", history: [], text: MOVE, accept: ["booking_change"], forbidScheduleLink: true },
  {
    id: "move-follow",
    history: [
      { role: "user", content: MOVE },
      { role: "assistant", content: "אעביר את הפנייה לצוות" },
    ],
    text: "אני רשומה אני רוצה להחליף",
    accept: ["booking_change", "class_move", "class_move_member", "class_move_trial", "handoff"],
    forbidScheduleLink: true,
  },
  { id: "dot", history: [], text: "ת", accept: ["answer", "missing"], forbidScheduleLink: true },
  { id: "waitlist", history: [], text: WAIT, accept: ["booking_change", "handoff"], forbidScheduleLink: true },
  { id: "reg-check", history: [], text: "אני רשומה לשיעור של מחר?", accept: ["registration_check"], forbidScheduleLink: true },
  { id: "my-schedule", history: [], text: "מתי האימון שלי?", accept: ["my_schedule"], forbidScheduleLink: true },
  { id: "real-schedule", history: [], text: "מה יש ביום שני בבוקר?", accept: ["schedule"], forbidScheduleLink: false },
  { id: "real-schedule-2", history: [], text: "מתי יש פילאטיס השבוע?", accept: ["schedule"], forbidScheduleLink: false },
  { id: "two-as-number", history: [], text: "אפשר שני אימונים בשבוע?", accept: ["answer", "interest", "signup", "schedule"], forbidScheduleLink: false },
  { id: "registered-story", history: [], text: "נרשמתי אתמול לרשימת המתנה ולא התפנה מקום", accept: ["booking_change", "handoff", "answer"], forbidScheduleLink: true },
];

const NON_SCHEDULE = [
  "אני רשומה כבר חודשיים למנוי",
  "נרשמתי ולא עובד",
  "לשני הילדים יש אימון ניסיון",
  "ביום שישי אני לא יכולה, זה יום עבודה",
  "שני כרטיסים נשארו לי",
  "אני רשומה אבל רוצה לבטל את הביטול המאוחר",
  "נרשמתי בטעות ונרשם ביטול",
  "רק מספרת שנרשמתי, תודה",
  "שישי וגם שני בערב עמוסים אצלי בעבודה",
  "אני רשומה אצלכם משנה שעברה",
  "נרשמתי לרשימת המתנה לשני מקומות",
  "היום שישי אז אני שואלת על המנוי לא על לוח",
  "שנינו רשומים, אני והבת שלי",
  "נרשמתי לחתונה לא לשיעור",
  "אני רשומה לניוזלטר?",
  "ביום שני יש לי עבודה עד מאוחר",
  "לשני אנשים אפשר מחיר?",
  "נרשמתי לשישי כי חשבתי שזה פתוח",
  "אני רשומה ואני כועסת על הביטול המאוחר",
  "שני שיעורים ביטלתי בטעות",
];

const REAL_SCHEDULE = [
  "מה יש ביום שלישי?",
  "יש שיעורים אחרי 18:00?",
  "איזה אימונים יש ביום חמישי?",
  "מתי יש אימון בבוקר?",
  "אפשר לראות מה יש מחר בערב?",
  "מה יש ביום ראשון?",
  "יש משהו בבוקר בימי שני?",
  "מתי השיעורים השבוע?",
  "אני רשומה לשיעור של מחר?",
  "רק רציתי לוודא את ההרשמה של מחר",
];

function expectNonSchedule(text: string): Case {
  return {
    id: `non-${text.slice(0, 18)}`,
    history: [],
    text,
    accept: ["booking_change", "handoff", "answer", "interest", "signup", "class_move", "class_move_member", "class_move_trial", "registration_check", "my_schedule", "policy_question", "personal", "member_or_trial_unclear"],
    forbidScheduleLink: true,
  };
}

function expectSchedule(text: string): Case {
  const registration = /רשומ|לוודא/.test(text);
  return {
    id: `sched-${text.slice(0, 18)}`,
    history: [],
    text,
    accept: registration ? ["registration_check", "my_schedule"] : ["schedule"],
    forbidScheduleLink: false,
  };
}

async function ask(system: string, messages: Turn[], apiKey: string) {
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
      messages,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const retry = await fetch("https://api.anthropic.com/v1/messages", {
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
          messages,
        }),
      });
      if (!retry.ok) throw new Error(`Claude ${retry.status}: ${await retry.text()}`);
      const retryJson = (await retry.json()) as {
        content?: Array<{ type?: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const retryText = (retryJson.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("\n")
        .trim();
      return {
        text: retryText,
        input: retryJson.usage?.input_tokens ?? 0,
        output: retryJson.usage?.output_tokens ?? 0,
      };
    }
    throw new Error(`Claude ${res.status}: ${body}`);
  }
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
  const knowledge = await getBusinessKnowledgePack("omers-place");
  const system = buildSystemPrompt(knowledge, "omers-place", "whatsapp");
  const cases = [
    ...CASES,
    ...NON_SCHEDULE.map(expectNonSchedule),
    ...REAL_SCHEDULE.map(expectSchedule),
  ];
  let input = 0;
  let output = 0;
  let failed = 0;
  for (const item of cases) {
    if (isWholeMessageTimetableRequest(item.text)) {
      console.log(`FAIL ${item.id} whole-message timetable fast path`);
      failed += 1;
      continue;
    }
    const hint = collectPreClaudeHint(item.text);
    const messages: Turn[] = [...item.history, { role: "user", content: item.text }];
    if (hint) {
      const last = messages[messages.length - 1];
      if (last && last.role === "user") {
        last.content = `${last.content}\n\n${formatFastPathHintLine(hint)}`;
      }
    }
    const reply = await ask(system, messages, apiKey);
    input += reply.input;
    output += reply.output;
    const parsed = extractReplyRoute(reply.text);
    const got = parsed.tagStatus === "ok" && parsed.route ? parsed.route : "missing";
    const link = /arboxapp\.com|https?:\/\//u.test(reply.text);
    const ok = item.accept.includes(got) && !(item.forbidScheduleLink && link);
    if (!ok) failed += 1;
    console.log(`${ok ? "ok" : "FAIL"} ${item.id} got=${got} hint=${hint?.category ?? "-"} | ${item.text.slice(0, 72)}`);
  }
  const cost = (input / 1_000_000) * 1 + (output / 1_000_000) * 5;
  console.log(JSON.stringify({ cases: cases.length, failed, input, output, costUsd: cost }));
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
