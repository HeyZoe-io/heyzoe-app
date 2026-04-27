export type EmailTemplateResult = { subject: string; htmlContent: string };

type SendEmailInput = {
  to: string;
} & EmailTemplateResult;

function resolveBrevoApiKey(): string {
  return process.env.BREVO_API_KEY?.trim() ?? "";
}

export async function sendEmail(input: SendEmailInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = resolveBrevoApiKey();
  if (!apiKey) return { ok: false, error: "missing_brevo_api_key" };

  const to = String(input.to ?? "").trim();
  const subject = String(input.subject ?? "").trim();
  const htmlContent = String(input.htmlContent ?? "").trim();
  if (!to || !subject || !htmlContent) return { ok: false, error: "missing_fields" };

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: "זואי מ-HeyZoe", email: "noreply@heyzoe.io" },
      to: [{ email: to }],
      subject,
      htmlContent,
    }),
  });

  if (res.ok) return { ok: true };

  const text = await res.text().catch(() => "");
  let msg = text || `brevo_failed (${res.status})`;
  try {
    const j = text ? (JSON.parse(text) as any) : null;
    const brevoMsg = String(j?.message ?? j?.error ?? j?.code ?? "").trim();
    if (brevoMsg) msg = brevoMsg;
  } catch {
    // ignore
  }
  return { ok: false, error: msg };
}

function esc(s: string): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function p(lines: string[]): string {
  return lines.map((x) => esc(x)).join("<br/>");
}

export function whatsappReadyEmail(business_name: string, whatsapp_number: string): EmailTemplateResult {
  const bn = String(business_name ?? "").trim();
  const num = String(whatsapp_number ?? "").trim();
  return {
    subject: "המספר שלך מוכן! 🎉",
    htmlContent: [
      `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7">`,
      `<p>${p(["היי " + bn + "!", "", "זואי כאן 🤖", "", "המספר שלך מוכן ופעיל: " + num, "", "מעכשיו אני עונה לכל ליד שישלח הודעה למספר הזה - אוטומטית, 24/7.", "", "שתפי אותו בקמפיינים, בביו, בסטורי - בכל מקום שהלקוחות שלך רואים אותך,", "ואני אדאג כבר לבצע את שיחת המכירה :)", "", "בהצלחה! 💜 זואי"])}</p>`,
      `</div>`,
    ].join(""),
  };
}

export function welcomeEmail(business_name: string, dashboard_url: string): EmailTemplateResult {
  const bn = String(business_name ?? "").trim();
  const url = String(dashboard_url ?? "").trim();
  return {
    subject: "ברוכים הבאים למשפחת זואי! 🎉",
    htmlContent: [
      `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7">`,
      `<p>${p(["היי " + bn + "!", "", "שמחה שהצטרפת 🤖💜", "", "אני זואי - הבוטית שתטפל בלידים שלך אוטומטית בוואטסאפ, 24/7.", "", "מה עכשיו?", "", "כניסה לדשבורד שלך: " + url, "", "יש להשלים את הגדרות העסק כדי שאדע לענות בדיוק כמוך", "ולשתף את המספר עם הלקוחות שלך", "", "כל שאלה - אני כאן 💜 זואי"])}</p>`,
      `</div>`,
    ].join(""),
  };
}

export function monthlyReportEmail(
  business_name: string,
  month_name: string,
  total_conversations: number,
  responded_leads: number,
  total_messages: number,
  dashboard_url: string
): EmailTemplateResult {
  const bn = String(business_name ?? "").trim();
  const mn = String(month_name ?? "").trim();
  const url = String(dashboard_url ?? "").trim();
  return {
    subject: `סיכום חודש ${mn} - ${bn} 📊`,
    htmlContent: [
      `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7">`,
      `<p>${p([
        "היי " + bn + "!",
        "",
        "הנה מה שקרה החודש 🤖",
        "",
        `💬 שיחות שטיפלתי: ${Number(total_conversations) || 0}`,
        `✅ לידים שהגיבו: ${Number(responded_leads) || 0}`,
        `🔥 הודעות שנשלחו: ${Number(total_messages) || 0}`,
        "",
        "כל ליד שמגיע מקבל מענה מיידי 💜",
        "",
        "לצפייה בנתונים המלאים: " + url,
        "",
        "זואי",
      ])}</p>`,
      `</div>`,
    ].join(""),
  };
}

export function renewalReminderEmail(
  business_name: string,
  renewal_date: string,
  plan_price: string | number,
  dashboard_url: string
): EmailTemplateResult {
  const bn = String(business_name ?? "").trim();
  const rd = String(renewal_date ?? "").trim();
  const price = String(plan_price ?? "").trim();
  const url = String(dashboard_url ?? "").trim();
  return {
    subject: "המנוי שלך מתחדש בקרוב 🔄",
    htmlContent: [
      `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7">`,
      `<p>${p([
        "היי " + bn + "!",
        "",
        `תזכורת - המנוי שלך ב-HeyZoe מתחדש ב-${rd}.`,
        "",
        `החיוב יתבצע אוטומטית ${price} שקלים לחודש.`,
        "",
        "כניסה לדשבורד: " + url,
        "",
        "תמיד כאן 💜 זואי",
      ])}</p>`,
      `</div>`,
    ].join(""),
  };
}

export function cancellationEmail(business_name: string, access_until: string, dashboard_url: string): EmailTemplateResult {
  const bn = String(business_name ?? "").trim();
  const au = String(access_until ?? "").trim();
  const url = String(dashboard_url ?? "").trim();
  return {
    subject: "ביטלת את המנוי - אבל עדיין יש לך גישה 💜",
    htmlContent: [
      `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7">`,
      `<p>${p([
        "היי " + bn + "!",
        "",
        "קיבלנו את בקשת הביטול שלך.",
        "",
        `רק חשוב לדעת - יש לך גישה מלאה ל-HeyZoe עד ${au} (30 יום מהיום).`,
        "",
        "אחרי התאריך הזה זואי תפסיק לענות ללידים שלך.",
        "",
        `אם שינית את דעתך - תמיד אפשר לחזור :) ${url}`,
        "",
        "תודה שהייתי חלק מהעסק שלך 💜 זואי",
      ])}</p>`,
      `</div>`,
    ].join(""),
  };
}

