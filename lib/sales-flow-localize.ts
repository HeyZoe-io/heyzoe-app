import Anthropic from "@anthropic-ai/sdk";
import type { BusinessKnowledgePack } from "@/lib/business-context";
import type { BusinessContentLanguage } from "@/lib/business-content-lang";
import {
  CLAUDE_WHATSAPP_MAX_TOKENS,
  CLAUDE_WHATSAPP_MODEL,
  resolveClaudeApiKey,
} from "@/lib/claude";
import type { SalesFlowConfig, SalesFlowCtaButton, SalesFlowExtraStep } from "@/lib/sales-flow";
import { createHash } from "crypto";

/** Default HeyZoe Hebrew flow lines → Russian. Custom studio copy goes through Haiku (cached). */
export const HE_RU_FLOW_DICTIONARY: Record<string, string> = {
  "היי! איזה כיף שהגעת אלינו 🙂": "Привет! Как здорово, что вы к нам заглянули 🙂",
  "שמי {botName} מ־{businessName},": "Меня зовут {botName}, я из {businessName},",
  "נשמח מאוד לארח אותך אצלנו!": "Будем очень рады принять вас у нас!",
  "נשמח לארח אתכם אצלנו.": "Будем рады принять вас у нас.",
  "מה בא לך להשיג באימונים אצלנו?": "Чего хочется достичь на тренировках у нас?",
  "כוח וחיטוב": "Сила и рельеф",
  "הפחתת כאבים": "Меньше боли",
  "הפגת מתחים": "Снять напряжение",
  "פאן וגיוון באימונים": "Драйв и разнообразие",
  "מושלם. הגעת למקום הנכון.": "Отлично. Вы в правильном месте.",
  "הרשמה לשיעור ניסיון": "Запись на пробное занятие",
  "צפייה במערכת השעות": "Смотреть расписание",
  "מחירי מנויים": "Цены на абонементы",
  "רכישת סדנה": "Купить мастер-класс",
  "יצירת קשר": "Связаться",
  "הצטרפות לקורס": "Записаться на курс",
  "שנשריין לך את האימון? 🙂": "Забронировать вам занятие? 🙂",
  "אין בעיה! כתבו בטקסט חופשי ואענה 🙂": "Без проблем! Напишите свободно — и я отвечу 🙂",
  "מתי נוח לך להתחיל את הקורס?": "Когда удобно начать курс?",
  "בואו נתחיל": "Давайте начнём",
  "יש לי שאלה": "У меня вопрос",
  "בחירת אימון אחר": "Выбрать другую тренировку",
  "שיחת מכירה": "Созвон",
  "קביעת מועד לשיחה": "Назначить время звонка",
  "לקורס אונליין": "На онлайн-курс",
  "כתובתנו היא": "Мы находимся по адресу",
  "כדי שאוכל להתאים עבורך בול את מה שמעניין אותך,\nאיזה אימון הכי קורץ לך?":
    "Чтобы подобрать именно то, что вам интересно,\nкакая тренировка больше всего манит?",
  "כאן ניתן לראות את מערכת השעות שלנו": "Здесь можно посмотреть наше расписание",
};

const flowRuCache = new Map<string, SalesFlowConfig>();

function skipExactSet(knowledge: BusinessKnowledgePack): Set<string> {
  const names = [
    ...(knowledge.serviceNamesForOpening ?? []),
    ...(knowledge.openingServices ?? []).map((s) => s.name),
    ...(knowledge.salesFlowServices ?? []).map((s) => String(s.name ?? "")),
    knowledge.businessName,
    knowledge.botName,
  ];
  return new Set(names.map((n) => String(n ?? "").trim()).filter(Boolean));
}

