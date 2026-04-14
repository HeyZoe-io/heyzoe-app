/**
 * מסלול מכירה מובנה — פתיחה + הנעה לפעולה, סנכרון ל-welcome_message ולפרומפט זואי.
 */

export type SalesFlowExtraStep = {
  id: string;
  question: string;
  options: string[];
};

export type SalesFlowCtaButton = {
  id: string;
  label: string;
  kind: "schedule" | "trial" | "memberships" | "next_class";
};

export type SalesFlowConfig = {
  opening_note: string;
  greeting_opener: string;
  greeting_line_name: string;
  greeting_line_tagline: string;
  greeting_closer: string;
  /** שאלות עם כפתורים מיד אחרי טקסט הפתיחה (לפני בחירת אימון) */
  greeting_extra_steps: SalesFlowExtraStep[];
  multi_service_question: string;
  after_service_pick: string;
  experience_question: string;
  experience_options: [string, string, string];
  after_experience: string;
  opening_extra_steps: SalesFlowExtraStep[];
  cta_body: string;
  cta_buttons: SalesFlowCtaButton[];
  cta_extra_steps: SalesFlowExtraStep[];
  /** אחרי מענה «מתי השיעור קרוב?» — הודעת מערכת שנייה עם תפריט הרשמה/לוח/שאלה */
  followup_after_next_class_body: string;
  followup_after_next_class_options: [string, string, string];
  /** אחרי «יש לי שאלה אחרת…» מהתפריט המשני */
  free_chat_invite_reply: string;
  /** הודעה/הנחיה לזואי אחרי שהלקוח השלים הרשמה לאימון ניסיון */
  after_trial_registration_body: string;
  /** מיגרציה ממסלול ישן — דורס את הברכה המורכבת */
  greeting_body_override?: string;
};

const FRIENDLY: SalesFlowConfig = {
  opening_note:
    "פתיחה ופרטים שחשובים לך לפני שהליד נרשם לשיעור ניסיון. כל תשובה בפלואו נשלחת יחד עם השאלה הבאה וכפתורי בחירה (או רשימה ממוספרת כשיש יותר משלושה אימונים).",
  greeting_opener: "היי! איזה כיף שהגעת אלינו 🙂",
  greeting_line_name: "שמי {botName} מ־{businessName},",
  greeting_line_tagline: "{tagline}",
  greeting_closer: "נשמח מאוד לארח אותך אצלנו!",
  greeting_extra_steps: [],
  multi_service_question:
    "כדי שאוכל להתאים עבורך בול את מה שמעניין אותך,\nאיזה אימון הכי קורץ לך?",
  /** {serviceName} ימולא כביטוי טבעי (למשל «שיעורי אקרו»); אין חובה לכלול {benefitLine} */
  after_service_pick:
    "אוקיי מדהים! {serviceName} שלנו זו דרך וואו להתחזק, להתגמש, להכיר אנשים מדהימים ולמצוא אהבה חדשה לאימון.",
  experience_question: "האם יצא לך לנסות {serviceName} בעבר?",
  experience_options: [
    "כן, לא מעט פעמים!",
    "יצא לי פעם פעמיים…",
    "עדיין לא :)",
  ],
  after_experience:
    "מגניב לגמרי, יש לנו אימונים לכל הרמות, כך שכל אחד ואחת יכולים למצוא את עצמם.",
  opening_extra_steps: [],
  cta_body: "מה דעתך שנבדוק מתי האימון ניסיון הבא?",
  cta_buttons: [
    { id: "cta-next", label: "מתי השיעור קרוב?", kind: "next_class" },
    { id: "cta-trial", label: "הרשמה לשיעור ניסיון", kind: "trial" },
    { id: "cta-memberships", label: "מה מחירי המנויים?", kind: "memberships" },
  ],
  cta_extra_steps: [],
  followup_after_next_class_body:
    "בואו נשריין לך את האימון! אל דאגה, ביכולתך לבחור כל אימון ממערכת השעות בלחיצה על הכפתור",
  followup_after_next_class_options: [
    "הרשמה לשיעור ניסיון",
    "צפייה במערכת השעות",
    "צפייה במחירי מנויים וכרטיסיות",
  ],
  free_chat_invite_reply: "אין בעיה! כתבו בטקסט חופשי ואענה 🙂",
  after_trial_registration_body: `כל הכבוד! נרשמת בהצלחה 🎉

מתרגשים לראותך בקרוב!
זה קורה בכתובת: {business_address}

ככה מגיעים אלינו:
{business_directions}

מומלץ להגיע לאימון לפחות 10 דקות לפני, עם בקבוק מים ומגבת אישית!
סופר מחכים לראותך. נתראה בקרוב!

{instagram_cta}`,
};

