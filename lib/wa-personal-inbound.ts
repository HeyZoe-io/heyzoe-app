import type { SupabaseClient } from "@supabase/supabase-js";
import { matchComplaintPlaybook, matchRefundPlaybook } from "@/lib/wa-closed-playbook-intents";
import { parseModelUsed } from "@/lib/wa-reply-route";
import type { WaReplyAddressingMode } from "@/lib/wa-assistant-reply-fixes";

/**
 * A short reply counts as answering the owner only when their manual message
 * is still the latest outbound and landed inside this window.
 */
export const OWNER_SHORT_REPLY_WINDOW_MS = 72 * 60 * 60 * 1000;

/** A manual owner message anywhere in this window is one relationship signal. */
export const PERSONAL_RELATION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Coexistence echoes are stored as wa_business_app. */
export const MANUAL_OWNER_ECHO_MODEL = "wa_business_app";

/**
 * An endearment alone is not personal. Many leads open with one to the bot.
 * A nickname such as מאיוש comes from ownerNames, not from this list.
 */
export const OWNER_ENDEARMENTS = ["אהובה", "אהובי", "מאמי", "מותק", "נשמה", "יקירה", "יקירי"] as const;

/** Phrases that point at a past conversation with the owner, not at the bot. */
export const PAST_INTERACTION_PHRASES = [
  "אמרת לי",
  "אמרתם לי",
  "דיברנו",
  "לא הגעתי",
  "ביקשתי ממך",
  "ביקשתי מכם",
  "כמו שסיכמנו",
  "כמו שדיברנו",
] as const;

const GREETINGS = new Set(["היי", "הי", "היוש", "שלום", "אהלן", "בוקר", "טוב", "ערב"]);
const AFFIRMATIONS = new Set([
  "כן",
  "סבבה",
  "בסדר",
  "אוקיי",
  "אוקי",
  "ok",
  "okay",
  "yes",
  "יאללה",
  "בטח",
  "סגור",
  "מתאים",
  "אשמח",
  "בכיף",
]);
const NEGATIONS = new Set(["לא", "no"]);
const FILLERS = new Set([...GREETINGS, "תודה", "רבה", "בבקשה"]);
const BLOCKED_NAME_TOKENS = new Set(["זואי", "zoe", "היי", "הי"]);

/** A real studio request stays on its route. Personal does not swallow it. */
const STUDIO_ACTION_RE =
  /לבטל|להעביר|להזיז|תעביר|תזיז|תמחקי|תמחק|החזר|זיכוי|לקבוצת וואטסאפ|לקבוצה/;

export type PersonalTurn = {
  role: "user" | "assistant";
  created_at: string;
  model_used?: string | null;
};

export type PersonalRouteTrigger = "owner_short_reply" | "personal_address" | "claude";

export type PersonalRelationSignal = "member" | "owner_message" | "past_interaction";

export type PersonalInboundDecision = {
  trigger: Exclude<PersonalRouteTrigger, "claude"> | null;
  signals: PersonalRelationSignal[];
  blockedByStudioAction: boolean;
};

export type PersonalInboundInput = {
  text: string;
  turns: PersonalTurn[];
  /** Only true counts. false and null are unknown, not a signal. */
  arboxIsMember: boolean;
  ownerNames?: string[];
  nowMs: number;
};

