import { formatDailySummaryLeadListLine } from "@/lib/notifications/daily-summary-data";

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

/** DD/MM/YYYY */
export function formatDateDdMmYyyy(isoOrDate: Date | string): string {
  try {
    const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
    if (Number.isNaN(d.getTime())) return String(isoOrDate);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  } catch {
    return String(isoOrDate ?? "");
  }
}

/** אחרי לחיצת «אשר ביטול» — גישה עד תאריך */
export function cancellationRequestReceivedEmail(customer_name: string, access_until_dd_mm_yyyy: string): EmailTemplateResult {
  const name = String(customer_name ?? "").trim();
  const until = String(access_until_dd_mm_yyyy ?? "").trim();
  return {
    subject: "בקשת הביטול שלך התקבלה",
    htmlContent: [
      `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7">`,
      `<p>${p([
        "שלום " + name + ",",
        "",
        "בקשת הביטול שלך התקבלה.",
        "",
        "הגישה שלך ל-HeyZoe תישאר פעילה עד " + until + ".",
        "",
        "לכל שאלה: office@heyzoe.io",
        "",
        "צוות HeyZoe",
      ])}</p>`,
      `</div>`,
    ].join(""),
  };
}

/** Cron סגירת גישה — סיום תוקף */
export function subscriptionAccessEndedEmail(customer_name: string): EmailTemplateResult {
  const name = String(customer_name ?? "").trim();
  return {
    subject: "גישתך ל-HeyZoe הסתיימה",
    htmlContent: [
      `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7">`,
      `<p>${p([
        "שלום " + name + ",",
        "",
        "גישתך ל-HeyZoe הסתיימה היום.",
        "",
        "תודה שהיית איתנו — נשמח לראותך שוב בעתיד.",
        "",
        "לכל שאלה: office@heyzoe.io",
        "",
        "צוות HeyZoe",
      ])}</p>`,
      `</div>`,
    ].join(""),
  };
}

export function adminPlainAlertEmail(title: string, lines: string[]): EmailTemplateResult {
  return {
    subject: title,
    htmlContent: [
      `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7">`,
      `<p>${p(lines)}</p>`,
      `</div>`,
    ].join(""),
  };
}

function quotaUpgradeToProButtonHtml(billingUrl: string): string {
  const href = esc(billingUrl);
  return `<p style="margin:20px 0"><a href="${href}" style="display:inline-block;background:#7133da;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:600;font-family:Heebo,Arial,sans-serif">שדרג ל‑Pro</a></p>`;
}

/** Starter ~80 שיחות — נותרו 20 */
export function starterQuota80Email(displayName: string, billingUrl: string): EmailTemplateResult {
  const name = String(displayName ?? "").trim() || "שם";
  return {
    subject: "זואי ניצלה 80 שיחות מתוך 100 החודש",
    htmlContent: [
      `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7">`,
      `<p>${p([
        "שלום " + name + ",",
        "",
        "השתמשת ב-80 שיחות מתוך 100 הכלולות בחבילת Starter שלך החודש.",
        "נותרו לך 20 שיחות נוספות.",
        "",
        "כדי להבטיח שזואי תמשיך לענות ללידים שלך ללא הפרעה, מומלץ לשדרג לחבילת Pro עכשיו.",
      ])}</p>`,
      quotaUpgradeToProButtonHtml(billingUrl),
      `<p>${p(["", "צוות HeyZoe"])}</p>`,
      `</div>`,
    ].join(""),
  };
}

/** Starter ~95 שיחות — נותרו 5 */
export function starterQuota95Email(displayName: string, billingUrl: string): EmailTemplateResult {
  const name = String(displayName ?? "").trim() || "שם";
  return {
    subject: "⚠️ זואי עומדת להפסיק לענות — נותרו 5 שיחות בלבד",
    htmlContent: [
      `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7">`,
      `<p>${p([
        "שלום " + name + ",",
        "",
        "נותרו לך רק 5 שיחות מתוך 100 הכלולות בחבילת Starter שלך החודש.",
        "כשתגיע למכסה — זואי תפסיק לענות ותפנה לידים לשירות הלקוחות שלך.",
        "",
        "שדרג עכשיו כדי לא לפספס לידים.",
      ])}</p>`,
      quotaUpgradeToProButtonHtml(billingUrl),
      `<p>${p(["", "צוות HeyZoe"])}</p>`,
      `</div>`,
    ].join(""),
  };
}