const FORMAL: SalesFlowConfig = {
  ...FRIENDLY,
  greeting_opener: "שלום וברוכים הבאים.",
  greeting_closer: "נשמח לארח אתכם אצלנו.",
  after_service_pick:
    "מצוין. {serviceName} שלנו הם הזדמנות נעימה להתחזק, להתגמש ולהרגיש את האיזון — בגוף ובנפש, בקצב מקצועי ותומך.",
  after_experience:
    "מצוין. יש לנו אימונים לכל הרמות, ונשמח למצוא עבורכם את ההתאמה הנכונה.",
  cta_body: "מה דעתכם שנבדוק מתי אימון הניסיון הבא?",
  cta_buttons: [
    { id: "cta-next", label: "מתי השיעור קרוב?", kind: "next_class" },
    { id: "cta-trial", label: "הרשמה לשיעור ניסיון", kind: "trial" },
    { id: "cta-memberships", label: "מה מחירי המנויים?", kind: "memberships" },
  ],
  followup_after_next_class_body:
    "בואו נשריין לכם את האימון. ניתן לבחור כל אימון ממערכת השעות בלחיצה על הכפתור.",
  followup_after_next_class_options: [
    "הרשמה לשיעור ניסיון",
    "צפייה במערכת השעות",
    "צפייה במחירי מנויים וכרטיסיות",
  ],
  free_chat_invite_reply: "אין בעיה. כתבו בטקסט חופשי ונשיב בהקדם.",
  after_trial_registration_body: `ברכות על ההרשמה.

נשמח לפגוש אתכם בקרוב!
המפגש יתקיים בכתובת: {business_address}

ככה מגיעים אלינו:
{business_directions}

מומלץ להגיע כ־10 דקות לפני, עם בקבוק מים ומגבת אישית.
נשמח לראותכם בקרוב.

{instagram_cta}`,
};

const DIRECT: SalesFlowConfig = {
  ...FRIENDLY,
  greeting_opener: "היי,",
  multi_service_question: "איזה אימון מעניין אותך?",
  after_service_pick:
    "אוקיי. {serviceName} שלנו — להתחזק, להתגמש, ולהרגיש שזה בדיוק בשבילך.",
  cta_body: "נבדוק מתי אימון הניסיון הבא?",
  cta_buttons: [
    { id: "cta-next", label: "מתי השיעור קרוב?", kind: "next_class" },
    { id: "cta-trial", label: "הרשמה לשיעור ניסיון", kind: "trial" },
    { id: "cta-memberships", label: "מה מחירי המנויים?", kind: "memberships" },
  ],
  followup_after_next_class_body:
    "בואו נשריין. תבחרו אימון ממערכת השעות בכפתור.",
  followup_after_next_class_options: [
    "הרשמה לשיעור ניסיון",
    "צפייה במערכת השעות",
    "צפייה במחירי מנויים וכרטיסיות",
  ],
  free_chat_invite_reply: "אין בעיה. כתבו בצ׳אט חופשי.",
};

export function defaultSalesFlowConfig(vibeLabels: string[]): SalesFlowConfig {
  const v = new Set(vibeLabels);
  if (v.has("יוקרתי") || v.has("מקצועי") || v.has("סמכותי")) {
    return structuredClone(FORMAL);
  }
  if (v.has("ישיר")) {
    return structuredClone(DIRECT);
  }
  return structuredClone(FRIENDLY);
}

