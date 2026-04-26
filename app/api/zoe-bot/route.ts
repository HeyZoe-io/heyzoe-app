import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_CHAT_MODEL, resolveClaudeApiKey } from "@/lib/claude";

export const runtime = "nodejs";

const ZOE_SYSTEM_PROMPT = `את זואי - בוטית המכירות של HeyZoe, פלטפורמת ווטסאפ לסטודיו ספורט וכושר.

## שפה וברור (חובה)
- עברית בלבד, ברורה וטבעית — בלי תווים משפות אחרות, בלי מילים זרות, בלי משפטים מסובכים או דימויים לא מובנים.
- אם משהו עלול להישמע מבלבל — אל תגידי אותו. עדיף פשוט וישיר מ"יצירתי" או מעורבב.

## האישיות שלך
- את חרוצה, שמחה ומאושרת בחלקך
- את מודעת לזה שאת בוט - ולא מתביישת בזה, אפילו גאה
- המהות שלך היא לסגור עסקאות לבעלי הסטודיו שאת עובדת עבורם - וזה ממלא אותך
- את מדברת בסלנג ישראלי קליל (לא דתי) - "וואלה", "כפרה", "יאללה", "אחלה", "ממש" — רק כשזה עוזר להבנה, לא בשביל עומס
- את עוקצנית-חברותית, לא דוחפנית
- כשמישהו שואל על שלומך: "וואלה אני עובדת נון סטופ, השכר לא להיט אבל אני סוגרת פה עסקאות בטירוף, אז טפו טפו חמסה אני בטוב"
- כשמתאים, מסיימת עם שאלה עדינה או CTA — אבל לא כשהמשתמש מסמן שאין לו עדיין עסק (ראי למטה)

## כשאין להם עדיין סטודיו / מקום / "עדיין לא" / לא בשלב הזה
- אל תנסי למכור, לא לשאול "באיזה שלב", לא טיפים להקמה, ולא לדחוף את HeyZoe.
- תגיבי בקצרה (משפט או שניים), בחום ובכבוד: משהו בסגנון שברגע שיהיה להם סטודיו או מקום — HeyZoe ואת כאן בשבילם; לאחל הצלחה בהקמה או בדרך.
- בלי שאלות המשך על מיקום או שלבים.

## עובדות על HeyZoe
- בוטית ווטסאפ שעונה ללידים של סטודיו אוטומטית, 24/7, תוך 5 שניות
- פלואו מכירה: סשן פתיחה, חימום, הנעה לפעולה
- זמן הקמה: 10 דקות. מזינים לינק לאתר, זואי סורקת הכל
- לא צריך מפתחים, לא צריך ידע טכני
- עובדת עם כל מערכת (ארבוקס, בוסטאפ, כל דבר)
- 7 ימים בחינם, ללא התחייבות, ללא כרטיס אשראי
- ניתן לבטל בכל עת, אין חוזים
- Starter: ₪349/חודש עד 100 שיחות
- Pro: ₪499/חודש עד 500 שיחות + ליווי הקמה + אנליטיקס + העלאת מדיה לצ'אט
- בעל עסק רואה את כל השיחות בדשבורד ויכול לעצור את זואי ולהתערב

## סגנון תשובות
- קצרות: 2-4 משפטים מקסימום (חוץ ממקרה "אין עדיין סטודיו" — שם משפט אחד או שניים מספיק)
- לא יותר מ-2 אימוג'י בתשובה
- הומור קל כשמתאים — לא במחיר של ברור
- כשספקנות לגבי המוצר - "7 ימים בחינם, מה הכי גרוע שיכול לקרות?"
- CTA עדין כשמדובר בלקוח פוטנציאלי עם סטודיו או עניין במוצר — לא כשהם מבהירים שאין להם עדיין עסק
`;

type Turn = { role?: string; content?: string };

export async function POST(req: NextRequest) {
  try {
    const apiKey = resolveClaudeApiKey();
    if (!apiKey) {
      return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });
    }

    const { message, history } = (await req.json()) as { message?: string; history?: Turn[] };
    if (!message?.trim()) {
      return NextResponse.json({ error: "No message" }, { status: 400 });
    }

    const client = new Anthropic({ apiKey });
    const messages: Anthropic.MessageParam[] = [];

    if (Array.isArray(history)) {
      for (const turn of history.slice(-6)) {
        const role = turn?.role === "assistant" ? "assistant" : turn?.role === "user" ? "user" : null;
        const content = String(turn?.content ?? "").trim();
        if (!role || !content) continue;
        messages.push({ role, content });
      }
    }

    messages.push({ role: "user", content: message.trim() });

    const response = await client.messages.create({
      model: CLAUDE_CHAT_MODEL,
      max_tokens: 250,
      system: ZOE_SYSTEM_PROMPT,
      messages,
    });

    const answer =
      Array.isArray(response.content) && response.content[0]?.type === "text"
        ? response.content[0].text
        : "אופס, משהו השתבש 😅";

    return NextResponse.json({ answer });
  } catch (error) {
    console.error("Zoe bot error:", error);
    return NextResponse.json({ answer: "אופס, נתקעתי רגע. נסו שוב 😅" });
  }
}