/** Starter מגיע ל-100 שיחות */
export function starterQuota100Email(displayName: string, billingUrl: string): EmailTemplateResult {
  const name = String(displayName ?? "").trim() || "שם";
  return {
    subject: "❌ זואי הפסיקה לענות — המכסה החודשית הסתיימה",
    htmlContent: [
      `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7">`,
      `<p>${p([
        "שלום " + name + ",",
        "",
        "הגעת למכסה של 100 שיחות החודש.",
        "זואי מפנה כעת לידים חדשים לשירות הלקוחות שלך ולא תענה לפניות נוספות עד תחילת החודש הבא.",
        "",
        "שדרג לחבילת Pro וקבל עד 500 שיחות בחודש.",
      ])}</p>`,
      quotaUpgradeToProButtonHtml(billingUrl),
      `<p>${p(["", "צוות HeyZoe"])}</p>`,
      `</div>`,
    ].join(""),
  };
}

/** פנימי — Pro מתקרב למכסה (450) */
export function proQuota450OpsEmail(businessName: string, businessSlug: string, monthlyCount: number): EmailTemplateResult {
  const bn = String(businessName ?? "").trim() || businessSlug;
  const slug = String(businessSlug ?? "").trim();
  return {
    subject: "התראה: לקוח Pro מתקרב למכסה — " + bn,
    htmlContent: [
      `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7">`,
      `<p>${p([
        "לקוח " + bn + " (" + slug + ") הגיע ל-" + String(monthlyCount) + " שיחות החודש מתוך 500.",
        "",
        "אין חסימה ללקוח — יש לשקול הוספת חבילה.",
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

export type LeadRegisteredOwnerEmailInput = {
  business_name: string;
  lead_phone: string;
  service_name?: string;
  schedule?: string;
  registered_at: string;
  warmup_session?: string;
};

function optionalBodyLines(entries: Array<[string, string | undefined]>): string[] {
  const out: string[] = [];
  for (const [label, value] of entries) {
    const v = String(value ?? "").trim();
    if (v) out.push(`${label}: ${v}`);
  }
  return out;
}

export function leadRegisteredOwnerEmail(input: LeadRegisteredOwnerEmailInput): EmailTemplateResult {
  const bn = String(input.business_name ?? "").trim() || "העסק שלך";
  const phone = String(input.lead_phone ?? "").trim() || "—";
  const registeredAt = String(input.registered_at ?? "").trim();
  const schedule = String(input.schedule ?? "").trim();
  const withSchedule = Boolean(schedule);
  return {
    subject: `ליד נרשם — ${bn}`,
    htmlContent: [
      `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7;text-align:right">`,
      `<p>${p([
        "היי " + bn + ",",
        "",
        withSchedule
          ? `הליד ${phone} נרשם לשיעור ניסיון.`
          : `הליד ${phone} ביצע הרשמה בשיחה עם זואי.`,
        ...optionalBodyLines([
          ["אימון", input.service_name],
          ["מועד", schedule],
          ["תאריך הרשמה", registeredAt],
          ["סשן חימום", input.warmup_session],
        ]),
        "",
        "מזל טוב!",
        "",
        "ניתן לצפות בשיחה בדשבורד.",
        "",
        "צוות HeyZoe",
      ])}</p>`,
      `</div>`,
    ].join(""),
  };
}