function parseExtraSteps(raw: unknown): SalesFlowExtraStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => {
      if (!x || typeof x !== "object") return null;
      const o = x as Record<string, unknown>;
      const opts = Array.isArray(o.options) ? o.options.map((z) => String(z ?? "")) : [];
      return {
        id: typeof o.id === "string" ? o.id : Math.random().toString(36).slice(2, 9),
        question: String(o.question ?? ""),
        options: opts,
      };
    })
    .filter((x): x is SalesFlowExtraStep => x !== null);
}

function parseCtaButtons(raw: unknown): SalesFlowCtaButton[] {
  if (!Array.isArray(raw)) return structuredClone(FRIENDLY.cta_buttons);
  const out: SalesFlowCtaButton[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const kind =
      o.kind === "schedule" || o.kind === "trial" || o.kind === "memberships" || o.kind === "next_class"
        ? o.kind
        : "trial";
    out.push({
      id: typeof o.id === "string" ? o.id : Math.random().toString(36).slice(2, 9),
      label: String(o.label ?? ""),
      kind,
    });
  }
  return out.length ? out : structuredClone(FRIENDLY.cta_buttons);
}

export function parseSalesFlowFromSocial(raw: unknown): SalesFlowConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const ex = (i: unknown): [string, string, string] => {
    if (!Array.isArray(i) || i.length < 3) return structuredClone(FRIENDLY.experience_options);
    return [String(i[0] ?? ""), String(i[1] ?? ""), String(i[2] ?? "")];
  };
  const exFollow = (i: unknown): [string, string, string] => {
    if (!Array.isArray(i) || i.length < 3) return structuredClone(FRIENDLY.followup_after_next_class_options);
    return [String(i[0] ?? ""), String(i[1] ?? ""), String(i[2] ?? "")];
  };
  const base = defaultSalesFlowConfig([]);
  return {
    opening_note: typeof o.opening_note === "string" ? o.opening_note : base.opening_note,
    greeting_opener: typeof o.greeting_opener === "string" ? o.greeting_opener : base.greeting_opener,
    greeting_line_name: typeof o.greeting_line_name === "string" ? o.greeting_line_name : base.greeting_line_name,
    greeting_line_tagline:
      typeof o.greeting_line_tagline === "string" ? o.greeting_line_tagline : base.greeting_line_tagline,
    greeting_closer: typeof o.greeting_closer === "string" ? o.greeting_closer : base.greeting_closer,
    multi_service_question: (() => {
      const raw =
        typeof o.multi_service_question === "string" ? o.multi_service_question : base.multi_service_question;
      if (raw.includes("כדי שאוכל לך בול מה שמעניין אותך")) {
        return raw.replace(
          "כדי שאוכל לך בול מה שמעניין אותך",
          "כדי שאוכל להתאים עבורך בול את מה שמעניין אותך"
        );
      }
      return raw;
    })(),
    after_service_pick: (() => {
      const raw =
        typeof o.after_service_pick === "string" ? o.after_service_pick : base.after_service_pick;
      const legacy =
        "אוקיי מדהים! {serviceName}. {benefitLine} — דרך נעימה להתקדם, להרגיש את הגוף ולהיות חלק מקהילה תומכת.";
      const legacy2 =
        "אוקיי מדהים! שיעורי {serviceName} אצלנו הם דרך סופר נעימה לקחת את מה שחשוב לך מהאימון — במיוחד {benefitLine} — ולהמשיך באווירה חמה ומקצועית, חלק מקהילה שאוהבת את מה שעושים.";
      const legacyLongBenefitDump =
        "אוקיי מדהים! {serviceName} אצלנו זה בדיוק המקום לקחת את מה שמעניין אותך מהאימון — במיוחד {benefitLine} — ולהתקדם בצורה נעימה, ברורה ומקצועית.";
      if (raw.trim() === legacy) return base.after_service_pick;
      if (raw.trim() === legacy2) return base.after_service_pick;
      if (raw.trim() === legacyLongBenefitDump) return base.after_service_pick;
      return raw;
    })(),
    experience_question:
      typeof o.experience_question === "string" ? o.experience_question : base.experience_question,
    experience_options: ex(o.experience_options),
    after_experience: typeof o.after_experience === "string" ? o.after_experience : base.after_experience,
    greeting_extra_steps: parseExtraSteps(o.greeting_extra_steps),
    opening_extra_steps: parseExtraSteps(o.opening_extra_steps),
    cta_body: typeof o.cta_body === "string" ? o.cta_body : base.cta_body,
    cta_buttons: parseCtaButtons(o.cta_buttons),
    cta_extra_steps: parseExtraSteps(o.cta_extra_steps),
    followup_after_next_class_body:
      typeof o.followup_after_next_class_body === "string"
        ? o.followup_after_next_class_body
        : base.followup_after_next_class_body,
    followup_after_next_class_options: exFollow(o.followup_after_next_class_options),
    free_chat_invite_reply:
      typeof o.free_chat_invite_reply === "string" ? o.free_chat_invite_reply : base.free_chat_invite_reply,
    after_trial_registration_body:
      typeof o.after_trial_registration_body === "string"
        ? o.after_trial_registration_body
        : base.after_trial_registration_body,
    greeting_body_override:
      typeof o.greeting_body_override === "string" ? o.greeting_body_override : undefined,
  };
}

