/**
 * מסלול מכירה מובנה - פתיחה + הנעה לפעולה, סנכרון ל-welcome_message ולפרומפט זואי.
 */

export type SalesFlowExtraStep = {
  id: string;
  question: string;
  options: string[];
};

/** סוג הצעה בטאב «אימון ניסיון» — קובע איזה סשן CTA בטאב מכירה ישלח בווטסאפ */
export type OfferKind = "trial" | "workshop" | "course";

export type ScheduleCtaDelivery = "link" | "image" | "none";
/** בפועל אין «ללא» בדשבורד — לאימון ניסיון תמיד לינק; הערך none נותר למיגרציה מה־JSON */
export type TrialCtaDelivery = "link" | "none";
export type MembershipsCtaDelivery = "link" | "range" | "none";
/** לינק סליקה משדה השירות | מספר שירות לקוחות מהדשבורד */
export type SecondaryPurchaseCtaDelivery = "link" | "phone";

export type SalesFlowCtaKind =
  | "schedule"
  | "trial"
  | "memberships"
  | "address"
  | "workshop_purchase"
  | "workshop_contact"
  | "course_enroll"
  | "course_contact";

export type SalesFlowCtaButton = {
  id: string;
  label: string;
  kind: SalesFlowCtaKind;
  /** רק trial — לינק נשלף משדה קישור ההרשמה באימוני הניסיון */
  trial_cta_delivery?: TrialCtaDelivery;
  /** רק schedule — לינק מטאב לינקים; תמונה = אינסרט; «ללא» מסתיר */
  schedule_cta_delivery?: ScheduleCtaDelivery;
  schedule_cta_image_url?: string;
  schedule_cta_image_type?: "image" | "";
  /** רק memberships — לינק מטאב לינקים | טווח מחירים ידני | «ללא» מסתיר */
  memberships_cta_delivery?: MembershipsCtaDelivery;
  memberships_price_range_min?: string;
  memberships_price_range_max?: string;
  /** workshop_purchase | course_enroll — לינק מתוך השירות או טל׳ שירות לקוחות */
  secondary_purchase_delivery?: SecondaryPurchaseCtaDelivery;
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
  /** סשן חימום — סדנה (כשיש שירותי סדנה) */
  experience_question_workshop: string;
  experience_options_workshop: [string, string, string];
  after_experience_workshop: string;
  opening_extra_steps_workshop: SalesFlowExtraStep[];
  /** סשן חימום — קורס */
  experience_question_course: string;
  experience_options_course: [string, string, string];
  after_experience_course: string;
  opening_extra_steps_course: SalesFlowExtraStep[];
  cta_body: string;
  cta_buttons: SalesFlowCtaButton[];
  /** סשן הנעה — סדנה (רק כשיש שירותי סדנה) */
  cta_workshop_body: string;
  cta_workshop_buttons: SalesFlowCtaButton[];
  /** סשן הנעה — קורס */
  cta_course_body: string;
  cta_course_buttons: SalesFlowCtaButton[];
  cta_extra_steps: SalesFlowExtraStep[];
  /** הודעת המשך קצרה עם תפריט קבוע אחרי שליחת לינק (הרשמה / מערכת שעות / מנויים) */
  followup_after_next_class_body: string;
  followup_after_next_class_options: [string, string, string];
  /** שמור לתאימות היסטורית */
  free_chat_invite_reply: string;
  /** הודעה/הנחיה לזואי אחרי שהלקוח השלים הרשמה לאימון ניסיון */
  after_trial_registration_body: string;
  /** מיגרציה ממסלול ישן — דורס את הברכה המורכבת */
  greeting_body_override?: string;
  /** @deprecated נגזר מ־memberships_cta_delivery בכפתור המנויים; נשמר לתאימות לקוחות ישנים */
  show_memberships_button?: boolean;
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
  /** נשמר לתאימות; בפועל המשפט אחרי בחירת אימון נובע מהכלל ב־composeAfterServicePickReplyFromTrialDescription ותאימות למילוי composeAfterServicePickReply. */
  after_service_pick:
    "כלל מערכת: [מילת פתיחה]! [קידומת/שם] [הם/היא] + תיאור מטאב אימון ניסיון (טקסט כפי שנשמר ללא עריכה).",
  experience_question: "האם יצא לך לנסות {serviceName} בעבר?",
  experience_options: [
    "כן, לא מעט פעמים!",
    "יצא לי פעם פעמיים…",
    "עדיין לא :)",
  ],
  after_experience:
    "מגניב לגמרי, {levelsText} כך שכל אחד ואחת יכולים למצוא את עצמם.",
  opening_extra_steps: [],
  experience_question_workshop: "איזו ציפייה יש לך מהסדנה?",
  experience_options_workshop: [
    "להעשיר את הידע שלי",
    "לחוות חוויה מעוררת",
    "להכיר קהילה חדשה",
  ],
  after_experience_workshop:
    "מגניב לגמרי, {levelsText} כך שכל אחד ואחת יכולים למצוא את עצמם.",
  opening_extra_steps_workshop: [],
  experience_question_course: "יש לך ניסיון קודם בתחום?",
  experience_options_course: ["כן, יש לי בסיס", "קצת", "בכלל לא"],
  after_experience_course:
    "מגניב לגמרי, {levelsText} כך שכל אחד ואחת יכולים למצוא את עצמם.",
  opening_extra_steps_course: [],
  cta_body:
    "מה דעתך להגיע לאימון ניסיון בקרוב? האימון עולה {priceText} שקלים, הוא נמשך {durationText} דקות ובאמת שהולך להיות כיף.",
  show_memberships_button: true,
  cta_buttons: [
    { id: "cta-trial", label: "הרשמה לשיעור ניסיון", kind: "trial", trial_cta_delivery: "link" },
    {
      id: "cta-schedule",
      label: "צפייה במערכת השעות",
      kind: "schedule",
      schedule_cta_delivery: "link",
      schedule_cta_image_url: "",
      schedule_cta_image_type: "",
    },
    { id: "cta-memberships", label: "מחירי מנויים", kind: "memberships", memberships_cta_delivery: "link" },
  ],
  cta_workshop_body:
    "מה דעתך על הסדנה שלנו? המחיר הוא {price} שקלים, היא נמשכת {duration} דקות, ובאמת שהולך להיות כיף!",
  cta_workshop_buttons: [
    {
      id: "cta-workshop-buy",
      label: "רכישת סדנה",
      kind: "workshop_purchase",
      secondary_purchase_delivery: "link",
    },
    { id: "cta-workshop-contact", label: "יצירת קשר", kind: "workshop_contact" },
  ],
  cta_course_body:
    "מה דעתך להצטרף לקורס שלנו? המחיר הוא {price} שקלים, הוא נמשך כ-{sessions} מפגשים, ובאמת שהולך להיות כיף! התאריכים: {start_date} עד {end_date}",
  cta_course_buttons: [
    {
      id: "cta-course-enroll",
      label: "הצטרפות לקורס",
      kind: "course_enroll",
      secondary_purchase_delivery: "link",
    },
    { id: "cta-course-contact", label: "יצירת קשר", kind: "course_contact" },
  ],
  cta_extra_steps: [],
  followup_after_next_class_body: "שנשריין לך את האימון? 🙂",
  followup_after_next_class_options: [
    "הרשמה לשיעור ניסיון",
    "צפייה במערכת השעות",
    "מחירי מנויים",
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
    "כלל מערכת: [מילת פתיחה]! [קידומת/שם] [הם/היא] + תיאור מטאב אימון ניסיון (טקסט כפי שנשמר ללא עריכה).",
  after_experience:
    "מצוין. {levelsText} ונשמח למצוא עבורכם את ההתאמה הנכונה.",
  after_experience_workshop:
    "מצוין. {levelsText} ונשמח למצוא עבורכם את ההתאמה הנכונה.",
  after_experience_course:
    "מצוין. {levelsText} ונשמח למצוא עבורכם את ההתאמה הנכונה.",
  cta_body:
    "מה דעתכם להגיע לאימון ניסיון בקרוב? האימון עולה {priceText} שקלים, הוא נמשך {durationText} דקות ובאמת שהולך להיות כיף.",
  show_memberships_button: true,
  cta_buttons: [
    { id: "cta-trial", label: "הרשמה לשיעור ניסיון", kind: "trial", trial_cta_delivery: "link" },
    {
      id: "cta-schedule",
      label: "צפייה במערכת השעות",
      kind: "schedule",
      schedule_cta_delivery: "link",
      schedule_cta_image_url: "",
      schedule_cta_image_type: "",
    },
    { id: "cta-memberships", label: "מחירי מנויים", kind: "memberships", memberships_cta_delivery: "link" },
  ],
  followup_after_next_class_body: "שנשריין לכם את האימון? 🙂",
  followup_after_next_class_options: [
    "הרשמה לשיעור ניסיון",
    "צפייה במערכת השעות",
    "מחירי מנויים",
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
    "כלל מערכת: [מילת פתיחה]! [קידומת/שם] [הם/היא] + תיאור מטאב אימון ניסיון (טקסט כפי שנשמר ללא עריכה).",
  cta_body:
    "מה דעתך להגיע לאימון ניסיון בקרוב? האימון עולה {priceText} שקלים, הוא נמשך {durationText} דקות ובאמת שהולך להיות כיף.",
  show_memberships_button: true,
  cta_buttons: [
    { id: "cta-trial", label: "הרשמה לשיעור ניסיון", kind: "trial", trial_cta_delivery: "link" },
    {
      id: "cta-schedule",
      label: "צפייה במערכת השעות",
      kind: "schedule",
      schedule_cta_delivery: "link",
      schedule_cta_image_url: "",
      schedule_cta_image_type: "",
    },
    { id: "cta-memberships", label: "מחירי מנויים", kind: "memberships", memberships_cta_delivery: "link" },
  ],
  followup_after_next_class_body: "שנשריין לך את האימון? 🙂",
  followup_after_next_class_options: [
    "הרשמה לשיעור ניסיון",
    "צפייה במערכת השעות",
    "מחירי מנויים",
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

function parseOfferKindFlowButtons(raw: unknown, fallback: SalesFlowCtaButton[]): SalesFlowCtaButton[] {
  if (!Array.isArray(raw)) return structuredClone(fallback);
  const allowed = new Set<SalesFlowCtaKind>([
    "workshop_purchase",
    "workshop_contact",
    "course_enroll",
    "course_contact",
  ]);
  const out: SalesFlowCtaButton[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const kindRaw = String(o.kind ?? "").trim();
    if (!allowed.has(kindRaw as SalesFlowCtaKind)) continue;
    const kind = kindRaw as SalesFlowCtaKind;
    const delRaw = o.secondary_purchase_delivery;
    const secondaryDel: SecondaryPurchaseCtaDelivery | undefined =
      delRaw === "phone" || delRaw === "link" ? delRaw : "link";
    out.push({
      id: typeof o.id === "string" ? o.id : Math.random().toString(36).slice(2, 9),
      label: String(o.label ?? ""),
      kind,
      ...(kind === "workshop_purchase" || kind === "course_enroll"
        ? { secondary_purchase_delivery: secondaryDel }
        : {}),
    });
  }
  return out.length ? out : structuredClone(fallback);
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
      o.kind === "schedule" || o.kind === "trial" || o.kind === "memberships" || o.kind === "address"
        ? o.kind
        : o.kind === "next_class"
          ? "schedule"
          : "trial";
    const scheduleDelivery =
      o.schedule_cta_delivery === "image" || o.schedule_cta_delivery === "link" || o.schedule_cta_delivery === "none"
        ? o.schedule_cta_delivery
        : undefined;
    const trialDelivery =
      o.trial_cta_delivery === "none" || o.trial_cta_delivery === "link" ? o.trial_cta_delivery : undefined;
    const membershipsDelivery =
      o.memberships_cta_delivery === "none" ||
      o.memberships_cta_delivery === "link" ||
      o.memberships_cta_delivery === "range"
        ? o.memberships_cta_delivery
        : undefined;
    const membershipsMin =
      typeof o.memberships_price_range_min === "string" ? String(o.memberships_price_range_min).trim() : "";
    const membershipsMax =
      typeof o.memberships_price_range_max === "string" ? String(o.memberships_price_range_max).trim() : "";
    const scheduleImgUrl = typeof o.schedule_cta_image_url === "string" ? o.schedule_cta_image_url.trim() : "";
    const scheduleImgType =
      o.schedule_cta_image_type === "image" ? ("image" as const) : ("" as const);
    out.push({
      id: typeof o.id === "string" ? o.id : Math.random().toString(36).slice(2, 9),
      label: String(o.label ?? ""),
      kind,
      ...(kind === "trial"
        ? { trial_cta_delivery: trialDelivery ?? "link" }
        : kind === "memberships"
          ? {
              memberships_cta_delivery: membershipsDelivery ?? "link",
              ...(membershipsDelivery === "range"
                ? {
                    memberships_price_range_min: membershipsMin,
                    memberships_price_range_max: membershipsMax,
                  }
                : {}),
            }
          : {}),
      ...(kind === "schedule"
        ? {
            schedule_cta_delivery: scheduleDelivery ?? (scheduleImgUrl ? "image" : "link"),
            schedule_cta_image_url: scheduleImgUrl,
            schedule_cta_image_type: scheduleImgType,
          }
        : {}),
    });
  }
  const base = out.length ? out : structuredClone(FRIENDLY.cta_buttons);
  return base.map((btn, i) => normalizeCtaButtonForSlot(btn, i));
}

/** סוג כפתור קבוע לפי ה־id (טאב מסלול — שלושה כפתורים; בלי מעבר בין ניסיון/מערכת/מנויים) */
export function ctaLockedKindForSlot(
  buttonIndex: number,
  buttonId: string
): Exclude<SalesFlowCtaButton["kind"], "address"> {
  if (buttonId === "cta-trial") return "trial";
  if (buttonId === "cta-schedule") return "schedule";
  if (buttonId === "cta-memberships") return "memberships";
  const order: Exclude<SalesFlowCtaButton["kind"], "address">[] = ["trial", "schedule", "memberships"];
  return order[Math.min(Math.max(buttonIndex, 0), order.length - 1)]!;
}

/** כותרת משבצת בדשבורד */
export function ctaSlotRoleLabel(locked: Exclude<SalesFlowCtaButton["kind"], "address">): string {
  if (locked === "trial") return "שיעור ניסיון";
  if (locked === "schedule") return "מערכת שעות";
  return "מנויים / כרטיסיות";
}

/** תאימות JSON ישן: כל כפתור מקבל רק את המבנה של סוגו (לפי id / מיקום) */
export function normalizeCtaButtonForSlot(button: SalesFlowCtaButton, index: number): SalesFlowCtaButton {
  const locked = ctaLockedKindForSlot(index, button.id);
  const { id, label } = button;

  if (locked === "trial") {
    void button.trial_cta_delivery;
    return { id, label, kind: "trial", trial_cta_delivery: "link" };
  }

  if (locked === "memberships") {
    let del: MembershipsCtaDelivery = "link";
    if (button.kind === "memberships") {
      const raw = button.memberships_cta_delivery ?? "link";
      if (raw === "none") del = "none";
      else if (raw === "range") del = "range";
      else del = "link";
    }
    let min = String(button.memberships_price_range_min ?? "").trim();
    let max = String(button.memberships_price_range_max ?? "").trim();
    if (del !== "range") {
      min = "";
      max = "";
    }
    return del === "range"
      ? {
          id,
          label,
          kind: "memberships",
          memberships_cta_delivery: "range",
          memberships_price_range_min: min,
          memberships_price_range_max: max,
        }
      : { id, label, kind: "memberships", memberships_cta_delivery: del };
  }

  let sd: ScheduleCtaDelivery = "link";
  let url = "";
  let typ: "image" | "" = "";
  if (button.kind === "schedule") {
    const raw = button.schedule_cta_delivery ?? "link";
    sd = raw === "image" || raw === "none" || raw === "link" ? raw : "link";
    url = String(button.schedule_cta_image_url ?? "").trim();
    typ = button.schedule_cta_image_type === "image" ? "image" : "";
    if (sd === "image" && !url) sd = "link";
  }
  return {
    id,
    label,
    kind: "schedule",
    schedule_cta_delivery: sd,
    schedule_cta_image_url: sd === "image" ? url : "",
    schedule_cta_image_type: sd === "image" && url ? typ || "image" : "",
  };
}

/** ערך Select קצר («לינק» / «ללא» / «תמונה» / «טווח» למנויים) לפי סוג המשבצת הנעול */
export type CtaSlotSubChoice = "link" | "none" | "image" | "range";

export function salesFlowSubChoiceForSlot(
  b: SalesFlowCtaButton,
  locked: Exclude<SalesFlowCtaButton["kind"], "address">
): CtaSlotSubChoice {
  if (locked === "trial") return "link";
  if (locked === "memberships") {
    const m = b.memberships_cta_delivery ?? "link";
    if (m === "none") return "none";
    if (m === "range") return "range";
    return "link";
  }
  const d = b.schedule_cta_delivery ?? "link";
  if (d === "image") return "image";
  if (d === "none") return "none";
  return "link";
}

export function salesFlowApplyLockedSubChoice(
  base: Pick<SalesFlowCtaButton, "id" | "label">,
  previous: SalesFlowCtaButton,
  lockedKind: Exclude<SalesFlowCtaButton["kind"], "address">,
  sub: CtaSlotSubChoice
): SalesFlowCtaButton {
  if (lockedKind === "trial") {
    return { id: base.id, label: base.label, kind: "trial", trial_cta_delivery: "link" };
  }
  if (lockedKind === "memberships") {
    if (sub === "range") {
      const prev = previous.kind === "memberships" ? previous : undefined;
      return {
        id: base.id,
        label: base.label,
        kind: "memberships",
        memberships_cta_delivery: "range",
        memberships_price_range_min: prev?.memberships_price_range_min ?? "",
        memberships_price_range_max: prev?.memberships_price_range_max ?? "",
      };
    }
    if (sub === "none") {
      return salesFlowCtaButtonFromTypeUiChoice(base, previous, "memberships:none");
    }
    return salesFlowCtaButtonFromTypeUiChoice(base, previous, "memberships:link");
  }
  const ui: SalesFlowCtaTypeUiValue =
    sub === "image" ? "schedule:image" : sub === "none" ? "schedule:none" : "schedule:link";
  return salesFlowCtaButtonFromTypeUiChoice(base, previous, ui);
}

/** בחירה יחידה בדשבורד («סוג») — מתאמה לערכים האחסוניים trial_cta_delivery / schedule_cta_delivery / וכו׳ */
export type SalesFlowCtaTypeUiValue =
  | "trial:link"
  | "trial:none"
  | "schedule:link"
  | "schedule:image"
  | "schedule:none"
  | "memberships:link"
  | "memberships:range"
  | "memberships:none"
  | "address";

/** מפתח טופס מתוך הכפתור השמור (ללא שדה «דרך ההצגה» נפרד) */
export function getSalesFlowCtaTypeUiValue(b: SalesFlowCtaButton): SalesFlowCtaTypeUiValue {
  if (b.kind === "address") return "address";
  if (b.kind === "trial") return (b.trial_cta_delivery ?? "link") === "none" ? "trial:none" : "trial:link";
  if (b.kind === "memberships") {
    const m = b.memberships_cta_delivery ?? "link";
    if (m === "none") return "memberships:none";
    if (m === "range") return "memberships:range";
    return "memberships:link";
  }
  const d = b.schedule_cta_delivery ?? "link";
  if (d === "image") return "schedule:image";
  if (d === "none") return "schedule:none";
  return "schedule:link";
}

/**
 * מצב כפתור CTA מתוך בחירת «סוג» בדף ההגדרות.
 * מתעדף שמירה על תמונת מערכת השעות כשעוברים מ־לינק אל תמונה וחזרה.
 */
export function salesFlowCtaButtonFromTypeUiChoice(
  base: Pick<SalesFlowCtaButton, "id" | "label">,
  previous: SalesFlowCtaButton,
  uiRaw: string
): SalesFlowCtaButton {
  const { id, label } = base;
  const ui = uiRaw.trim() as SalesFlowCtaTypeUiValue | string;

  if (ui === "address") return { id, label, kind: "address" };

  if (ui === "trial:link" || ui === "trial:none") {
    return { id, label, kind: "trial", trial_cta_delivery: ui === "trial:none" ? "none" : "link" };
  }

  if (ui === "memberships:link" || ui === "memberships:none") {
    return {
      id,
      label,
      kind: "memberships",
      memberships_cta_delivery: ui === "memberships:none" ? "none" : "link",
    };
  }

  if (ui === "memberships:range") {
    const prevM = previous.kind === "memberships" ? previous : undefined;
    return {
      id,
      label,
      kind: "memberships",
      memberships_cta_delivery: "range",
      memberships_price_range_min: prevM?.memberships_price_range_min ?? "",
      memberships_price_range_max: prevM?.memberships_price_range_max ?? "",
    };
  }

  const prevSch = previous.kind === "schedule" ? previous : undefined;
  const keepImgUrl = () => String(prevSch?.schedule_cta_image_url ?? "").trim();
  const keepImgType = (): "image" | "" =>
    prevSch?.schedule_cta_image_type === "image" ? "image" : "";

  if (ui === "schedule:link") {
    return {
      id,
      label,
      kind: "schedule",
      schedule_cta_delivery: "link",
      schedule_cta_image_url: "",
      schedule_cta_image_type: "",
    };
  }

  if (ui === "schedule:none") {
    return {
      id,
      label,
      kind: "schedule",
      schedule_cta_delivery: "none",
      schedule_cta_image_url: "",
      schedule_cta_image_type: "",
    };
  }

  if (ui === "schedule:image") {
    return {
      id,
      label,
      kind: "schedule",
      schedule_cta_delivery: "image",
      schedule_cta_image_url: keepImgUrl(),
      schedule_cta_image_type: keepImgUrl() ? keepImgType() : "",
    };
  }

  return { id, label, kind: "trial", trial_cta_delivery: "link" };
}

export type EffectiveSalesFlowCtaInput = {
  trialRegistered: boolean | null;
  allowTrialCta: boolean;
  /** כשיש לפחות אחד מ־schedule | memberships | address */
  consumedNonTrialKinds: Set<string> | string[];
};

/** סינון כפתורי CTA בשיחת ווטסאפ: לא מציג ניסיון אם רשום (אלא אם allowTrial), כיבוי לפי סוג (לינק/ללא), להסיר כפתור שכבר נוצל. */
export function getEffectiveSalesFlowCtaButtons(
  buttons: SalesFlowCtaButton[],
  input: EffectiveSalesFlowCtaInput
): SalesFlowCtaButton[] {
  const consumed = new Set(
    (Array.from(input.consumedNonTrialKinds) as string[]).map((k) => String(k ?? "").trim()).filter(Boolean)
  );
  let out = [...buttons];

  if (input.trialRegistered === true && !input.allowTrialCta) {
    out = out.filter((b) => b.kind !== "trial");
  }
  out = out.filter((b) => {
    if (b.kind === "trial") {
      if ((b.trial_cta_delivery ?? "link") === "none") return false;
      return true;
    }
    if (b.kind === "schedule") {
      if ((b.schedule_cta_delivery ?? "link") === "none") return false;
    }
    if (b.kind === "memberships") {
      if ((b.memberships_cta_delivery ?? "link") === "none") return false;
    }
    if (b.kind === "schedule" || b.kind === "memberships" || b.kind === "address") {
      return !consumed.has(b.kind);
    }
    if (b.kind === "workshop_purchase" || b.kind === "course_enroll") {
      return !consumed.has(b.kind);
    }
    if (b.kind === "workshop_contact" || b.kind === "course_contact") {
      return !consumed.has(b.kind);
    }
    return true;
  });

  const order: Record<SalesFlowCtaKind, number> = {
    trial: 0,
    schedule: 1,
    memberships: 2,
    address: 3,
    workshop_purchase: 4,
    workshop_contact: 5,
    course_enroll: 6,
    course_contact: 7,
  };
  return [...out].sort((a, b) => (order[a.kind] ?? 99) - (order[b.kind] ?? 99));
}

/** סינון כפתורי CTA לסדנה/קורס (לא מסירים לפי trial_registered) */
export function getEffectiveSecondaryOfferCtaButtons(buttons: SalesFlowCtaButton[], consumedKinds: string[]): SalesFlowCtaButton[] {
  const consumed = new Set(consumedKinds.map((k) => String(k ?? "").trim()).filter(Boolean));
  const sfEff: EffectiveSalesFlowCtaInput = {
    trialRegistered: false,
    allowTrialCta: true,
    consumedNonTrialKinds: consumed,
  };
  return getEffectiveSalesFlowCtaButtons(buttons, sfEff);
}

export function ctaButtonsForOfferKind(cfg: SalesFlowConfig, kind: OfferKind): SalesFlowCtaButton[] {
  if (kind === "workshop") return cfg.cta_workshop_buttons ?? [];
  if (kind === "course") return cfg.cta_course_buttons ?? [];
  return cfg.cta_buttons ?? [];
}

export function fillWorkshopCtaBodyTemplate(template: string, priceText: string, durationText: string): string {
  const p = priceText.trim() || "...";
  const d = durationText.trim() || "...";
  return template
    .replace(/\{priceText\}/g, p)
    .replace(/\{price\}/g, p)
    .replace(/\{durationText\}/g, d)
    .replace(/\{duration\}/g, d);
}

export function fillCourseCtaBodyTemplate(
  template: string,
  priceText: string,
  sessionsText: string,
  startDate: string,
  endDate: string
): string {
  const p = priceText.trim() || "...";
  const s = sessionsText.trim() || "...";
  const a = startDate.trim() || "...";
  const b = endDate.trim() || "...";
  return template
    .replace(/\{priceText\}/g, p)
    .replace(/\{price\}/g, p)
    .replace(/\{sessions\}/g, s)
    .replace(/\{start_date\}/g, a)
    .replace(/\{end_date\}/g, b);
}

export function fillOfferKindCtaBody(
  kind: OfferKind,
  cfg: SalesFlowConfig,
  row: {
    priceText: string;
    durationText: string;
    sessionsText: string;
    startDate: string;
    endDate: string;
  }
): string {
  if (kind === "workshop") {
    return fillWorkshopCtaBodyTemplate(cfg.cta_workshop_body ?? "", row.priceText, row.durationText);
  }
  if (kind === "course") {
    return fillCourseCtaBodyTemplate(
      cfg.cta_course_body ?? "",
      row.priceText,
      row.sessionsText,
      row.startDate,
      row.endDate
    );
  }
  return fillCtaBodyTemplate(cfg.cta_body, row.priceText, row.durationText);
}

export function offerKindFromServiceMeta(meta: Record<string, unknown>): OfferKind {
  const k = String(meta.offer_kind ?? "trial").trim().toLowerCase();
  if (k === "workshop" || k === "course") return k;
  return "trial";
}

const FOLLOW_KIND_ORDER = ["trial", "schedule", "memberships"] as const;

function ctaKindEnabledInButtons(buttons: SalesFlowCtaButton[], kind: (typeof FOLLOW_KIND_ORDER)[number]): boolean {
  const row = buttons.find((b) => b.kind === kind);
  if (!row) return false;
  if (kind === "trial") return (row.trial_cta_delivery ?? "link") !== "none";
  if (kind === "schedule") return (row.schedule_cta_delivery ?? "link") !== "none";
  if (kind === "memberships") return (row.memberships_cta_delivery ?? "link") !== "none";
  return false;
}

/** שלוש התוויות ההיסטוריות מיושרות ל־trial/schedule/memberships — מסוננות כמו הכפתורים */
export function getEffectiveFollowupMenuLabels(
  options: readonly [string, string, string],
  input: EffectiveSalesFlowCtaInput,
  ctaButtons: SalesFlowCtaButton[]
): string[] {
  const consumed = new Set(
    (Array.from(input.consumedNonTrialKinds) as string[]).map((k) => String(k ?? "").trim()).filter(Boolean)
  );
  const out: string[] = [];
  for (let i = 0; i < FOLLOW_KIND_ORDER.length; i++) {
    const kind = FOLLOW_KIND_ORDER[i]!;
    if (!ctaKindEnabledInButtons(ctaButtons, kind)) continue;
    const label = String(options[i] ?? "").trim();
    if (!label) continue;
    if (kind !== "trial" && consumed.has(kind)) continue;
    if (input.trialRegistered === true && !input.allowTrialCta && kind === "trial") continue;
    out.push(label);
  }
  return out;
}

function migrateLegacyCtaBody(raw: string, fallback: string): string {
  const text = raw.trim();
  if (!text) return fallback;
  const legacyBodies = new Set([
    "מה דעתך שנבדוק מתי האימון ניסיון הבא?",
    "מה דעתכם שנבדוק מתי אימון הניסיון הבא?",
    "נבדוק מתי אימון הניסיון הבא?",
    "מה דעתך שנבדוק מתי אימון הניסיון הבא?",
  ]);
  return legacyBodies.has(text) ? fallback : raw;
}

function migrateLegacyCtaButtons(buttons: SalesFlowCtaButton[], fallback: SalesFlowCtaButton[]): SalesFlowCtaButton[] {
  if (!buttons.length) return fallback;
  const normalized = buttons.map((b) => ({
    ...b,
    label: b.label.trim(),
  }));
  const shouldNormalizeThirdSlot =
    normalized.length >= 3 &&
    normalized[0]?.kind === "trial" &&
    normalized[1]?.kind === "schedule" &&
    (
      normalized[2]?.kind === "address" ||
      normalized[2]?.kind === "memberships" ||
      normalized[2]?.label === "מה הכתובת?" ||
      normalized[2]?.label === "יש לי שאלה אחרת" ||
      normalized[2]?.label === "מה מחירי המנויים?" ||
      normalized[2]?.label === "מחירי מנויים"
    );
  if (!shouldNormalizeThirdSlot) return buttons;
  return [
    normalized[0]!,
    normalized[1]!,
    {
      ...normalized[2]!,
      id: normalized[2]!.id || "cta-memberships",
      label: "מחירי מנויים",
      kind: "memberships",
      memberships_cta_delivery: normalized[2]!.memberships_cta_delivery ?? "link",
    },
    ...normalized.slice(3),
  ];
}

function migrateLegacyGreetingTagline(raw: string, fallback: string): string {
  const text = raw.trim();
  if (!text) return fallback;
  if (text.includes("{tagline}")) return raw;
  if (text.includes("•")) return fallback;
  return raw;
}

/** תאימות לדשבורד ישן: הצגת מנויים סומנה ב-checkbox במקום ב־memberships_cta_delivery */
function applyLegacyMembershipsCheckbox(c: SalesFlowConfig): SalesFlowConfig {
  if (c.show_memberships_button !== false) return c;
  return {
    ...c,
    cta_buttons: c.cta_buttons.map((btn) =>
      btn.kind === "memberships" ? { ...btn, memberships_cta_delivery: "none" as const } : btn
    ),
  };
}

function migrateLegacyGreetingBodyOverride(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  if (text.includes("•")) return undefined;
  return raw;
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
  const cfg: SalesFlowConfig = {
    opening_note: typeof o.opening_note === "string" ? o.opening_note : base.opening_note,
    greeting_opener: typeof o.greeting_opener === "string" ? o.greeting_opener : base.greeting_opener,
    greeting_line_name: typeof o.greeting_line_name === "string" ? o.greeting_line_name : base.greeting_line_name,
    greeting_line_tagline: migrateLegacyGreetingTagline(
      typeof o.greeting_line_tagline === "string" ? o.greeting_line_tagline : base.greeting_line_tagline,
      base.greeting_line_tagline
    ),
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
        "אוקיי מדהים! {serviceName}. {benefitLine} - דרך נעימה להתקדם, להרגיש את הגוף ולהיות חלק מקהילה תומכת.";
      const legacy2 =
        "אוקיי מדהים! שיעורי {serviceName} אצלנו הם דרך סופר נעימה לקחת את מה שחשוב לך מהאימון - במיוחד {benefitLine} - ולהמשיך באווירה חמה ומקצועית, חלק מקהילה שאוהבת את מה שעושים.";
      const legacyLongBenefitDump =
        "אוקיי מדהים! {serviceName} אצלנו זה בדיוק המקום לקחת את מה שמעניין אותך מהאימון - במיוחד {benefitLine} - ולהתקדם בצורה נעימה, ברורה ומקצועית.";
      const legacyFriendlyBody =
        "אוקיי מדהים! {serviceName} שלנו זו דרך וואו להתחזק, להתגמש, להכיר אנשים מדהימים ולמצוא אהבה חדשה לאימון.";
      const legacyFormalBody =
        "מצוין. {serviceName} שלנו הם הזדמנות נעימה להתחזק, להתגמש ולהרגיש את האיזון - בגוף ובנפש, בקצב מקצועי ותומך.";
      const legacyDirectBody =
        "אוקיי. {serviceName} שלנו - להתחזק, להתגמש, ולהרגיש שזה בדיוק בשבילך.";
      if (raw.trim() === legacy) return base.after_service_pick;
      if (raw.trim() === legacy2) return base.after_service_pick;
      if (raw.trim() === legacyLongBenefitDump) return base.after_service_pick;
      if (raw.trim() === legacyFriendlyBody) return base.after_service_pick;
      if (raw.trim() === legacyFormalBody) return base.after_service_pick;
      if (raw.trim() === legacyDirectBody) return base.after_service_pick;
      return raw;
    })(),
    experience_question:
      typeof o.experience_question === "string" ? o.experience_question : base.experience_question,
    experience_options: ex(o.experience_options),
    after_experience: typeof o.after_experience === "string" ? o.after_experience : base.after_experience,
    experience_question_workshop:
      typeof o.experience_question_workshop === "string"
        ? o.experience_question_workshop
        : base.experience_question_workshop,
    experience_options_workshop: ((): [string, string, string] => {
      const i = o.experience_options_workshop;
      if (!Array.isArray(i) || i.length < 3) return [...base.experience_options_workshop];
      return [String(i[0] ?? ""), String(i[1] ?? ""), String(i[2] ?? "")];
    })(),
    after_experience_workshop:
      typeof o.after_experience_workshop === "string"
        ? o.after_experience_workshop
        : base.after_experience_workshop,
    opening_extra_steps_workshop: parseExtraSteps(o.opening_extra_steps_workshop ?? base.opening_extra_steps_workshop),
    experience_question_course:
      typeof o.experience_question_course === "string"
        ? o.experience_question_course
        : base.experience_question_course,
    experience_options_course: ((): [string, string, string] => {
      const i = o.experience_options_course;
      if (!Array.isArray(i) || i.length < 3) return [...base.experience_options_course];
      return [String(i[0] ?? ""), String(i[1] ?? ""), String(i[2] ?? "")];
    })(),
    after_experience_course:
      typeof o.after_experience_course === "string" ? o.after_experience_course : base.after_experience_course,
    opening_extra_steps_course: parseExtraSteps(o.opening_extra_steps_course ?? base.opening_extra_steps_course),
    greeting_extra_steps: parseExtraSteps(o.greeting_extra_steps),
    opening_extra_steps: parseExtraSteps(o.opening_extra_steps),
    cta_body: migrateLegacyCtaBody(typeof o.cta_body === "string" ? o.cta_body : base.cta_body, base.cta_body),
    cta_buttons: migrateLegacyCtaButtons(parseCtaButtons(o.cta_buttons), base.cta_buttons).map((btn, i) =>
      normalizeCtaButtonForSlot(btn, i)
    ),
    cta_workshop_body:
      typeof o.cta_workshop_body === "string" ? o.cta_workshop_body : base.cta_workshop_body,
    cta_workshop_buttons: parseOfferKindFlowButtons(o.cta_workshop_buttons, base.cta_workshop_buttons),
    cta_course_body: typeof o.cta_course_body === "string" ? o.cta_course_body : base.cta_course_body,
    cta_course_buttons: parseOfferKindFlowButtons(o.cta_course_buttons, base.cta_course_buttons),
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
    greeting_body_override: migrateLegacyGreetingBodyOverride(o.greeting_body_override),
    /** ברירת מחדל true — לתאימות בלבד; בשימוש אפשרי עם applyLegacyMembershipsCheckbox */
    show_memberships_button: o.show_memberships_button === false ? false : true,
  };
  return applyLegacyMembershipsCheckbox(cfg);
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
    experience_question_workshop: c.experience_question_workshop,
    experience_options_workshop: [...c.experience_options_workshop],
    after_experience_workshop: c.after_experience_workshop,
    experience_question_course: c.experience_question_course,
    experience_options_course: [...c.experience_options_course],
    after_experience_course: c.after_experience_course,
    greeting_extra_steps: [],
    opening_extra_steps: c.opening_extra_steps.map((s) => ({
      id: s.id,
      question: s.question,
      options: s.options,
    })),
    opening_extra_steps_workshop: c.opening_extra_steps_workshop.map((s) => ({
      id: s.id,
      question: s.question,
      options: s.options,
    })),
    opening_extra_steps_course: c.opening_extra_steps_course.map((s) => ({
      id: s.id,
      question: s.question,
      options: s.options,
    })),
    cta_body: c.cta_body,
    cta_workshop_body: c.cta_workshop_body,
    cta_workshop_buttons: (c.cta_workshop_buttons ?? []).map((b) => {
      const row: Record<string, unknown> = { id: b.id, label: b.label, kind: b.kind };
      if (b.kind === "workshop_purchase" || b.kind === "course_enroll") {
        row.secondary_purchase_delivery = b.secondary_purchase_delivery ?? "link";
      }
      return row;
    }),
    cta_course_body: c.cta_course_body,
    cta_course_buttons: (c.cta_course_buttons ?? []).map((b) => {
      const row: Record<string, unknown> = { id: b.id, label: b.label, kind: b.kind };
      if (b.kind === "workshop_purchase" || b.kind === "course_enroll") {
        row.secondary_purchase_delivery = b.secondary_purchase_delivery ?? "link";
      }
      return row;
    }),
    show_memberships_button: c.cta_buttons.some(
      (b) =>
        b.kind === "memberships" &&
        ((b.memberships_cta_delivery ?? "link") === "link" ||
          (b.memberships_cta_delivery ?? "link") === "range")
    ),
    cta_buttons: c.cta_buttons.map((b) => {
      const row: Record<string, unknown> = { id: b.id, label: b.label, kind: b.kind };
      if (b.kind === "trial") {
        row.trial_cta_delivery = b.trial_cta_delivery ?? "link";
      }
      if (b.kind === "schedule") {
        row.schedule_cta_delivery = b.schedule_cta_delivery ?? "link";
        row.schedule_cta_image_url = b.schedule_cta_image_url ?? "";
        row.schedule_cta_image_type = b.schedule_cta_image_type ?? "";
      }
      if (b.kind === "memberships") {
        row.memberships_cta_delivery = b.memberships_cta_delivery ?? "link";
        if ((b.memberships_cta_delivery ?? "link") === "range") {
          row.memberships_price_range_min = String(b.memberships_price_range_min ?? "").trim();
          row.memberships_price_range_max = String(b.memberships_price_range_max ?? "").trim();
        }
      }
      return row;
    }),
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
  taglineText: string,
  addressText = ""
): string {
  if (c.greeting_body_override?.trim()) return c.greeting_body_override.trim();
  const bot = botName.trim() || "זואי";
  const biz = businessName.trim() || "העסק";
  const tag = taglineText.trim() || "…";
  const lineName = c.greeting_line_name.replace(/\{botName\}/g, bot).replace(/\{businessName\}/g, biz);
  const lineTag = c.greeting_line_tagline.replace(/\{tagline\}/g, tag);
  const addressLine = addressText.trim() ? `כתובתנו היא ${addressText.trim()}` : "";
  return [c.greeting_opener, lineName, lineTag, c.greeting_closer, addressLine].filter(Boolean).join("\n");
}

export type ServiceLike = {
  name: string;
  benefit_line?: string;
  service_slug?: string;
  /** סוג הצעה — משפיע על שאלת סשן החימום בהודעת פתיחה כשיש שירות יחיד */
  offer_kind?: OfferKind;
};

/** שאלת חימום + אפשרויות + תוספות + תבנית «אחרי הניסיון» לפי סוג השירות שנבחר בפועל */
export function resolveWarmupExperienceConfig(
  cfg: SalesFlowConfig,
  kind: OfferKind
): {
  question: string;
  options: [string, string, string];
  extras: SalesFlowExtraStep[];
  afterExperienceRaw: string;
} {
  if (kind === "workshop") {
    return {
      question: cfg.experience_question_workshop ?? FRIENDLY.experience_question_workshop,
      options: [...(cfg.experience_options_workshop ?? FRIENDLY.experience_options_workshop)] as [
        string,
        string,
        string,
      ],
      extras: structuredClone(cfg.opening_extra_steps_workshop ?? []),
      afterExperienceRaw:
        cfg.after_experience_workshop ??
        cfg.after_experience ??
        FRIENDLY.after_experience_workshop ??
        FRIENDLY.after_experience,
    };
  }
  if (kind === "course") {
    return {
      question: cfg.experience_question_course ?? FRIENDLY.experience_question_course,
      options: [...(cfg.experience_options_course ?? FRIENDLY.experience_options_course)] as [
        string,
        string,
        string,
      ],
      extras: structuredClone(cfg.opening_extra_steps_course ?? []),
      afterExperienceRaw:
        cfg.after_experience_course ??
        cfg.after_experience ??
        FRIENDLY.after_experience_course ??
        FRIENDLY.after_experience,
    };
  }
  return {
    question: cfg.experience_question,
    options: [...cfg.experience_options],
    extras: structuredClone(cfg.opening_extra_steps),
    afterExperienceRaw: cfg.after_experience,
  };
}

export function formatServiceLevelsText(levelsEnabled: boolean, levels: string[]): string {
  const cleanLevels = levels.map((level) => String(level ?? "").trim()).filter(Boolean);
  if (!levelsEnabled || cleanLevels.length === 0) {
    return "יש לנו אימונים לכל הרמות,";
  }
  if (cleanLevels.length === 1) {
    return `יש לנו אימונים לרמת ${cleanLevels[0]},`;
  }
  if (cleanLevels.length === 2) {
    return `יש לנו אימונים לרמת ${cleanLevels[0]} ו${cleanLevels[1]},`;
  }
  return `יש לנו אימונים לרמת ${cleanLevels.slice(0, -1).join(", ")} ו${cleanLevels[cleanLevels.length - 1]},`;
}

export function fillAfterExperienceTemplate(
  template: string,
  levelsEnabled: boolean,
  levels: string[]
): string {
  return template.replace(/\{levelsText\}/g, formatServiceLevelsText(levelsEnabled, levels));
}

export function syncWelcomeFromSalesFlow(
  c: SalesFlowConfig,
  services: ServiceLike[],
  botName: string,
  businessName: string,
  taglineText: string,
  addressText = ""
): { intro: string; question: string; options: string[] } {
  const named = services.map((s) => s.name.trim()).filter(Boolean);
  const intro = composeGreeting(c, botName, businessName, taglineText, addressText);
  if (named.length > 1) {
    return {
      intro,
      question: c.multi_service_question,
      options: named.slice(0, 12),
    };
  }
  if (named.length === 1) {
    const sn = named[0]!;
    const row = services.find((s) => s.name.trim() === sn);
    const kind = row?.offer_kind ?? "trial";
    const wb = resolveWarmupExperienceConfig(c, kind);
    return {
      intro,
      question: wb.question.replace(/\{serviceName\}/g, sn),
      options: [...wb.options],
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
  taglineText: string,
  addressText = ""
): string {
  const named = services.map((s) => s.name.trim()).filter(Boolean);
  const lines: string[] = [];
  lines.push(composeGreeting(c, botName, businessName, taglineText, addressText));
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
    const sn = named[0]!;
    const row = services.find((s) => s.name.trim() === sn);
    const wb = resolveWarmupExperienceConfig(c, row?.offer_kind ?? "trial");
    lines.push("", wb.question.replace(/\{serviceName\}/g, sn));
    wb.options.forEach((o) => lines.push(o));
  }
  return lines.join("\n");
}

export type WhatsAppOpeningPreviewSection =
  | { kind: "text"; text: string }
  | { kind: "buttons"; labels: string[] };

/** מקטעים לתצוגה מקדימה — טקסט ו״כפתורים״ בלי מספור (עד 3 אימונים) */
const AFTER_SERVICE_PICK_OPENERS = [
  "מהמם",
  "מדהים",
  "כיף לשמוע",
  "וואו",
  "איזה כיף",
  "מצוין",
  "סופר",
  "כיף גדול",
  "אוקיי מדהים",
] as const;

const LESSON_ACTIVITY_PATTERN =
  /(?:^|\s|_)(?:יוגה|yoga|פילאטיס|pilates|ספינינג|spinning|בוקס|boxing|זומבה|zumba|בלט|ballet|ריקוד|dance|פלדנקרייז|feldenkrais)(?:$|\s|_)/iu;

const TRAINING_ACTIVITY_PATTERN =
  /(?:^|\s|_)(?:כוח|strength|כושר|fitness|קרוס\s*פיט|crossfit|cross\s*fit|\btrx\b|ריצה|running|\bhiit\b|\bhit\b|פונקציונלי|functional|אינטרוול|מתח|משקולות|אימון\s*כוח)(?:$|\s|_)/iu;

/** שם שפעילות נקבה יחידה מובהקת והכוונה בהקשר איננה «סוג השיעורים» ברבים */
const FEMININE_SINGULAR_SUBJECT_REGEX = /^זומבה$/iu;

/** יציבות: אותה מילת פתיחה לאותה בחירה */
export function pickAfterServicePickOpener(serviceName: string): string {
  const key = serviceName.trim() || "__";
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % AFTER_SERVICE_PICK_OPENERS.length;
  return AFTER_SERVICE_PICK_OPENERS[idx]!;
}

/** השם כבר כולל «שיעור»/«אימון» — לא מוסיפים שיעורי/אימוני */
function serviceNameAlreadyHasLessonOrTrainingWord(name: string): boolean {
  const raw = name.trim().replace(/\s+/g, " ");
  if (!raw) return false;
  return /(?:^|\s)(?:שיעורי|שיעור(?:ים)?|אימוני|אימון)(?:\s|$)/u.test(raw);
}

/** נושא בחירת אימון: קידומת (שיעורי / אימוני) או השם כפי שהוזן כשכבר יש ניסוח מתאים */
export function buildServicePickSubjectFragment(serviceName: string): string {
  const raw = serviceName.trim().replace(/\s+/g, " ");
  if (!raw) return "האימונים";

  if (serviceNameAlreadyHasLessonOrTrainingWord(raw)) return raw;

  let coreForPrefix = raw;
  const im = /^אימון\s+(.+)/u.exec(raw);
  if (im?.[1]) coreForPrefix = im[1]!.trim().replace(/\s+/g, " ");

  const hay = `${raw} ${coreForPrefix}`;
  let fragment: string;
  if (LESSON_ACTIVITY_PATTERN.test(hay)) fragment = `שיעורי ${coreForPrefix}`;
  else if (TRAINING_ACTIVITY_PATTERN.test(hay)) fragment = `אימוני ${coreForPrefix}`;
  else fragment = `אימוני ${coreForPrefix}`;

  return fragment.replace(/\s+/g, " ").trim();
}

const FIRST_DESCRIPTOR_WORD_WINDOW = 4;

/** השדה בשם של מחטים לזיהוי כפילות בין הנושא לתיאור (עם ובלי קידומת סטנדרטיות) */
function collectSubjectOverlapNeedles(subject: string, serviceName: string): string[] {
  const needles: string[] = [];
  const add = (s: string) => {
    const t = s.trim().replace(/\s+/g, " ");
    if (t.length > 0 && !needles.includes(t)) needles.push(t);
  };

  add(subject);
  const raw = serviceName.trim().replace(/\s+/g, " ");
  if (raw) {
    add(raw);
    add(`שיעורי ${raw}`);
    add(`אימוני ${raw}`);
    add(`שיעור ${raw}`);
    add(`אימון ${raw}`);
  }

  needles.sort((a, b) => b.length - a.length);
  return needles;
}

/**
 * התאמה של חל חופף בשלושים–ארבע המילים הראשונות: מחיקת המקטע הכפול בלבד, בלי לערוך את שאר התיאור.
 */
function redundantSegmentOverlapInTrialDescription(description: string, subject: string, serviceName: string): {
  overlaps: boolean;
  rest: string;
} {
  const d = description.trim().replace(/\s+/g, " ");
  if (!d) return { overlaps: false, rest: d };

  const tokens = d.split(/\s+/);
  const headEnd = Math.min(tokens.length, FIRST_DESCRIPTOR_WORD_WINDOW);
  const needles = collectSubjectOverlapNeedles(subject, serviceName);

  /** לא לקטוג כפילות כש„יוגה/פילאטיס״ הם החלק השני אחרי ״תרגול / שיעור / אימון״ והמחט הוא רק שם הפעילות */
  const PRACTICE_HEAD_TOKEN =
    /^(?:תרגולים|תרגול|שיעורים|שיעור|שיעורי|אימונים|אימון|אימוני|תרגל)$/u;

  for (const needle of needles) {
    const nt = needle.split(/\s+/).filter(Boolean);
    if (nt.length === 0) continue;

    const maxSi = Math.min(headEnd - 1, tokens.length - nt.length);
    for (let si = 0; si <= maxSi; si++) {
      if (si + nt.length > headEnd) break;
      const slice = tokens.slice(si, si + nt.length).join(" ");
      if (slice !== needle) continue;
      if (nt.length === 1 && si > 0 && PRACTICE_HEAD_TOKEN.test(tokens[si - 1] ?? "")) continue;

      const restParts = [...tokens.slice(0, si), ...tokens.slice(si + nt.length)];
      return { overlaps: true, rest: restParts.join(" ").trim() };
    }
  }

  return { overlaps: false, rest: d };
}

const PRACTICE_DESCRIPTION_OPENERS =
  /^(תרגולים|תרגול|שיעורים|שיעור|שיעורי|אימונים|אימון|אימוני|תרגל)\s+(\S+)/u;

/** האם מילה מהשם שווה לטוקן סוג הפעילות אחרי ״תרגול/שיעור/אימון…״ בראש התיאור */
function serviceNameCoversPracticeKindToken(serviceName: string, kindToken: string): boolean {
  const k = kindToken.trim().replace(/\s+/g, " ");
  const s = serviceName.trim().replace(/\s+/g, " ");
  if (!k || !s) return false;
  if (s === k) return true;
  const words = s.split(/\s+/).filter(Boolean);
  return words.some((w) => w === k);
}

/**
 * תיאור שכבר נפתח במשפט מלא („תרגול קונדליני מעורר…״) — בלי כפילות „אימוני קונדליני הם״ לפני.
 */
function trialDescriptionIsStandalonePracticeAboutService(description: string, serviceName: string): boolean {
  const d = description.trim().replace(/\s+/g, " ");
  if (!d || !serviceName.trim()) return false;
  const m = PRACTICE_DESCRIPTION_OPENERS.exec(d);
  if (!m?.[2]) return false;
  return serviceNameCoversPracticeKindToken(serviceName, m[2]);
}

/**
 * אחרי שורש זכר (תרגול / שיעור / אימון …) ושם סוג פעילות נשית (יוגה, פילאטיס …),
 * מתארי נסמך על השורש — לא על יוגה וכו׳. מיועד לתיאורים מסריקה/AI שממסדרים מגדר לפי ״יוגה״.
 */
export function normalizeMasculinePredicatesAfterPracticeHead(text: string): string {
  const s = text.trim().replace(/\s+/g, " ");
  if (!s) return s;

  /**
   * JS `\b` matches only ASCII `[A-Za-z0-9_]` “word” chars — Hebrew is excluded,
   * so patterns like `\bתרגול` never fired. Anchor at line start / after whitespace instead.
   */
  const heStart = String.raw`(?:^|(?<=\s))`;
  const heEnd = String.raw`(?=\s|$|[,.;:!?״"'׳])`;

  const head = String.raw`(?:תרגולים|תרגול|שיעורים|שיעור|שיעורי|אימונים|אימון|אימוני|תרגל)`;
  const kind = String.raw`(?:יוגה|פילאטיס|זומבה|בוקס|בלט|ספינינג|קונדליני|וויניאסה|אשטנגה|האתה|נדה|נדא)`;
  const qual = String.raw`(?:(?:לנשים|לגברים|למתחילים|למתקדמים|לכולם|לכולן|לכל\s+הגילאים)\s+)?`;
  const prefix = String.raw`${heStart}(${head}\s+${kind}\s+)(${qual})`;

  const mapSecond: Record<string, string> = {
    מחזקת: "מחזק",
    מעודדת: "מעודד",
    מפתחת: "מפתח",
  };

  let out = s;

  const rxCompound = new RegExp(
    `${prefix}מזינה\\s+ו(מחזקת|מעודדת|מפתחת)${heEnd}`,
    "giu"
  );
  out = out.replace(rxCompound, (_, a: string, b: string, w: string) => `${a}${b}מזין ו${mapSecond[w] ?? "מחזק"}`);

  const rxMazina = new RegExp(`${prefix}מזינה${heEnd}(?!\\s+ו(?:מחזק|מעודד|מפתח))`, "giu");
  out = out.replace(rxMazina, "$1$2מזין");

  const rxSingle: Array<[string, string]> = [
    ["מחזקת", "מחזק"],
    ["מעודדת", "מעודד"],
    ["מפתחת", "מפתח"],
  ];
  for (const [fem, masc] of rxSingle) {
    const rx = new RegExp(`${prefix}${fem}${heEnd}`, "giu");
    out = out.replace(rx, `$1$2${masc}`);
  }

  /**
   * הנושא המדבר הוא השורש הזכר (תרגול/שיעור/אימון), לא סוג הפעילות האנגלי כמו קונדליני —
   * מודלים לעיתים מיישרות ל„המעוררת את…״ מתוך בלבול עם „אנרגיה“ (נקבה) וכו׳.
   */
  const practiceLead = String.raw`${heStart}(?:תרגולים|תרגול|שיעורים|שיעור|שיעורי|אימונים|אימון|אימוני|תרגל)\s+`;
  const rxHaMaoratAtEt = new RegExp(
    `${practiceLead}(?:[^\\s]+\\s+){0,8}המעוררת\\s+את${heEnd}`,
    "giu"
  );
  out = out.replace(rxHaMaoratAtEt, (whole) =>
    whole.replace(/\sהמעוררת\s+את(?=\s|$|[,.;:!?])/u, " מעורר את")
  );

  return out.replace(/\s+/g, " ").trim();
}

/** הסרת מילות ייחוס שנשמרו מתיאור שבו הנושא היה ישות ואז באה ההמשך בתבנית הנסמכים — אחרי ״ב[נושא]״ לא צריכים בהם/שבהם וכו׳ בהתחלה */
function stripLeadingResumptivePhraseAfterBnarrative(rest: string): string {
  const s = rest.trim().replace(/\s+/g, " ");
  if (!s) return s;

  const norm = (t: string) => t.replace(/^[,;:.)״"'”]+|[,.;:!?'״"'”]+$/gu, "");

  /** מילית יחוס מתחילת המשך (אחרי ״ב[נושא]״) — לעיתים מתוך הניסוח עם הנושא בגוף הראשון */
  const isResumptive = (token: string): boolean => {
    const t = norm(token);
    if (!t) return false;
    return /^ו?(?:שב(?:הם|הן|ו|ה|ך|נו|כם|כן)|ב(?:הם|הן|ו|ה|ך|נו|כם|כן))$/u.test(t);
  };

  const tokens = s.split(/\s+/);

  if (isResumptive(tokens[0] ?? "")) return tokens.slice(1).join(" ").trim();

  const first = norm(tokens[0] ?? "");
  if (/^ל[\u0590-\u05FF]{2,}$/u.test(first) && tokens.length >= 2 && isResumptive(tokens[1] ?? "")) {
    return [tokens[0]!, ...tokens.slice(2)].join(" ").trim();
  }

  return s;
}

export function pickServicePickPronoun(serviceName: string): "הם" | "היא" {
  const t = serviceName.trim().replace(/\s+/g, " ");
  if (FEMININE_SINGULAR_SUBJECT_REGEX.test(t)) return "היא";
  return "הם";
}

/** משפט אחרי שהלקוח בחר סוג אימון (ווטסאפ והעתק מהמערכת). לנתונים ישנים / זנב בלבד — פתיחה + נושא + הם/היא + זנב. */
export function composeAfterServicePickReply(serviceName: string, benefitLine: string): string {
  const opener = pickAfterServicePickOpener(serviceName);
  const subject = buildServicePickSubjectFragment(serviceName);
  const pronoun = pickServicePickPronoun(serviceName);
  const desc = benefitLine.trim();
  if (!desc) {
    return `${opener}! ${subject} ${pronoun}.`.replace(/\s+/g, " ").trim();
  }
  return `${opener}! ${subject} ${pronoun} ${desc}`.replace(/\s+/g, " ").trim();
}

/**
 * תשובה אחרי בחירת סוג אימון מתוך תיאור מטאב אימון ניסיון,
 * עם נירמול מגדרי ממוקד אחרי תרגול/שיעור/אימון + סוג פעילות, וזיהוי כפילות בראש התיאור.
 */
export function composeAfterServicePickReplyFromTrialDescription(
  serviceName: string,
  trialDescription: string
): string {
  const desc = normalizeMasculinePredicatesAfterPracticeHead(trialDescription);

  // בלי תיאור מהטאב — זנב דיפולט להודעה ברורה (אותו סגנון כמו עטיפת זנב ישן)
  if (!desc) {
    return composeAfterServicePickReply(serviceName, "דרך מעולה להתחזק ולהתקדם בקצב נכון ונעים");
  }

  const opener = pickAfterServicePickOpener(serviceName);
  const subject = buildServicePickSubjectFragment(serviceName);
  const pronoun = pickServicePickPronoun(serviceName);

  if (trialDescriptionIsStandalonePracticeAboutService(desc, serviceName.trim())) {
    return `${opener}! ${desc}`.replace(/\s+/g, " ").trim();
  }

  const { overlaps, rest } = redundantSegmentOverlapInTrialDescription(desc, subject, serviceName.trim());
  if (overlaps) {
    const body = stripLeadingResumptivePhraseAfterBnarrative(rest).trim();
    return `${opener}! ב${subject}${body ? ` ${body}` : ""}`.replace(/\s+/g, " ").trim();
  }

  return `${opener}! ${subject} ${pronoun} ${desc}`.replace(/\s+/g, " ").trim();
}

/** משפט אחרי בחירת אימון — כבר בנוי (נשמר ב־benefit_line המלא); מאותר כדי למנוע עטיפה כפולה */
function benefitLineLooksFullyComposed(text: string): boolean {
  const t = text.trim();
  for (const op of AFTER_SERVICE_PICK_OPENERS) {
    const p = `${op}!`;
    if (t.startsWith(p) || t.startsWith(`${p} `)) return true;
  }
  return false;
}

/** @deprecated הרכבת הנושא הישנה (שיעורי ה…) — משמש רק למקומות בתשתית הגדרות; מתיישב עם buildServicePickSubjectFragment */
export function trialServicePhraseForAfterPick(serviceName: string): string {
  return buildServicePickSubjectFragment(serviceName);
}

/**
 * טקסט ללקוח אחרי בחירת סוג אימון.
 * benefit_line מהדשבורד הוא בדרך כלל משפט מלא (פתיחה + נושא + הם/היא + זנב).
 * תאימות לנתונים ישנים שבהם נשמר רק הזנב — עוטפים עם composeAfterServicePickReply.
 */
export function fillAfterServicePickTemplate(_template: string, serviceName: string, benefitLine: string): string {
  void _template;
  const trimmed = benefitLine.trim();
  if (!trimmed) return composeAfterServicePickReply(serviceName, "");
  if (benefitLineLooksFullyComposed(trimmed)) return trimmed;
  return composeAfterServicePickReply(serviceName, trimmed);
}

export function fillCtaBodyTemplate(
  template: string,
  priceText: string,
  durationText: string
): string {
  return template
    .replace(/\{priceText\}/g, priceText.trim() || "...")
    .replace(/\{durationText\}/g, durationText.trim() || "...");
}

export function getWhatsAppOpeningPreviewSections(
  c: SalesFlowConfig,
  services: ServiceLike[],
  botName: string,
  businessName: string,
  taglineText: string,
  addressText = ""
): WhatsAppOpeningPreviewSection[] {
  const named = services.map((s) => s.name.trim()).filter(Boolean);
  const sections: WhatsAppOpeningPreviewSection[] = [];
  sections.push({
    kind: "text",
    text: composeGreeting(c, botName, businessName, taglineText, addressText),
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
    const sn = named[0]!;
    const row = services.find((s) => s.name.trim() === sn);
    const wb = resolveWarmupExperienceConfig(c, row?.offer_kind ?? "trial");
    sections.push({
      kind: "text",
      text: wb.question.replace(/\{serviceName\}/g, sn),
    });
    sections.push({ kind: "buttons", labels: [...wb.options] });
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
      return `  - ${n}: משפט ווטסאפ לאחר בחירת האימון (מתוך הטאב): פתיחה, נושא עם קידומת שיעורי/אימוני כשמתאים; כשהכפילות מזוהה בראש התיאור — «ב[N] » + שאר התיאור כפי שנשמר; אחרת — נושא + הם/היא + התיאור המלא בלי פרפרזה. נשמר: ${b}`;
    })
    .join("\n");

  const buttonsForPrompt = c.cta_buttons.filter((b) => {
    if (b.kind === "trial" && (b.trial_cta_delivery ?? "link") === "none") return false;
    if (b.kind === "schedule" && (b.schedule_cta_delivery ?? "link") === "none") return false;
    if (b.kind === "memberships" && (b.memberships_cta_delivery ?? "link") === "none") return false;
    return true;
  });

  const ctaDesc = buttonsForPrompt
    .map((b) => {
      const hint =
        b.kind === "schedule"
          ? (b.schedule_cta_delivery ?? "link") === "image" && String(b.schedule_cta_image_url ?? "").trim()
            ? "כשמשתמש בוחר: אינסרט תמונת מערכת שעות שהועלתה במסלול המכירה (לפני תפריט המשך); אופציונלי: כיתוב עם לינק מערכת שעות מטאב לינקים אם הוגדר"
            : "כשמשתמש בוחר: לינק מערכת שעות מטאב לינקים בדשבורד"
          : b.kind === "trial"
            ? "כשמשתמש בוחר: לינק הרשמה/תשלום משדה הקישור באימון הניסיון שנבחר (טאב אימון ניסיון)"
            : b.kind === "address"
              ? "משיב עם הכתובת של העסק מהדשבורד"
            : b.kind === "memberships"
                ? (b.memberships_cta_delivery ?? "link") === "range"
                  ? `כשמשתמש בוחר: טווח מחירים שמור בהגדרות (בין ₪ ___ ל‑₪ ___); הניסוח בווטסאפ מתוך השדות — בלי טעות במספרים`
                  : "בווטסאפ: קישור מטאב לינקים «קישור לדף מנויים וכרטיסיות»; אם אין קישור - תשובה קבועה מהמערכת"
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

  const formatSecondaryOfferPrompt = (title: string, body: string, buttons: SalesFlowCtaButton[]): string => {
    if (!buttons.length) return "";
    const lines = buttons
      .map((b) => {
        if (b.kind === "workshop_purchase" || b.kind === "course_enroll") {
          const d = b.secondary_purchase_delivery ?? "link";
          const hint =
            d === "link"
              ? "כשמשתמש בוחר: לינק סליקה משדה הקישור של אותו שירות בטאב אימון ניסיון"
              : "כשמשתמש בוחר: הצגת מספר שירות לקוחות מהדשבורד";
          return `  - "${b.label}" (${b.kind}): ${hint}`;
        }
        if (b.kind === "workshop_contact" || b.kind === "course_contact") {
          return `  - "${b.label}" (${b.kind}): מספר שירות לקוחות מהדשבורד`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
    return `\n${title}:\nגוף (מילוי לפי השירות שנבחר; מציינים בלשונית): ${body.trim() || "(ריק)"}\nכפתורים:\n${lines}\n`;
  };

  const workshopPromptBlock = formatSecondaryOfferPrompt(
    "הנעה לפעולה — כשנבחר שירות מסוג «סדנה» (מסלול מכירה)",
    c.cta_workshop_body,
    c.cta_workshop_buttons ?? []
  );
  const coursePromptBlock = formatSecondaryOfferPrompt(
    "הנעה לפעולה — כשנבחר שירות מסוג «קורס»",
    c.cta_course_body,
    c.cta_course_buttons ?? []
  );

  return `
מסלול מכירה מובנה (חובה לעקוב אחרי הסדר הלוגי; התאימי ניסוח לסגנון הדיבור):

כללים כלליים:
- שמות אימוני הניסיון ממסלול המכירה חייבים להישאר קצרים (עד ~15 תווים, 2–3 מילים) - מתאים לכפתורי WhatsApp. רע: "שיעורי אקרו יוגה שבועיים". טוב: "אקרו יוגה" או "שיעורי אקרו".
- בכל הודעה: מענה קצר לשלב הנוכחי + השאלה הבאה בפלואו + אפשרויות בחירה.
- אם יש עד 3 אימוני ניסיון - הציגי כל אימון בשורה נפרדת בלי מספרים, בנוסח כפתורי תשובה מהירה (רק הטקסט, בלי "1.").
- אם יש יותר מ־3 אימוני ניסיון - בשלב בחירת האימון השתמשי ברשימה ממוספרת ובקשי מהלקוח לכתוב מספר (ספרה) בלבד.
- שלוש אפשרויות בשאלת סשן החימום (שיעור ניסיון / סדנה / קורס לפי סוג השירות שנבחר): תמיד שורה לכל אפשרות בלי מספור, כמו כפתורים.
- אם יש רק שירות אחד בפלואו - דלגי על שאלת בחירה בין מוצרים ועברי ישר לשאלת החימום המתאימה **לסוג** אותו שירות ממסלול המכירה.
- אם הלקוח כותב בצ׳אט חופשי באמצע הפלואו: עני בקצרה מהידע (Claude), ואז חזרי מיד לשאלה הבאה בפלואו עם אותן אפשרויות בחירה.
- משלב "הנעה לפעולה" ואילך: בכל תשובה הוסיפי את כפתורי ההנעה של **אותו סוג שירות** (שיעור ניסיון / סדנה / קורס לפי מה שנבחר בתפריט השירותים).
- אם הלקוח בחר שירות שאינו שיעור ניסיון — השתמשי רק בכפתורים ובגוף ה-CTA המתאימים לסוג (סדנה או קורס), לא בכפתורי מערכת שעות/מנויים של שיעור הניסיון.
${workshopPromptBlock}${coursePromptBlock}
סשן פתיחה (אחרי הודעת המערכת הראשונה):
- טקסט הפתיחה כפי שהוגדר. אחריו - אם מופיעות שאלות נוספות מיד אחרי הפתיחה, שלבי אותן לפי הסדר עם כפתורי בחירה.
${formatExtraSteps("שאלות נוספות מיד אחרי טקסט הפתיחה (לפני בחירת אימון)", c.greeting_extra_steps)}
- אם יש יותר מאימון אחד: קודם שאלת בחירת האימון ממסלול המכירה, ואז אחרי שבחרו אימון - מענה קצר וחי כמו בשיח אמיתי (משפט עד שניים). לא להעתיק את תיאור האימון ממסלול המכירה במלואו ולא לנסח כמו "לקחת את מה שמעניין אותך מהאימון - במיוחד [פסקה ארוכה]".
- התאימי את הרוח לסוג האימון שנבחר: אקרו/דינמי - אנרגיה, קהילה, אתגר חיובי; פילאטיס/מכשירים - חיטוב, התחזקות, השקעה בעצמך; יוגה/מיינדפולנס - חיבור פנימי, איזון, גוף־נפש. אפשר לפתוח ב"אוקיי מדהים!" או "איזה כיף :)" לפי הטון.
- אחרי שהלקוח בחר סוג אימון — נשלח המשפט מהשדה במסלול: פתיחה (מה מילות הפתיחה של המערכת) ואז הנושא. אם ב־3–4 המילים הראשונות של התיאור נשמרה כפילות מול הנושא/השם, המערכת מנסחת ״פתיחה! ב[נושא] [משך התיאור בלי מקטע הכפילות]״; אחרת ״פתיחה! [נושא] הם/היא [כל התיאור כפי שמוזן במסלול, בלי פרפרזה])״. עם נתונים ישנים אולי יורכב רק זנב — אל תחליפי מה שנשלח ואל תשחזרי «שיעורי ה[שם] שלנו מתמקדים ב…».
- כללי נושא (ידני בתשובה באותו שלב): אם השם כבר מכיל «שיעור» או «אימון» — אין להוסיף קידומת חדשה. אחרת: יוגה/פילאטיס/ספינינג/בוקס/זומבה/בלט וכדומה → «שיעורי» + שם; כוח/TRX/קרוספיט/HIIT/ריצה/פונקציונלי וכדומה → «אימוני» + שם; ברירת מחדל — «אימוני» + שם.
- כללי הם/היא: ברירת מחדל «הם»; «היא» רק לשם נקבה יחיד מובהק שאין לו ריבוי טבעי בהקשר (דוגמה: זומבה כשם בודד).
- מציין מסלול (הנחיה בלבד, לא טקסט ללקוח): ${c.after_service_pick}

סשן חימום (מומלץ לא יותר מ־1–3 שאלות בסך הכול כולל שאלה ראשונה; בסיום סשן החימום עברי לפי המערכת להנעה לפעולה):
- לאחר בחירת שירות מהלקוח — השתמשי רק בבלוק החימום המתאים ל**סוג ההצעה** של אותו שירות (שיעור ניסיון / סדנה / קורס).

— כשנבחר שירות «שיעור ניסיון»:
  שאלה: ${c.experience_question}
  אפשרויות: ${c.experience_options.join(" | ")}
  מענה אחרי בחירה: ${c.after_experience}
${formatExtraSteps("שאלות נוספות בסשן חימום — שיעור ניסיון (לפני ההנעה לפעולה)", c.opening_extra_steps)}

— כשנבחר שירות «סדנה»:
  שאלה: ${resolveWarmupExperienceConfig(c, "workshop").question}
  אפשרויות: ${resolveWarmupExperienceConfig(c, "workshop").options.join(" | ")}
  מענה אחרי בחירה: ${resolveWarmupExperienceConfig(c, "workshop").afterExperienceRaw}
${formatExtraSteps(
    "שאלות נוספות בסשן חימום — סדנה (לפני ההנעה לפעולה)",
    resolveWarmupExperienceConfig(c, "workshop").extras
  )}

— כשנבחר שירות «קורס»:
  שאלה: ${resolveWarmupExperienceConfig(c, "course").question}
  אפשרויות: ${resolveWarmupExperienceConfig(c, "course").options.join(" | ")}
  מענה אחרי בחירה: ${resolveWarmupExperienceConfig(c, "course").afterExperienceRaw}
${formatExtraSteps(
    "שאלות נוספות בסשן חימום — קורס (לפני ההנעה לפעולה)",
    resolveWarmupExperienceConfig(c, "course").extras
  )}

שלב הנעה לפעולה — שירות «אימון ניסיון» (סוג trial בלבד):
גוף הודעה מוצע (אחרי שאלת ניסיון קודם): ${c.cta_body}
- אם מופיעים ב־CTA המציינים {priceText} / {durationText} - מלאי אותם מהמחיר/משך של **אותו** שירות (של שיעור הניסיון) בטאב «אימון ניסיון». אם חסר נתון, נסחי טבעי בלי להמציא.
כפתורי פעולה (הציגי כשורות ממוספרות; קישורים אמיתיים רק אם מופיעים בידע):
${ctaDesc}
אחרי שלקוח לחץ על קישור (הרשמה / מערכת שעות / מנויים), המערכת שולחת הודעת המשך אוטומטית:
${c.followup_after_next_class_body}
עם שלוש אפשרויות: ${c.followup_after_next_class_options.join(" | ")}

אחרי הרשמה לשיעור ניסיון (כשהלקוח השלים תשלום/הרשמה לאימון ניסיון):
- שלחי הודעה לפי התבנית והרוח למטה. התאימי ניסוח לסגנון הדיבור; אל תשאירי סוגריים או הערות טכניות בטקסט ללקוח.
- יום ושעה: אם ידועים מהשיחה או מהמידע העסקי - אפשר לציין בקצרה; אם אין - בלי להמציא.
- כתובת: מלאי משדה הכתובת בבלוק «ידע עסקי» (כפי בתבנית «זה קורה בכתובת» / ניסוח דומה).
- הגעה: מלאי מ«הנחיות הגעה» בבלוק «ידע עסקי»; אם ריק - השמיטי את בלוק ההגעה או צייני בקצרה שאין הנחיות.
- אם בתבנית מופיע שורה על אינסטגרם «בינתיים» וכתובת URL בשורה נפרדת - שלחי את המשפט ואז בשורה הבאה בדיוק את ה־URL (קישור לחיץ בווטסאפ). אם אין בתבנית בלוק כזה - אל תוסיפי.
תבנית והנחיות ממסלול המכירה:
${afterTrialRegistrationExpanded || "(אין תבנית - שלחי הודעת חיזוק קצרה והמשיכי בפלואו)"}

אימוני ניסיון ותיאור קצר אחרי בחירה (ממסלול המכירה):
${benefitLines || "  (אין אימונים מוגדרים)"}
`.trim();
}