function shouldSkipTranslate(text: string, skipExact: Set<string>): boolean {
  const t = String(text ?? "").trim();
  if (!t) return true;
  if (skipExact.has(t)) return true;
  if (/^https?:\/\//i.test(t)) return true;
  if (/^\{[A-Za-z][A-Za-z0-9_]*\}$/.test(t)) return true;
  if (!/[\u0590-\u05FF]/.test(t) && !/[A-Za-z]/.test(t)) return true;
  return false;
}

function applyDictionary(text: string): string | null {
  const t = String(text ?? "");
  if (HE_RU_FLOW_DICTIONARY[t]) return HE_RU_FLOW_DICTIONARY[t]!;
  const trimmed = t.trim();
  if (HE_RU_FLOW_DICTIONARY[trimmed]) return HE_RU_FLOW_DICTIONARY[trimmed]!;
  return null;
}

function mapExtraSteps(
  steps: SalesFlowExtraStep[] | undefined,
  translate: (s: string) => string
): SalesFlowExtraStep[] {
  return (steps ?? []).map((step) => ({
    ...step,
    question: translate(step.question),
    options: (step.options ?? []).map(translate),
    replies: (step.replies ?? []).map(translate),
  }));
}

function mapCtaButtons(
  buttons: SalesFlowCtaButton[] | undefined,
  translate: (s: string) => string
): SalesFlowCtaButton[] {
  return (buttons ?? []).map((b) => ({ ...b, label: translate(String(b.label ?? "")) }));
}

function mapConfigStrings(cfg: SalesFlowConfig, translate: (s: string) => string): SalesFlowConfig {
  const t = translate;
  return {
    ...cfg,
    greeting_opener: t(cfg.greeting_opener),
    greeting_line_name: t(cfg.greeting_line_name),
    greeting_line_tagline: t(cfg.greeting_line_tagline),
    greeting_closer: t(cfg.greeting_closer),
    greeting_body_override: cfg.greeting_body_override ? t(cfg.greeting_body_override) : cfg.greeting_body_override,
    greeting_extra_steps: mapExtraSteps(cfg.greeting_extra_steps, t),
    multi_service_question: t(cfg.multi_service_question),
    after_service_pick: t(cfg.after_service_pick),
    experience_question: t(cfg.experience_question),
    experience_options: (cfg.experience_options ?? []).map(t),
    experience_replies: (cfg.experience_replies ?? []).map(t),
    after_experience: t(cfg.after_experience),
    opening_extra_steps: mapExtraSteps(cfg.opening_extra_steps, t),
    experience_question_workshop: t(cfg.experience_question_workshop),
    experience_options_workshop: (cfg.experience_options_workshop ?? []).map(t),
    experience_replies_workshop: (cfg.experience_replies_workshop ?? []).map(t),
    after_experience_workshop: t(cfg.after_experience_workshop),
    opening_extra_steps_workshop: mapExtraSteps(cfg.opening_extra_steps_workshop, t),
    experience_question_course: t(cfg.experience_question_course),
    experience_options_course: (cfg.experience_options_course ?? []).map(t),
    experience_replies_course: (cfg.experience_replies_course ?? []).map(t),
    after_experience_course: t(cfg.after_experience_course),
    opening_extra_steps_course: mapExtraSteps(cfg.opening_extra_steps_course, t),
    cta_body: t(cfg.cta_body),
    cta_buttons: mapCtaButtons(cfg.cta_buttons, t),
    cta_workshop_body: t(cfg.cta_workshop_body),
    cta_workshop_buttons: mapCtaButtons(cfg.cta_workshop_buttons, t),
    cta_course_body: t(cfg.cta_course_body),
    cta_course_buttons: mapCtaButtons(cfg.cta_course_buttons, t),
    cta_course_online_body: t(cfg.cta_course_online_body),
    cta_extra_steps: mapExtraSteps(cfg.cta_extra_steps, t),
    followup_after_next_class_body: t(cfg.followup_after_next_class_body),
    followup_after_next_class_options: [
      t(cfg.followup_after_next_class_options[0] ?? ""),
      t(cfg.followup_after_next_class_options[1] ?? ""),
      t(cfg.followup_after_next_class_options[2] ?? ""),
    ],
    free_chat_invite_reply: t(cfg.free_chat_invite_reply),
    after_trial_registration_body: t(cfg.after_trial_registration_body),
    after_schedule_selection: t(cfg.after_schedule_selection),
    after_schedule_selection_workshop: t(cfg.after_schedule_selection_workshop),
    course_cycle_pick_question: t(cfg.course_cycle_pick_question),
    after_course_cycle_pick: t(cfg.after_course_cycle_pick),
    cta_body_after_schedule: t(cfg.cta_body_after_schedule),
    after_trial_registration_body_after_schedule: t(cfg.after_trial_registration_body_after_schedule),
    after_workshop_registration_body: t(cfg.after_workshop_registration_body),
    after_workshop_registration_body_after_schedule: t(cfg.after_workshop_registration_body_after_schedule),
    after_course_registration_body: t(cfg.after_course_registration_body),
    after_course_registration_body_after_schedule: t(cfg.after_course_registration_body_after_schedule),
  };
}

function collectUntranslated(cfg: SalesFlowConfig, skipExact: Set<string>): string[] {
  const leftover: string[] = [];
  const seen = new Set<string>();
  mapConfigStrings(cfg, (s) => {
    const raw = String(s ?? "");
    if (!raw.trim()) return raw;
    if (shouldSkipTranslate(raw, skipExact)) return raw;
    if (applyDictionary(raw)) return raw;
    if (!seen.has(raw)) {
      seen.add(raw);
      leftover.push(raw);
    }
    return raw;
  });
  return leftover;
}

function configCacheKey(cfg: SalesFlowConfig, skipExact: Set<string>): string {
  const h = createHash("sha256");
  h.update(JSON.stringify({ cfg, skip: [...skipExact].sort() }));
  return h.digest("hex");
}

async function translateLeftoversWithClaude(texts: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (texts.length === 0) return out;
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) {
    console.error("[sales-flow-localize] Missing ANTHROPIC_API_KEY — leaving custom flow copy untranslated");
    return out;
  }
  const payload: Record<string, string> = {};
  texts.forEach((t, i) => {
    payload[`s${i}`] = t;
  });
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: CLAUDE_WHATSAPP_MODEL,
      max_tokens: Math.min(4096, CLAUDE_WHATSAPP_MAX_TOKENS * 4),
      system:
        "Translate WhatsApp sales-flow strings to natural conversational Russian. Keep {placeholders}, emoji, numbers, URLs, and brand/class names unchanged. Return ONLY a JSON object mapping the same keys to translated strings. No markdown.",
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    });
    const block = response.content.find((b) => b.type === "text");
    const raw = String(block && "text" in block ? block.text : "").trim();
    const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    texts.forEach((t, i) => {
      const v = parsed[`s${i}`];
      if (typeof v === "string" && v.trim()) out.set(t, v);
    });
  } catch (e) {
    console.error("[sales-flow-localize] Claude translation failed:", e);
  }
  return out;
}

