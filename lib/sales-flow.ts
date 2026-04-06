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
  kind: "schedule" | "trial" | "memberships";
};

export type SalesFlowConfig = {
  opening_note: string;
  greeting_opener: string;
  greeting_line_name: string;
  greeting_line_tagline: string;
  greeting_closer: string;
  multi_service_question: string;
  after_service_pick: string;
  experience_question: string;
  experience_options: [string, string, string];
  after_experience: string;
  opening_extra_steps: SalesFlowExtraStep[];
  cta_body: string;
  cta_buttons: SalesFlowCtaButton[];
  cta_extra_steps: SalesFlowExtraStep[];
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
  multi_service_question:
    "כדי שאוכל להתאים עבורך בול את מה שמעניין אותך,\nאיזה אימון הכי קורץ לך?",
  after_service_pick:
    "אוקיי מדהים! {serviceName}. {benefitLine} — דרך נעימה להתקדם, להרגיש את הגוף ולהיות חלק מקהילה תומכת.",
  experience_question: "האם יצא לך לנסות {serviceName} בעבר?",
  experience_options: [
    "כן, לא מעט פעמים!",
    "יצא לי פעם פעמיים…",
    "עדיין לא :)",
  ],
  after_experience:
    "מגניב לגמרי, יש לנו אימונים לכל הרמות, כך שכל אחד ואחת יכולים למצוא את עצמם.",
  opening_extra_steps: [],
  cta_body:
    "אז מה דעתך שנשריין עבורך אימון ניסיון ראשון? במידה ויש לך שאלות נוספות ביכולתך לכתוב בצ׳אט חופשי ואענה כאן :)",
  cta_buttons: [
    { id: "cta-schedule", label: "צפייה במערכת השעות", kind: "schedule" },
    { id: "cta-trial", label: "הרשמה לשיעור ניסיון", kind: "trial" },
    { id: "cta-memberships", label: "מה מחירי המנויים?", kind: "memberships" },
  ],
  cta_extra_steps: [],
};

const FORMAL: SalesFlowConfig = {
  ...FRIENDLY,
  greeting_opener: "שלום וברוכים הבאים.",
  greeting_closer: "נשמח לארח אתכם אצלנו.",
  after_experience:
    "מצוין. יש לנו אימונים לכל הרמות, ונשמח למצוא עבורכם את ההתאמה הנכונה.",
  cta_body:
    "נשמח לשריין עבורכם אימון ניסיון ראשון. לשאלות נוספות ניתן לכתוב כאן בקצרה.",
};

const DIRECT: SalesFlowConfig = {
  ...FRIENDLY,
  greeting_opener: "היי,",
  multi_service_question: "איזה אימון מעניין אותך?",
  cta_body:
    "רוצים לשריין אימון ניסיון? יש שאלות — כתבו בצ׳אט.",
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
    const kind = o.kind === "schedule" || o.kind === "trial" || o.kind === "memberships" ? o.kind : "trial";
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
    after_service_pick:
      typeof o.after_service_pick === "string" ? o.after_service_pick : base.after_service_pick,
    experience_question:
      typeof o.experience_question === "string" ? o.experience_question : base.experience_question,
    experience_options: ex(o.experience_options),
    after_experience: typeof o.after_experience === "string" ? o.after_experience : base.after_experience,
    opening_extra_steps: parseExtraSteps(o.opening_extra_steps),
    cta_body: typeof o.cta_body === "string" ? o.cta_body : base.cta_body,
    cta_buttons: parseCtaButtons(o.cta_buttons),
    cta_extra_steps: parseExtraSteps(o.cta_extra_steps),
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
    opening_extra_steps: c.opening_extra_steps.map((s) => ({
      id: s.id,
      question: s.question,
      options: s.options,
    })),
    cta_body: c.cta_body,
    cta_buttons: c.cta_buttons.map((b) => ({ id: b.id, label: b.label, kind: b.kind })),
    cta_extra_steps: c.cta_extra_steps.map((s) => ({
      id: s.id,
      question: s.question,
      options: s.options,
    })),
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
  if (named.length > 1) {
    lines.push("", c.multi_service_question);
    if (named.length <= 3) {
      named.forEach((n) => lines.push(n));
      lines.push("", "בחרו את סוג האימון המתאים או כתבו את שמו בקצרה.");
    } else {
      named.forEach((n, i) => lines.push(`${i + 1}. ${n}`));
      lines.push("", "כתבו את מספר האימון שמתאים לכם (ספרה אחת).");
    }
  } else if (named.length === 1) {
    lines.push("", c.experience_question.replace(/\{serviceName\}/g, named[0]));
    c.experience_options.forEach((o) => lines.push(o));
    lines.push("", "ניתן לבחור לפי אחת מהאפשרויות למעלה או לכתוב בקצרה.");
  }
  return lines.join("\n");
}

export type WhatsAppOpeningPreviewSection =
  | { kind: "text"; text: string }
  | { kind: "buttons"; labels: string[] };

