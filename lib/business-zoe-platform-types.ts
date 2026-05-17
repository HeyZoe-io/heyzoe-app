/** תת-סעיף בתוך קטגוריה מרוכזת (למשל «מבנה תשובה — וואטסאפ») */
export type ZoePlatformSection = {
  /** מזהה פנימי לקוד (למשל response_wa) — לא לערוך בממשק */
  key: string;
  label: string;
  hint?: string;
  lines: string[];
};

/** קטגוריות הנחיות פלטפורמה לזואי של בעלי עסקים (לא זואי שיווק אדמין). */
export type ZoePlatformCategory = {
  id: string;
  title: string;
  description: string;
  /** שורות ישירות (למשל תגיות ויב) */
  lines: string[];
  /** תת-סעיפים — למשל «איך לענות» עם אתר / וואטסאפ */
  sections?: ZoePlatformSection[];
};

export type ZoePlatformGuidelines = {
  categories: ZoePlatformCategory[];
};