/**
 * Clone the built sales flow into Russian for this lead.
 * Dictionary first (no API); leftover custom copy = one Haiku call, cached in-memory by config hash.
 */
export async function localizeSalesFlowConfigToRussian(
  cfg: SalesFlowConfig,
  skipExact: Set<string>
): Promise<SalesFlowConfig> {
  const key = configCacheKey(cfg, skipExact);
  const cached = flowRuCache.get(key);
  if (cached) return cached;

  const leftovers = collectUntranslated(cfg, skipExact);
  const claudeMap = leftovers.length ? await translateLeftoversWithClaude(leftovers) : new Map<string, string>();
  const translate = (s: string) => {
    const raw = String(s ?? "");
    if (!raw.trim()) return raw;
    if (shouldSkipTranslate(raw, skipExact)) return raw;
    return applyDictionary(raw) ?? claudeMap.get(raw) ?? raw;
  };
  const localized = mapConfigStrings(cfg, translate);
  flowRuCache.set(key, localized);
  return localized;
}

export async function localizeKnowledgePackForLead(
  knowledge: BusinessKnowledgePack,
  lang: BusinessContentLanguage
): Promise<void> {
  knowledge.leadUiLang = lang;
  if (lang !== "ru") return;
  const skipExact = skipExactSet(knowledge);
  const translateOne = async (s: string) => {
    const raw = String(s ?? "");
    if (!raw.trim() || shouldSkipTranslate(raw, skipExact)) return raw;
    const dict = applyDictionary(raw);
    if (dict) return dict;
    const map = await translateLeftoversWithClaude([raw]);
    return map.get(raw) ?? raw;
  };
  if (knowledge.salesFlowConfig) {
    knowledge.salesFlowConfig = await localizeSalesFlowConfigToRussian(knowledge.salesFlowConfig, skipExact);
  }
  if (knowledge.welcomeIntroText) {
    knowledge.welcomeIntroText = await translateOne(knowledge.welcomeIntroText);
  }
  if (knowledge.welcomeQuestionText) {
    knowledge.welcomeQuestionText = await translateOne(knowledge.welcomeQuestionText);
  }
  if (knowledge.welcomeOptionLabels?.length) {
    knowledge.welcomeOptionLabels = await Promise.all(
      knowledge.welcomeOptionLabels.map((label) => translateOne(label))
    );
  }
}

/** Exposed for tests — dictionary + skip, no API. */
export function localizeSalesFlowConfigWithDictionaryOnly(
  cfg: SalesFlowConfig,
  skipExact: Set<string> = new Set()
): SalesFlowConfig {
  return mapConfigStrings(cfg, (s) => {
    const raw = String(s ?? "");
    if (!raw.trim() || shouldSkipTranslate(raw, skipExact)) return raw;
    return applyDictionary(raw) ?? raw;
  });
}