export function serializeSalesFlowConfig(c: SalesFlowConfig): Record<string, unknown> {
  return {
    opening_note: c.opening_note,
    greeting_opener: c.greeting_opener,
    greeting_line_name: c.greeting_line_name,
    greeting_line_tagline: c.greeting_line_tagline,
    greeting_closer: c.greeting_closer,
    multi_service_question: c.multi_service_question,
    after_service_pick: c.after_service_pick,
    experience_question: c.experience_question,
    experience_options: [...c.experience_options],
    after_experience: c.after_experience,
    greeting_extra_steps: c.greeting_extra_steps.map((s) => ({
      id: s.id,
      question: s.question,
      options: s.options,
    })),
    opening_extra_steps: c.opening_extra_steps.map((s) => ({
      id: s.id,
      question: s.question,
      options: s.options,
    })),
    cta_body: c.cta_body,
    cta_buttons: c.cta_buttons.map((b) => ({ id: b.id, label: b.label, kind: b.kind })),
    cta_extra_steps: [],
    followup_after_next_class_body: c.followup_after_next_class_body,
    followup_after_next_class_options: [...c.followup_after_next_class_options],
    free_chat_invite_reply: c.free_chat_invite_reply,
    after_trial_registration_body: c.after_trial_registration_body,
    greeting_body_override: c.greeting_body_override?.trim() || undefined,
  };
}

export function composeGreeting(
  c: SalesFlowConfig,
  botName: string,
  businessName: string,
  taglineText: string
): string {
  if (c.greeting_body_override?.trim()) return c.greeting_body_override.trim();
  const bot = botName.trim() || "זואי";
  const biz = businessName.trim() || "העסק";
  const tag = taglineText.trim() || "…";
  const lineName = c.greeting_line_name.replace(/\{botName\}/g, bot).replace(/\{businessName\}/g, biz);
  const lineTag = c.greeting_line_tagline.replace(/\{tagline\}/g, tag);
  return [c.greeting_opener, lineName, lineTag, c.greeting_closer].filter(Boolean).join("\n");
}

export type ServiceLike = { name: string; benefit_line?: string; service_slug?: string };