function tokensOf(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function normalized(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function isManualOwnerEcho(model: string | null | undefined): boolean {
  return parseModelUsed(model).model === MANUAL_OWNER_ECHO_MODEL;
}

export function isShortOwnerReply(text: string): boolean {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 80) return false;
  const hasEmoji = /\p{Extended_Pictographic}/u.test(raw);
  const words = tokensOf(
    raw
      .replace(/\p{Extended_Pictographic}/gu, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
  ).map((word) => word.toLowerCase());
  const content = words.filter((word) => !FILLERS.has(word));
  if (!content.length) return hasEmoji;
  if (content.length > 4) return false;
  return content.every((word) => AFFIRMATIONS.has(word)) || content.every((word) => NEGATIONS.has(word));
}

export function mentionsOwnerAddress(text: string, ownerNames: string[] = []): boolean {
  const tokens = new Set(tokensOf(text));
  if (OWNER_ENDEARMENTS.some((word) => tokens.has(word))) return true;
  for (const name of ownerNames) {
    for (const token of tokensOf(name)) {
      if (token.length < 2 || BLOCKED_NAME_TOKENS.has(token.toLowerCase())) continue;
      if (tokens.has(token)) return true;
    }
  }
  return false;
}

export function hasPastInteractionPhrase(text: string): boolean {
  const flat = normalized(text);
  return PAST_INTERACTION_PHRASES.some((phrase) => flat.includes(phrase));
}

export function isBareEndearmentGreeting(text: string, ownerNames: string[] = []): boolean {
  const tokens = tokensOf(text);
  if (!tokens.length || !mentionsOwnerAddress(text, ownerNames)) return false;
  const names = new Set(
    ownerNames.flatMap((name) => tokensOf(name)).filter((token) => token.length >= 2 && !BLOCKED_NAME_TOKENS.has(token.toLowerCase()))
  );
  return tokens.every(
    (token) => GREETINGS.has(token) || (OWNER_ENDEARMENTS as readonly string[]).includes(token) || names.has(token)
  );
}

function latestAssistant(turns: PersonalTurn[], nowMs: number): PersonalTurn | null {
  let best: PersonalTurn | null = null;
  let bestMs = -Infinity;
  for (const turn of turns) {
    if (turn.role !== "assistant") continue;
    const ms = Date.parse(turn.created_at);
    if (!Number.isFinite(ms) || ms > nowMs || ms < bestMs) continue;
    best = turn;
    bestMs = ms;
  }
  return best;
}

function hasOwnerEchoWithin(turns: PersonalTurn[], nowMs: number, windowMs: number): boolean {
  for (const turn of turns) {
    if (turn.role !== "assistant" || !isManualOwnerEcho(turn.model_used)) continue;
    const ms = Date.parse(turn.created_at);
    if (!Number.isFinite(ms) || ms > nowMs) continue;
    if (nowMs - ms <= windowMs) return true;
  }
  return false;
}

export function explainPersonalInbound(input: PersonalInboundInput): PersonalInboundDecision {
  const text = String(input.text ?? "");
  const names = input.ownerNames ?? [];
  const signals: PersonalRelationSignal[] = [];
  if (input.arboxIsMember === true) signals.push("member");
  if (hasOwnerEchoWithin(input.turns, input.nowMs, PERSONAL_RELATION_WINDOW_MS)) signals.push("owner_message");
  if (hasPastInteractionPhrase(text)) signals.push("past_interaction");

  const latest = latestAssistant(input.turns, input.nowMs);
  const latestMs = latest ? Date.parse(latest.created_at) : NaN;
  const ownerIsLatest =
    Boolean(latest) &&
    isManualOwnerEcho(latest?.model_used) &&
    Number.isFinite(latestMs) &&
    input.nowMs - latestMs <= OWNER_SHORT_REPLY_WINDOW_MS;
  if (ownerIsLatest && isShortOwnerReply(text)) {
    return { trigger: "owner_short_reply", signals, blockedByStudioAction: false };
  }

  const addressed = mentionsOwnerAddress(text, names);
  const studioAction = STUDIO_ACTION_RE.test(normalized(text));
  if (addressed && signals.length > 0 && !studioAction) {
    return { trigger: "personal_address", signals, blockedByStudioAction: false };
  }
  return { trigger: null, signals: addressed ? signals : [], blockedByStudioAction: addressed && studioAction };
}

export function decidePersonalInbound(input: PersonalInboundInput): Exclude<PersonalRouteTrigger, "claude"> | null {
  return explainPersonalInbound(input).trigger;
}

/** Casual openers that are wrong at the start of a complaint, refund, or credit reply. Longest first. */
export const RULE3_CASUAL_OPENERS = ["אין בעיה בכלל", "אין שום בעיה", "אין בעיה", "סבבה", "בכיף"] as const;

/** Sent when stripping the opener would leave an empty or too-short reply. */
export const RULE3_ACK_FALLBACK: Record<WaReplyAddressingMode, string> = {
  feminine: "תודה ששיתפת, אני מעבירה את זה לצוות 💜",
  neutral: "תודה ששיתפת, זה עובר לצוות 💜",
  plural: "תודה ששיתפתם, זה עובר לצוות 💜",
};

const RULE3_OPENER_TRAIL =
  /^(?:[\s,،!.\-–—:;'"׳״“”«»…?]|[\p{Extended_Pictographic}\uFE0F\u200D])+/u;
const RULE3_CREDIT_RE = /זיכוי|לזכות|תזכ(?:ו|י|ה)(?!ר)/u;
const RULE3_MIN_WORDS = 3;

export type ComplaintReplyContext = {
  inbound: string;
  hintCategory?: string | null;
  route?: string | null;
};

/**
 * Complaint context is the closed-playbook refund/complaint hit, a credit request
 * (no playbook category), or Claude's handoff tag when no other hint already
 * classified the turn. A bare handoff with a different hint stays out.
 */
export function isComplaintReplyContext(input: ComplaintReplyContext): boolean {
  const hint = String(input.hintCategory ?? "").trim();
  if (hint === "refund" || hint === "complaint") return true;
  const inbound = String(input.inbound ?? "");
  if (matchRefundPlaybook(inbound) || matchComplaintPlaybook(inbound)) return true;
  if (RULE3_CREDIT_RE.test(inbound)) return true;
  return input.route === "handoff" && !hint;
}

function complaintAckFallback(mode: WaReplyAddressingMode | undefined): string {
  if (mode === "feminine" || mode === "plural") return RULE3_ACK_FALLBACK[mode];
  return RULE3_ACK_FALLBACK.neutral;
}

function stripLeadingCasualOpener(text: string): { opener: string; rest: string } | null {
  const raw = String(text ?? "").replace(/^\s+/u, "");
  for (const opener of RULE3_CASUAL_OPENERS) {
    if (!raw.startsWith(opener)) continue;
    const after = raw.slice(opener.length);
    if (after && /[\p{L}\p{N}]/u.test(after[0] ?? "")) continue;
    return { opener, rest: after.replace(RULE3_OPENER_TRAIL, "").trim() };
  }
  return null;
}

function hebrewWordCount(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

/**
 * Safety net for a generated lead-facing reply. Runs only in complaint context.
 * A phrase in the middle of the sentence stays.
 */
export function applyComplaintOpenerSafetyNet(
  text: string,
  input: ComplaintReplyContext & {
    addressingMode?: WaReplyAddressingMode;
    businessId?: string | number | null;
  }
): string {
  if (!isComplaintReplyContext(input)) return text;
  const hit = stripLeadingCasualOpener(text);
  if (!hit) return text;
  console.info("[rule3] stripped_opener", {
    business_id: input.businessId ?? null,
    opener: hit.opener,
  });
  if (hebrewWordCount(hit.rest) < RULE3_MIN_WORDS) return complaintAckFallback(input.addressingMode);
  return hit.rest;
}

/** Rule 4: the booking_change policy replacement must not run. */
export function ownerShortReplyBlocksBookingChange(input: PersonalInboundInput): boolean {
  return decidePersonalInbound(input) === "owner_short_reply";
}

/**
 * Claude may still tag a bare «היי אהובה» as personal. That tag does not stand
 * when the deterministic rule did not fire. Other personal tags stay.
 */
export function claudePersonalTagStands(input: PersonalInboundInput): boolean {
  if (decidePersonalInbound(input)) return true;
  return !isBareEndearmentGreeting(input.text, input.ownerNames);
}

export async function loadPersonalRouteTurns(input: {
  admin: SupabaseClient;
  businessSlug: string;
  sessionId: string;
  nowMs: number;
}): Promise<PersonalTurn[]> {
  try {
    const since = new Date(input.nowMs - PERSONAL_RELATION_WINDOW_MS).toISOString();
    const { data, error } = await input.admin
      .from("messages")
      .select("role, created_at, model_used")
      .eq("business_slug", input.businessSlug)
      .eq("session_id", input.sessionId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(80);
    if (error || !data) {
      console.error("[wa-personal-inbound] turns failed:", error?.message ?? "empty");
      return [];
    }
    const out: PersonalTurn[] = [];
    for (const row of data) {
      if (row.role !== "assistant" && row.role !== "user") continue;
      out.push({
        role: row.role,
        created_at: String(row.created_at ?? ""),
        model_used: typeof row.model_used === "string" ? row.model_used : null,
      });
    }
    return out;
  } catch (e) {
    console.error("[wa-personal-inbound] turns failed:", e);
    return [];
  }
}

export async function completePersonalRoute(input: {
  admin: SupabaseClient;
  businessSlug: string;
  sessionId: string;
  now: Date;
  businessId?: string | number | null;
  leadPhone: string;
  requestedAtIso: string;
  trigger: PersonalRouteTrigger;
}): Promise<void> {
  try {
    const { pauseBusinessSessionForPersonalMessage } = await import("@/lib/wa-app-echo-pause");
    await pauseBusinessSessionForPersonalMessage({
      admin: input.admin,
      businessSlug: input.businessSlug,
      sessionId: input.sessionId,
      now: input.now,
      trigger: input.trigger,
    });
  } catch (e) {
    console.error("[wa-personal-inbound] pause failed:", e);
  }
  if (input.businessId) {
    try {
      const { triggerHumanRequestedNotification } = await import("@/lib/notifications/triggers");
      await triggerHumanRequestedNotification({
        businessId: Number(input.businessId),
        leadPhone: input.leadPhone,
        requestedAtIso: input.requestedAtIso,
      });
    } catch (e) {
      console.error("[wa-personal-inbound] owner notification failed:", e);
    }
  }
  console.info("[wa-personal-inbound] paused, no reply", {
    business_slug: input.businessSlug,
    sessionId: input.sessionId,
    trigger: input.trigger,
  });
}

export type ZoeCapabilityFlags = {
  hasArboxConnection?: boolean;
  canShowSchedule?: boolean;
  canSendMembershipLink?: boolean;
  canScheduleCall?: boolean;
  canSendTrialLink?: boolean;
  addressingMode?: WaReplyAddressingMode;
};

export function describeZoeCapabilities(flags: ZoeCapabilityFlags): string {
  const can = ["לענות מהידע"];
  if (flags.canShowSchedule) can.push("להראות מערכת שעות");
  if (flags.hasArboxConnection) can.push("להפנות לוידוא הרשמה באפליקציה");
  if (flags.canSendMembershipLink) can.push("לשלוח קישור למנוי");
  if (flags.canScheduleCall) can.push("לתאם שיחת היכרות");
  if (flags.canSendTrialLink) can.push("להפנות להרשמה לאימון ניסיון");
  return can.join(", ");
}

function rule3AckExamples(mode: WaReplyAddressingMode | undefined): { ack: string; example: string } {
  if (mode === "feminine") {
    return {
      ack: "תודה ששיתפת, מבינה, או מצטערת לשמוע כשזה מתאים",
      example: "תודה ששיתפת, אני מעבירה את הבקשה לצוות.",
    };
  }
  if (mode === "plural") {
    return {
      ack: "תודה ששיתפתם, או מצטערים לשמוע כשזה מתאים",
      example: "תודה ששיתפתם, הבקשה עוברת לצוות.",
    };
  }
  return {
    ack: "תודה ששיתפת",
    example: "תודה ששיתפת, הבקשה עוברת לצוות.",
  };
}

/** Rules 1, 2, 3, 6, plus a short backup for 4 and 5. Route tags stay here. */
export function buildBehaviorJudgmentBlock(flags: ZoeCapabilityFlags): string {
  const can = describeZoeCapabilities(flags);
  const rule3 = rule3AckExamples(flags.addressingMode);
  return `שיפוט:
- אסור לאשר או להכחיש מה שהבעלים או המאמנת אמרו, עשו או הבטיחו. הפנייה עוברת אליהם, בלי פסקת מכירה. דוגמה: «לא הגעתי כי אמרת לי שלא תהיי» -> [[route:personal]]
- כאן אפשר: ${can}. אי אפשר לבצע מכאן: להעביר שיעור, לבטל הרשמה, לתת החזר או זיכוי, להוסיף לקבוצת וואטסאפ. תייגי class_move, booking_change או handoff, בלי להבטיח שזה יבוצע ובלי לשאול «לאיזה יום?». דוגמה: «אני חולה, אפשר להעביר את השיעור?» -> [[route:class_move]]
- תלונה, משוב שלילי, או בקשת החזר או זיכוי: פותחים בהכרה במה שנאמר (${rule3.ack}), ואז אומרים שהבקשה עוברת לצוות. דוגמה: «אני רוצה החזר» -> [[route:handoff]] ${rule3.example}
- פרט עם יותר ממשמעות אחת (13 כשעה או כתאריך, יום או שם לא ברורים): אל תבחרי. שאלת הבהרה אחת, או handoff אם אי אפשר לבצע את הפעולה מכאן. דוגמה: «תמחקי את 13 ביום חמישי» -> [[route:handoff]] בלי להניח שזו השעה 13:00.`;
}

/** Same situations inside a flow, without route tags, because the text is sent as-is. */
export function buildFreeQuestionBehaviorBlock(flags: ZoeCapabilityFlags): string {
  const can = describeZoeCapabilities(flags);
  const rule3 = rule3AckExamples(flags.addressingMode);
  return `עני בעד 2-3 משפטים.
- אסור לאשר או להכחיש מה שהבעלים או המאמנת אמרו, עשו או הבטיחו. כותבים שהפנייה עוברת לבעלים.
- אפשר: ${can}. אי אפשר להעביר שיעור, לבטל הרשמה, לתת החזר או זיכוי, או להוסיף לקבוצת וואטסאפ. על אלה כותבים שהפנייה עוברת לצוות, בלי לשאול «לאיזה יום?».
- בתלונה, במשוב שלילי, או בבקשת החזר או זיכוי: פותחים בהכרה במה שנאמר (${rule3.ack}), ואז כותבים שהבקשה עוברת לצוות. דוגמה: «${rule3.example}»
- פרט עם יותר ממשמעות אחת: אל תניחי. שאלה אחת קצרה, או העברה לצוות אם אי אפשר לבצע את הפעולה.`;
}