export function humanRequestedOwnerEmail(input: {
  business_name: string;
  lead_phone: string;
  requested_at: string;
}): EmailTemplateResult {
  const bn = String(input.business_name ?? "").trim() || "העסק שלך";
  const phone = String(input.lead_phone ?? "").trim() || "—";
  const at = String(input.requested_at ?? "").trim();
  return {
    subject: `נדרש מענה אנושי — ${bn}`,
    htmlContent: [
      `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7;text-align:right">`,
      `<p>${p([
        "היי " + bn + ",",
        "",
        `הליד ${phone} ביקש לדבר עם נציג.`,
        ...(at ? ["בתאריך: " + at] : []),
        "",
        "ניתן לנהל את השיחה בדשבורד.",
        "",
        "צוות HeyZoe",
      ])}</p>`,
      `</div>`,
    ].join(""),
  };
}

export type DailySummaryIdleLead = { full_name: string | null; phone: string };

function formatIdleLeadName(lead: DailySummaryIdleLead): string {
  return String(lead.full_name ?? "").trim() || "ליד";
}

function formatIdleLeadPhone(lead: DailySummaryIdleLead): string {
  const raw = String(lead.phone ?? "").trim();
  if (!raw) return "—";
  const d = raw.replace(/\D/g, "");
  if (d.startsWith("972") && d.length >= 12) return `0${d.slice(3)}`;
  return raw;
}


export function dailySummaryOwnerEmail(input: {
  business_name: string;
  business_slug: string;
  date_label: string;
  conversations_held: number;
  registered_leads: DailySummaryIdleLead[];
  no_response_leads: DailySummaryIdleLead[];
  dashboard_url: string;
  no_response_window_hours?: number;
}): EmailTemplateResult {
  const bn = String(input.business_name ?? "").trim() || "העסק שלך";
  const dl = String(input.date_label ?? "").trim();
  const conversationsHeld = Math.max(0, Number(input.conversations_held) || 0);
  const registeredLeads = input.registered_leads ?? [];
  const noResponseLeads = input.no_response_leads ?? [];
  const dashboardUrl =
    String(input.dashboard_url ?? "").trim() ||
    (input.business_slug
      ? `https://heyzoe.io/${encodeURIComponent(String(input.business_slug).trim().toLowerCase())}/conversations`
      : "https://heyzoe.io");

  const statsBlock = [
    dl ? `סיכום יומי — ${dl}` : "סיכום יומי",
    `שיחות שהתקיימו: ${conversationsHeld}`,
    `נרשמו: ${formatDailySummaryLeadListLine(registeredLeads)}`,
    `ללא מענה: ${formatDailySummaryLeadListLine(noResponseLeads)}`,
  ];

  const hasNoResponse = noResponseLeads.length > 0;
  const idleHours = Number(input.no_response_window_hours) === 48 ? 48 : 24;

  return {
    subject: hasNoResponse ? `סיכום יומי — יש לידים ללא מענה — ${dl}` : `סיכום יומי — ${dl} — ${bn}`,
    htmlContent: [
      `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7;text-align:right;color:#18181b">`,
      `<p>היי ${esc(bn)},</p>`,
      `<p>${p(statsBlock)}</p>`,
      hasNoResponse
        ? `<p>לידים ללא מענה (${idleHours} שעות אחרונות) — סיימו פולואפים של זואי ועדיין לא חזרו.</p>`
        : `<p>אין כרגע לידים ללא מענה מ-${idleHours} השעות האחרונות.</p>`,
      hasNoResponse
        ? `<table dir="rtl" style="border-collapse:collapse;width:100%;max-width:620px;margin:12px 0;text-align:right">` +
          `<thead><tr><th style="padding:10px 12px;border-bottom:2px solid #ddd;text-align:right">שם</th><th style="padding:10px 12px;border-bottom:2px solid #ddd;text-align:right">טלפון</th></tr></thead>` +
          `<tbody>${noResponseLeads
            .map(
              (lead) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right">${esc(formatIdleLeadName(lead))}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right" dir="ltr">${esc(formatIdleLeadPhone(lead))}</td>
        </tr>`
            )
            .join("")}</tbody></table>`
        : "",
      `<p>לצפייה בשיחות בדשבורד:<br/>👉 <a href="${esc(dashboardUrl)}" style="color:#7133da;font-weight:700">לחץ כאן</a> → ${esc(dashboardUrl)}</p>`,
      `<p>צוות HeyZoe</p>`,
      `</div>`,
    ].join(""),
  };
}