/** מקטעים לתצוגה מקדימה — טקסט ו״כפתורים״ בלי מספור (עד 3 אימונים) */
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
  if (named.length > 1) {
    sections.push({ kind: "text", text: c.multi_service_question });
    sections.push({ kind: "buttons", labels: [...named].slice(0, 12) });
    if (named.length > 3) {
      sections.push({
        kind: "text",
        text: "כתבו את מספר האימון שמתאים לכם (ספרה אחת).",
      });
    } else {
      sections.push({
        kind: "text",
        text: "בחרו את סוג האימון המתאים או כתבו את שמו בקצרה.",
      });
    }
  } else if (named.length === 1) {
    sections.push({
      kind: "text",
      text: c.experience_question.replace(/\{serviceName\}/g, named[0]),
    });
    sections.push({ kind: "buttons", labels: [...c.experience_options] });
    sections.push({
      kind: "text",
      text: "ניתן לבחור לפי אחת מהאפשרויות למעלה או לכתוב בקצרה.",
    });
  }
  return sections;
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
  benefitByName: Map<string, string>
): string {
  const named = serviceNames.map((n) => n.trim()).filter(Boolean);
  const benefitLines = named
    .map((n) => `  - ${n}: יתרון אחרי בחירה (למענה "אחרי בחירת אימון"): ${benefitByName.get(n)?.trim() || "(השלימי מהידע או מתיאור האימון)"}`)
    .join("\n");

  const ctaDesc = c.cta_buttons
    .map((b) => {
      const hint =
        b.kind === "schedule"
          ? "לינק מערכת שעות / Arbox מההגדרות"
          : b.kind === "trial"
            ? "לינק סליקה לאימון שנבחר (משירותי הניסיון)"
            : "סיכום מחירי מנויים וכרטיסיות מההגדרות — בלי להמציא";
      return `  - "${b.label}" (${b.kind}): ${hint}`;
    })
    .join("\n");

  return `
מסלול מכירה מובנה (חובה לעקוב אחרי הסדר הלוגי; התאימי ניסוח לסגנון הדיבור):

כללים כלליים:
- בכל הודעה: מענה קצר לשלב הנוכחי + השאלה הבאה בפלואו + אפשרויות בחירה.
- אם יש עד 3 אימוני ניסיון — הציגי כל אימון בשורה נפרדת בלי מספרים, בנוסח כפתורי תשובה מהירה (רק הטקסט, בלי "1.").
- אם יש יותר מ־3 אימוני ניסיון — בשלב בחירת האימון השתמשי ברשימה ממוספרת ובקשי מהלקוח לכתוב מספר (ספרה) בלבד.
- שלוש אפשרויות שאלת הניסיון הקודם: תמיד שורה לכל אפשרות בלי מספור, כמו כפתורים.
- אם יש רק אימון ניסיון אחד — דלגי על שאלת "איזה אימון מעניין" ועברי ישר לשאלת הניסיון עם שלוש האפשרויות מהגדרות.
- אם הלקוח כותב בצ׳אט חופשי באמצע הפלואו: עני בקצרה מהידע (Claude), ואז חזרי מיד לשאלה הבאה בפלואו עם אותן אפשרויות בחירה.
- משלב "הנעה לפעולה" ואילך: בכל תשובה הוסיפי את כפתורי ההנעה (כשורות ממוספרות) — לפחות צפייה במערכת שעות, הרשמה לניסיון, מחירי מנויים — לפי התוויות והלינקים/ידע למטה.

סשן פתיחה (אחרי הודעת המערכת הראשונה):
- אם יש יותר מאימון אחד: קודם שאלת בחירת האימון מההגדרות, ואז אחרי שבחרו אימון — מענה לפי התבנית. חובה להשתמש בשם האימון שנבחר ובשורת היתרון המדויקת מהטבלה למטה; אל תחליפי בניסוח גנרי כמו "חוזק, גמישות, קהילה" במקום התוכן מההגדרות.
  תבנית מענה אחרי בחירת אימון: ${c.after_service_pick}

סשן חימום (מומלץ לא יותר מ־2–3 שאלות בסך הכול):
- שאלת ניסיון קודם + שלוש האפשרויות מהגדרות (בלי מספור, כמו כפתורים).
  שאלה: ${c.experience_question}
  אפשרויות: ${c.experience_options.join(" | ")}
- מענה אחרי בחירה בשאלת הניסיון: ${c.after_experience}
${formatExtraSteps("שאלות נוספות לסשן חימום (לפי הסדר אחרי השלבים למעלה)", c.opening_extra_steps)}

שלב הנעה לפעולה:
גוף הודעה מוצע: ${c.cta_body}
כפתורי פעולה (הציגי כשורות ממוספרות; קישורים אמיתיים רק אם מופיעים בידע):
${ctaDesc}
${formatExtraSteps("שאלות נוספות לסשן הנעה לפעולה", c.cta_extra_steps)}

אימוני ניסיון ויתרונות אחרי בחירה (מההגדרות):
${benefitLines || "  (אין אימונים מוגדרים)"}
`.trim();
}
