/** פולואפ 2 ו־3 נשלחים עם כפתור — מגבלת גוף אינטראקטיבי של מטא. */
export const MARKETING_FOLLOWUP_BUTTON_TEXT_MAX = 1024;
export const MARKETING_FOLLOWUP_PLAIN_TEXT_MAX = 4096;
export const MARKETING_FOLLOWUP_DELAY_MIN_MINUTES = 1;
/** שבוע — תקרה כדי שלא יישמר עיכוב לא סביר. */
export const MARKETING_FOLLOWUP_DELAY_MAX_MINUTES = 7 * 24 * 60;

export type MarketingFollowupStageConfig = {
  delayMinutes: number;
  text: string;
  enabled: boolean;
};

export type MarketingFollowupConfig = {
  stages: [MarketingFollowupStageConfig, MarketingFollowupStageConfig, MarketingFollowupStageConfig];
};

export const MARKETING_FOLLOWUP_1_TEXT =
  "היי, ראיתי שעצרנו באמצע 😊\nיש משהו שעוד לא ברור?\nאני כאן לכל שאלה 🙌";

/** בלי קישור wa.me לליד — כפתור «נציג אנושי» מפעיל template לבעלים + הודעה לליד */
export const MARKETING_FOLLOWUP_2_TEXT =
  "היי שוב! זואי כאן 😊\nאני מזכירה שאפשר לכתוב לי כל שאלה ואענה.\nבמידה ולא קיבלת מענה מספק ממני, אני לא נעלבת — אחרי הכל אני בוט בלי מערכת רגשות 😊\nרוצים נציג אנושי? לחצו על הכפתור למטה.";

export const MARKETING_FOLLOWUP_3_TEXT =
  "היי! זו הודעה אחרונה לפני שאני מניחה לך.\nשוב — אני כאן לכל שאלה או חשש.\nרוצים לדבר עם נציג? לחצו «נציג אנושי» למטה.";

export const DEFAULT_MARKETING_FOLLOWUP_CONFIG: MarketingFollowupConfig = {
  stages: [
    { delayMinutes: 10, text: MARKETING_FOLLOWUP_1_TEXT, enabled: true },
    { delayMinutes: 2 * 60, text: MARKETING_FOLLOWUP_2_TEXT, enabled: true },
    { delayMinutes: 23 * 60, text: MARKETING_FOLLOWUP_3_TEXT, enabled: true },
  ],
};

export type MarketingFollowupValidation =
  | { ok: true; config: MarketingFollowupConfig }
  | { ok: false; error: string };

function textMaxForStage(stage: 1 | 2 | 3): number {
  return stage === 1 ? MARKETING_FOLLOWUP_PLAIN_TEXT_MAX : MARKETING_FOLLOWUP_BUTTON_TEXT_MAX;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/**
 * מאמת שלושה פולואפים: עיכובים עולים, טקסט בתוך מגבלת וואטסאפ.
 * שלבים 2–3 חייבים להישאר מתחת ל־1024 תווים כי הם נשלחים עם כפתור.
 */
export function validateMarketingFollowupConfig(raw: unknown): MarketingFollowupValidation {
  const root = asRecord(raw);
  const stagesRaw = root && Array.isArray(root.stages) ? root.stages : null;
  if (!stagesRaw || stagesRaw.length !== 3) {
    return { ok: false, error: "נדרשים בדיוק שלושה פולואפים." };
  }

  const stages: MarketingFollowupStageConfig[] = [];
  for (let i = 0; i < 3; i += 1) {
    const stageNo = (i + 1) as 1 | 2 | 3;
    const row = asRecord(stagesRaw[i]);
    if (!row) return { ok: false, error: `פולואפ ${stageNo} לא תקין.` };

    const delayMinutes = Number(row.delay_minutes);
    if (!Number.isInteger(delayMinutes)) {
      return { ok: false, error: `פולואפ ${stageNo}: הזמן חייב להיות מספר שלם של דקות.` };
    }
    if (
      delayMinutes < MARKETING_FOLLOWUP_DELAY_MIN_MINUTES ||
      delayMinutes > MARKETING_FOLLOWUP_DELAY_MAX_MINUTES
    ) {
      return {
        ok: false,
        error: `פולואפ ${stageNo}: הזמן חייב להיות בין דקה אחת לשבוע.`,
      };
    }

    const enabled = row.enabled !== false;
    const text = String(row.text ?? "").trim();
    const max = textMaxForStage(stageNo);
    if (enabled && !text) {
      return { ok: false, error: `פולואפ ${stageNo}: חסר טקסט.` };
    }
    if (text.length > max) {
      const why = stageNo === 1 ? "" : " (נשלח עם כפתור)";
      return { ok: false, error: `פולואפ ${stageNo}: הטקסט ארוך מ־${max} תווים${why}.` };
    }

    stages.push({ delayMinutes, text, enabled });
  }

  const [a, b, c] = stages as [
    MarketingFollowupStageConfig,
    MarketingFollowupStageConfig,
    MarketingFollowupStageConfig,
  ];
  if (!(a.delayMinutes < b.delayMinutes && b.delayMinutes < c.delayMinutes)) {
    return {
      ok: false,
      error: "הזמנים חייבים לעלות: פולואפ 1 לפני 2, ופולואפ 2 לפני 3.",
    };
  }

  return { ok: true, config: { stages: [a, b, c] } };
}

export function marketingFollowupConfigToJson(config: MarketingFollowupConfig): {
  stages: Array<{ delay_minutes: number; text: string; enabled: boolean }>;
} {
  return {
    stages: config.stages.map((s) => ({
      delay_minutes: s.delayMinutes,
      text: s.text,
      enabled: s.enabled,
    })),
  };
}

/** ריק או לא תקין → ברירת המחדל שבקוד (10 דק׳ / שעתיים / 23 שעות). */
export function resolveMarketingFollowupConfig(raw: unknown): {
  config: MarketingFollowupConfig;
  usingDefaults: boolean;
} {
  const root = asRecord(raw);
  const stages = root && Array.isArray(root.stages) ? root.stages : null;
  if (!stages || stages.length === 0) {
    return { config: DEFAULT_MARKETING_FOLLOWUP_CONFIG, usingDefaults: true };
  }
  const validated = validateMarketingFollowupConfig(raw);
  if (!validated.ok) {
    console.error("[marketing-followups] stored config invalid — using defaults:", validated.error);
    return { config: DEFAULT_MARKETING_FOLLOWUP_CONFIG, usingDefaults: true };
  }
  return { config: validated.config, usingDefaults: false };
}

export function marketingFollowupDelaysMs(config: MarketingFollowupConfig): [number, number, number] {
  return [
    config.stages[0].delayMinutes * 60_000,
    config.stages[1].delayMinutes * 60_000,
    config.stages[2].delayMinutes * 60_000,
  ];
}

export function marketingFollowupEnabled(config: MarketingFollowupConfig): [boolean, boolean, boolean] {
  return [config.stages[0].enabled, config.stages[1].enabled, config.stages[2].enabled];
}