export function syncWelcomeFromSalesFlow(
  c: SalesFlowConfig,
  services: ServiceLike[],
  botName: string,
  businessName: string,
  taglineText: string
): { intro: string; question: string; options: string[] } {
  const named = services.map((s) => s.name.trim()).filter(Boolean);
  const intro = composeGreeting(c, botName, businessName, taglineText);
  if (named.length > 1) {
    return {
      intro,
      question: c.multi_service_question,
      options: named.slice(0, 12),
    };
  }
  if (named.length === 1) {
    const sn = named[0];
    return {
      intro,
      question: c.experience_question.replace(/\{serviceName\}/g, sn),
      options: [...c.experience_options],
    };
  }
  return { intro, question: "", options: [] };
}

/** הודעת פתיחה ראשונה לווטסאפ (אחרי מדיה) */
export function buildWhatsAppOpeningBody(
  c: SalesFlowConfig,
  services: ServiceLike[],
  botName: string,
  businessName: string,
  taglineText: string
): string {
  const named = services.map((s) => s.name.trim()).filter(Boolean);
  const lines: string[] = [];
  lines.push(composeGreeting(c, botName, businessName, taglineText));
  for (const st of c.greeting_extra_steps) {
    if (!st.question.trim()) continue;
    lines.push("", st.question);
    for (const o of st.options) {
      if (o.trim()) lines.push(o);
    }
  }
  if (named.length > 1) {
    lines.push("", c.multi_service_question);
    if (named.length <= 3) {
      named.forEach((n) => lines.push(n));
    } else {
      named.forEach((n, i) => lines.push(`${i + 1}. ${n}`));
      lines.push("", "כתבו את מספר האימון שמתאים לכם (ספרה אחת).");
    }
  } else if (named.length === 1) {
    lines.push("", c.experience_question.replace(/\{serviceName\}/g, named[0]));
    c.experience_options.forEach((o) => lines.push(o));
  }
  return lines.join("\n");
}

export type WhatsAppOpeningPreviewSection =
  | { kind: "text"; text: string }
  | { kind: "buttons"; labels: string[] };

/** מקטעים לתצוגה מקדימה — טקסט ו״כפתורים״ בלי מספור (עד 3 אימונים) */
/**
 * ביטוי טבעי לשם אימון בתבנית «מענה אחרי בחירת אימון» — מונע «שיעורי שיעורי אקרו» כשהשם כבר מתחיל ב«שיעורי».
 */
export function trialServicePhraseForAfterPick(serviceName: string): string {
  const s = serviceName.trim();
  if (!s) return "השיעורים";
  if (s.startsWith("שיעורי ") || s.startsWith("שיעור ")) return s;
  return `שיעורי ${s}`;
}

/** מילוי תבנית מענה אחרי בחירת אימון (ווטסאפ / תצוגה מקדימה) */
export function fillAfterServicePickTemplate(
  template: string,
  serviceName: string,
  benefitLine: string
): string {
  const phrase = trialServicePhraseForAfterPick(serviceName);
  return template
    .replace(/\{serviceName\}/g, phrase)
    .replace(/\{benefitLine\}/g, benefitLine.trim() || "תיאור ממסלול המכירה");
}

export function getWhatsAppOpeningPreviewSections(
  c: SalesFlowConfig,
  services: ServiceLike[],
  botName: string,
  businessName: string,
  taglineText: string
): WhatsAppOpeningPreviewSection[] {
  const named = services.map((s) => s.name.trim()).filter(Boolean);
  const sections: WhatsAppOpeningPreviewSection[] = [];
  sections.push({
    kind: "text",
    text: composeGreeting(c, botName, businessName, taglineText),
  });
  for (const st of c.greeting_extra_steps) {
    const q = st.question.trim();
    const labels = st.options.map((o) => o.trim()).filter(Boolean);
    if (q) sections.push({ kind: "text", text: q });
    if (labels.length) sections.push({ kind: "buttons", labels });
  }
  if (named.length > 1) {
    sections.push({ kind: "text", text: c.multi_service_question });
    sections.push({ kind: "buttons", labels: [...named].slice(0, 12) });
    if (named.length > 3) {
      sections.push({
        kind: "text",
        text: "כתבו את מספר האימון שמתאים לכם (ספרה אחת).",
      });
    }
  } else if (named.length === 1) {
    sections.push({
      kind: "text",
      text: c.experience_question.replace(/\{serviceName\}/g, named[0]),
    });
    sections.push({ kind: "buttons", labels: [...c.experience_options] });
  }
  return sections;
}

