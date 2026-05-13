/**
 * שאלות מוצעות לפי פערים בטקסט (מאפיינים, כתובת, שירותים וכו׳) — משותף לדשבורד בעל עסק ולפלואו שיווקי באדמין.
 */

export type FactQuestion = { id: string; question: string; placeholder: string; kind: string };

export function buildFactQuestions(input: {
  traits: string[];
  directionsText: string;
  promotionsText: string;
  servicesText: string;
  addressText: string;
}): FactQuestion[] {
  const text = `${input.traits.join("\n")}\n${input.directionsText}\n${input.promotionsText}\n${input.servicesText}\n${input.addressText}`.toLowerCase();
  const out: { id: string; question: string; placeholder: string; kind: string; test: () => boolean }[] = [
    {
      id: "audience_age",
      kind: "audience_age",
      question: "לאילו גילאים זה מתאים?",
      placeholder: "למשל: מגיל 18 ומעלה / 16+ / ילדים 8–12",
      test: () => !/(גיל|ילדים|נוער|מבוגרים|\d{1,2}\s*\+|\d{1,2}\s*-\s*\d{1,2})/u.test(text),
    },
    {
      id: "audience_level",
      kind: "audience_level",
      question: "זה מתאים למתחילים?",
      placeholder: "למשל: כן, יש קבוצת מתחילים / צריך ניסיון קודם",
      test: () => !/(מתחילים|מתקדמים|רמות|לכל הרמות|beginner|advanced)/u.test(text),
    },
    {
      id: "fitness_level",
      kind: "fitness_level",
      question: "זה מתאים לכל רמת כושר?",
      placeholder: "למשל: כן, מתחילים בקצב אישי / נדרש בסיס מסוים",
      test: () => !/(רמת כושר|כושר|כושר גופני|לכל רמת כושר|מתאים לכל כושר)/u.test(text),
    },
    {
      id: "parking",
      kind: "parking",
      question: "יש חניה או הנחיות הגעה מיוחדות?",
      placeholder: "למשל: חניה בכחול לבן / חניון קרוב / קומה 2",
      test: () =>
        !input.directionsText.trim() && !/(חניה|חנייה|חניון|parking|park|איך מגיעים|הנחיות הגעה)/u.test(text),
    },
    {
      id: "parking_nearby",
      kind: "parking_nearby",
      question: "יש חניה קרובה?",
      placeholder: "למשל: יש חניון במרחק 2 דקות / כחול-לבן מסביב",
      test: () => !/(חניה|חנייה|חניון|parking|park)/u.test(text),
    },
    {
      id: "showers",
      kind: "showers",
      question: "יש מקלחות וחדרי הלבשה?",
      placeholder: "למשל: כן, יש מקלחות ולוקרים",
      test: () => !/(מקלחות|מקלחת|חדרי הלבשה|לוקר|locker|החלפה)/u.test(text),
    },
    {
      id: "class_size",
      kind: "class_size",
      question: "כמה אנשים יש באימון?",
      placeholder: "למשל: עד 12 משתתפים באימון",
      test: () =>
        !/(כמה אנשים|מספר משתתפים|עד \d+|קבוצה של|בקבוצה|משתתפים|אינטימי|קבוצות קטנות)/u.test(text),
    },
    {
      id: "pregnancy",
      kind: "pregnancy",
      question: "האם זה מתאים לנשים בהיריון?",
      placeholder: "למשל: כן, בתיאום מראש / מומלץ להתייעץ עם רופא",
      test: () => !/(היריון|הריון|בהיריון|בהריון|pregnan)/u.test(text),
    },
    {
      id: "what_to_bring",
      kind: "what_to_bring",
      question: "מה כדאי להביא / ללבוש לשיעור?",
      placeholder: "למשל: בגדי ספורט נוחים + בקבוק מים",
      test: () => !/(מה ללבוש|להביא|בגד|בגדים|נעליים|גרביים|מגבת|מים)/u.test(text),
    },
    {
      id: "equipment",
      kind: "equipment",
      question: "צריך להביא ציוד או שהכל מחכה בסטודיו?",
      placeholder: "למשל: לא צריך להביא כלום / רק מגבת אישית",
      test: () => !/(ציוד|מזרן|מזרונים|הכל מחכה|לא צריך להביא|אביזרים)/u.test(text),
    },
    {
      id: "language",
      kind: "language",
      question: "באיזו שפה האימון מתנהל?",
      placeholder: "למשל: עברית / אנגלית / גם וגם",
      test: () => !/(עברית|אנגלית|שפה|english)/u.test(text),
    },
    {
      id: "injuries",
      kind: "injuries",
      question: "האם מתאים לאנשים עם פציעות? (ניתן לפרט)",
      placeholder: "למשל: כן, בתיאום מראש / יש התאמות אישיות",
      test: () => !/(פציע|פגיע|שיקום|מגבל|מגבלה|כאב גב|כאבי גב|בריאותי|injuries|injury)/u.test(text),
    },
    {
      id: "cancellation",
      kind: "cancellation",
      question: "מה מדיניות הביטול או ההקפאה?",
      placeholder: "למשל: עד 12 שעות לפני ללא חיוב",
      test: () => !/(מדיניות ביטול|ביטול|הקפאה|דמי ביטול|החזר)/u.test(text),
    },
  ];
  return out.filter((x) => x.test()).map(({ test: _t, ...rest }) => rest);
}

export function factFromQuestionAnswer(question: string, answer: string): string {
  const q = String(question ?? "").trim().replace(/\?+$/, "?");
  const a = String(answer ?? "").trim();
  if (!a) return q;
  const normalizedQ = q.replace(/\?+$/, "").trim();
  const m = normalizedQ.match(/^יש\s+(.+)$/u);
  if (m?.[1]) return `${m[1].trim()}: ${a}`;
  return `${q} ${a}`;
}
