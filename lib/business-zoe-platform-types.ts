/** קטגוריות הנחיות פלטפורמה לזואי של בעלי עסקים (לא זואי שיווק אדמין). */
export type ZoePlatformCategory = {
  id: string;
  title: string;
  description: string;
  lines: string[];
};

export type ZoePlatformGuidelines = {
  categories: ZoePlatformCategory[];
};