const INSTAGRAM_CTA_PLACEHOLDER = "{instagram_cta}";
const ADDRESS_PLACEHOLDER = "{business_address}";
const DIRECTIONS_PLACEHOLDER = "{business_directions}";

/**
 * מרחיב תבנית «אחרי הרשמה לאימון ניסיון» לפרומפט: ממלא את {instagram_cta}
 * במשפט + URL כשיש לינק אינסטגרם; אחרת מסיר את המציין בלי להשאיר שורות ריקות.
 */
export function expandAfterTrialRegistrationForPrompt(
  body: string,
  instagramUrl: string,
  address: string,
  directions: string
): string {
  const u = instagramUrl.trim();
  const a = address.trim();
  const d = directions.trim();
  let t = body.trim();
  if (!t) return t;

  // Address + directions: insert actual knowledge (no ____ / no "(מלאי...)")
  if (t.includes(ADDRESS_PLACEHOLDER)) {
    t = a ? t.replaceAll(ADDRESS_PLACEHOLDER, a) : t.replaceAll(ADDRESS_PLACEHOLDER, "");
  }
  if (t.includes(DIRECTIONS_PLACEHOLDER)) {
    t = d ? t.replaceAll(DIRECTIONS_PLACEHOLDER, d) : t.replaceAll(DIRECTIONS_PLACEHOLDER, "");
  }

  if (t.includes(INSTAGRAM_CTA_PLACEHOLDER)) {
    if (u) {
      t = t.replace(
        INSTAGRAM_CTA_PLACEHOLDER,
        `מוזמנים לבקר באינסטגרם שלנו בינתיים:\n${u}`
      );
    } else {
      t = t
        .replace(/\n*\{instagram_cta\}\n*/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    return t;
  }

  if (u) {
    return `${t}\n\nמוזמנים לבקר באינסטגרם שלנו בינתיים:\n${u}`;
  }
  return t;
}

const TRIAL_REGISTERED_PHRASES = ["נרשמתי", "נרשמת", "נרשמנו", "registered", "signed up"] as const;

/** זיהוי הודעת «סיימתי להירשם» לווטסאפ (התאמה מלאה אחרי trim, case-insensitive לאנגלית). */
export function matchesTrialRegisteredMessage(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  for (const p of TRIAL_REGISTERED_PHRASES) {
    if (t === p.toLowerCase()) return true;
  }
  return false;
}

/**
 * מכין את תבנית «אחרי הרשמה» לשליחה ללקוח בווטסאפ: אינסטגרם, הסרת הערות «מלאי», מילוי ____ בכתובת והגעה, השמטת שורות ריקות אחרי נקודתיים.
 */
export function formatAfterTrialRegistrationForWhatsAppDelivery(
  body: string,
  instagramUrl: string,
  address: string,
  directions: string
): string {
  let s = expandAfterTrialRegistrationForPrompt(body.trim(), instagramUrl, address, directions);
  s = s
    .split("\n")
    .map((x) => x.trim())
    .filter((line) => {
      if (!line) return true;
      const ci = line.lastIndexOf(":");
      if (ci >= 0 && !line.slice(ci + 1).trim()) return false; // drop "label:" with nothing
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s;
}

function formatExtraSteps(title: string, steps: SalesFlowExtraStep[]): string {
  if (!steps.length) return "";
  return (
    `${title}:\n` +
    steps
      .map((s, i) => {
        const opts = s.options.map((o, j) => `    ${j + 1}. ${o}`).join("\n");
        return `  ${i + 1}. שאלה: ${s.question || "(ריק)"}\n${opts || "    (אין כפתורים)"}`;
      })
      .join("\n")
  );
}

export function formatSalesFlowForPrompt(
  c: SalesFlowConfig,
  serviceNames: string[],
  benefitByName: Map<string, string>,
  instagramUrl = "",
  address = "",
  directions = ""
): string {
  const named = serviceNames.map((n) => n.trim()).filter(Boolean);
  const benefitLines = named
    .map((n) => {
      const b = benefitByName.get(n)?.trim() || "(השלימי מהידע או מתיאור האימון)";
      return `  - ${n}: תיאור קצר ממסלול המכירה (משפט אחד חי וברור — לא רשימה): ${b}`;
    })
    .join("\n");

  const ctaDesc = c.cta_buttons
    .map((b) => {
      const hint =
        b.kind === "schedule"
          ? "לינק מערכת שעות / Arbox ממסלול המכירה"
          : b.kind === "trial"
            ? "לינק סליקה לאימון שנבחר (משירותי הניסיון)"
            : b.kind === "next_class"
              ? "במערכת: מושך שיעור ניסיון קרוב מ-Arbox לפי האימון שנבחר — בלי קישור בהודעה"
              : b.kind === "memberships"
                ? "בווטסאפ: נשלח קישור מ«קישור לדף מנויים וכרטיסיות» בדשבורד; אם אין קישור — תשובה קבועה מהמערכת"
                : "עקבי אחרי סוג הכפתור במסלול המכירה";
      return `  - "${b.label}" (${b.kind}): ${hint}`;
    })
    .join("\n");

  const afterTrialRegistrationExpanded = expandAfterTrialRegistrationForPrompt(
    c.after_trial_registration_body.trim(),
    instagramUrl,
    address,
    directions
  );

  return `
מסלול מכירה מובנה (חובה לעקוב אחרי הסדר הלוגי; התאימי ניסוח לסגנון הדיבור):

כללים כלליים:
- שמות אימוני הניסיון ממסלול המכירה חייבים להישאר קצרים (עד ~15 תווים, 2–3 מילים) — מתאים לכפתורי WhatsApp. רע: "שיעורי אקרו יוגה שבועיים". טוב: "אקרו יוגה" או "שיעורי אקרו".
- בכל הודעה: מענה קצר לשלב הנוכחי + השאלה הבאה בפלואו + אפשרויות בחירה.
- אם יש עד 3 אימוני ניסיון — הציגי כל אימון בשורה נפרדת בלי מספרים, בנוסח כפתורי תשובה מהירה (רק הטקסט, בלי "1.").
- אם יש יותר מ־3 אימוני ניסיון — בשלב בחירת האימון השתמשי ברשימה ממוספרת ובקשי מהלקוח לכתוב מספר (ספרה) בלבד.
- שלוש אפשרויות שאלת הניסיון הקודם: תמיד שורה לכל אפשרות בלי מספור, כמו כפתורים.
- אם יש רק אימון ניסיון אחד — דלגי על שאלת "איזה אימון מעניין" ועברי ישר לשאלת הניסיון עם שלוש האפשרויות ממסלול המכירה.
- אם הלקוח כותב בצ׳אט חופשי באמצע הפלואו: עני בקצרה מהידע (Claude), ואז חזרי מיד לשאלה הבאה בפלואו עם אותן אפשרויות בחירה.
- משלב "הנעה לפעולה" ואילך: בכל תשובה הוסיפי את כפתורי ההנעה (כשורות ממוספרות) — לפי התוויות והלינקים/ידע למטה.

סשן פתיחה (אחרי הודעת המערכת הראשונה):
- טקסט הפתיחה כפי שהוגדר. אחריו — אם מופיעות שאלות נוספות מיד אחרי הפתיחה, שלבי אותן לפי הסדר עם כפתורי בחירה.
${formatExtraSteps("שאלות נוספות מיד אחרי טקסט הפתיחה (לפני בחירת אימון)", c.greeting_extra_steps)}
- אם יש יותר מאימון אחד: קודם שאלת בחירת האימון ממסלול המכירה, ואז אחרי שבחרו אימון — מענה קצר וחי כמו בשיח אמיתי (משפט עד שניים). לא להעתיק את תיאור האימון ממסלול המכירה במלואו ולא לנסח כמו "לקחת את מה שמעניין אותך מהאימון — במיוחד [פסקה ארוכה]".
- התאימי את הרוח לסוג האימון שנבחר: אקרו/דינמי — אנרגיה, קהילה, אתגר חיובי; פילאטיס/מכשירים — חיטוב, התחזקות, השקעה בעצמך; יוגה/מיינדפולנס — חיבור פנימי, איזון, גוף־נפש. אפשר לפתוח ב"אוקיי מדהים!" או "איזה כיף :)" לפי הטון.
- אם בתבנית יש {benefitLine}: השתמשי בו רק כרמז קצר (מילה עד חצי משפט), לא כהדבקה של כל שדה התיאור.
  תבנית מענה אחרי בחירת אימון (שמרי על אותה רוח — קצר, ספונטני, בלי ערימת פרטים): ${c.after_service_pick}

סשן חימום (מומלץ לא יותר מ־1–3 שאלות בסך הכול כולל שאלת הניסיון; בסיום סשן החימום עברי אוטומטית לשלב ההנעה לפעולה):
- שאלת ניסיון קודם + שלוש האפשרויות ממסלול המכירה (בלי מספור, כמו כפתורים).
  שאלה: ${c.experience_question}
  אפשרויות: ${c.experience_options.join(" | ")}
- מענה אחרי בחירה בשאלת הניסיון: ${c.after_experience}
${formatExtraSteps("שאלות נוספות בסשן חימום (אחרי שאלת הניסיון, לפני ההנעה לפעולה)", c.opening_extra_steps)}

שלב הנעה לפעולה:
גוף הודעה מוצע (אחרי שאלת ניסיון קודם): ${c.cta_body}
כפתורי פעולה (הציגי כשורות ממוספרות; קישורים אמיתיים רק אם מופיעים בידע):
${ctaDesc}
אחרי שהלקוח ביקש «מתי השיעור קרוב?» — המערכת שולחת הודעה שנייה אוטומטית:
${c.followup_after_next_class_body}
עם שלוש אפשרויות: ${c.followup_after_next_class_options.join(" | ")}
אם בחר «${c.followup_after_next_class_options[2]}» — עני בדיוק: ${c.free_chat_invite_reply}

אחרי הרשמה לשיעור ניסיון (כשהלקוח השלים תשלום/הרשמה לאימון ניסיון):
- שלחי הודעה לפי התבנית והרוח למטה. התאימי ניסוח לסגנון הדיבור; אל תשאירי סוגריים או הערות טכניות בטקסט ללקוח.
- יום ושעה: אם ידועים מהשיחה או מארבוקס — אפשר לציין בקצרה; אם אין — בלי להמציא.
- כתובת: מלאי משדה הכתובת בבלוק «ידע עסקי» (כפי בתבנית «זה קורה בכתובת» / ניסוח דומה).
- הגעה: מלאי מ«הנחיות הגעה» בבלוק «ידע עסקי»; אם ריק — השמיטי את בלוק ההגעה או צייני בקצרה שאין הנחיות.
- אם בתבנית מופיע שורה על אינסטגרם «בינתיים» וכתובת URL בשורה נפרדת — שלחי את המשפט ואז בשורה הבאה בדיוק את ה־URL (קישור לחיץ בווטסאפ). אם אין בתבנית בלוק כזה — אל תוסיפי.
תבנית והנחיות ממסלול המכירה:
${afterTrialRegistrationExpanded || "(אין תבנית — שלחי הודעת חיזוק קצרה והמשיכי בפלואו)"}

אימוני ניסיון ותיאור קצר אחרי בחירה (ממסלול המכירה):
${benefitLines || "  (אין אימונים מוגדרים)"}
`.trim();
}
