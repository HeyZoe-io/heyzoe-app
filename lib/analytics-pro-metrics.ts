/** מטריקות אנליטיקס פרימיום — נצרף ב־/api/analytics בלבד (אחרי אימות plan). */

import type { SupabaseClient } from "@supabase/supabase-js";

export type PremiumRangeKey = "month" | "week" | "all";

const IL_TZ = "Asia/Jerusalem";

export function premiumMessagesStartIso(range: PremiumRangeKey): string | null {
  const now = Date.now();
  if (range === "week") return new Date(now - 7 * 86400_000).toISOString();
  if (range === "month") return new Date(now - 31 * 86400_000).toISOString();
  return null;
}

export function contactsCreatedStartIsoForLeads(range: PremiumRangeKey): string | null {
  return premiumMessagesStartIso(range);
}

/** yyyy-mm-dd מתאריך ISO ביחס לשרת ישראל */
export function formatDateKeyIL(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

export function todayKeyIL(): string {
  return formatDateKeyIL(new Date().toISOString());
}

export function hourInIsrael(iso: string): number {
  const h =
    new Intl.DateTimeFormat("en-GB", {
      timeZone: IL_TZ,
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date(iso)).find((p) => p.type === "hour")?.value ?? "0";
  const n = Number(h);
  return Number.isFinite(n) ? Math.min(23, Math.max(0, n)) : 0;
}

/** לאחר pref wa_ מתו הראשון: <to>_השאר = from (למשל whatsapp:+972...) */
export function waSessionExtractFromParticipant(sessionId: string): string | null {
  if (!sessionId.startsWith("wa_")) return null;
  const rest = sessionId.slice(3);
  const i = rest.indexOf("_");
  if (i < 0 || i >= rest.length - 1) return null;
  return rest.slice(i + 1);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** מחרוזת yyyy-mm-dd — יום Gregorian פשוט (מספיק לעיבוי ציר מתאריך הטווח עד עכשיו) */
function nextGregorianDayKey(key: string): string {
  const [y, m, d] = key.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function enumerateDayAxis(fromKey: string, toKey: string, max = 410): string[] {
  const out: string[] = [];
  let k = fromKey;
  let guard = 0;
  while (k <= toKey && guard++ < max) {
    out.push(k);
    k = nextGregorianDayKey(k);
  }
  return out;
}

export type PremiumAnalyticsResult = {
  leadsByDay: { date: string; count: number }[];
  inboundMessagesByHour: number[];
  followupReturnCount: number;
  popularTrainings: { name: string; count: number }[];
};

function tsMax3(a: string | null | undefined, b: string | null | undefined, c: string | null | undefined): string | null {
  const xs = [a, b, c].filter(Boolean).map(String);
  if (!xs.length) return null;
  return xs.reduce((best, cur) => (cur > best ? cur : best), xs[0]!);
}

export async function computePremiumAnalytics(input: {
  admin: SupabaseClient;
  businessId: number;
  businessSlug: string;
  range: PremiumRangeKey;
}): Promise<PremiumAnalyticsResult> {
  const { admin, businessId, businessSlug, range } = input;
  const msgStartIso = premiumMessagesStartIso(range);
  const contactsStartIso = contactsCreatedStartIsoForLeads(range);
  const todayK = todayKeyIL();

  /** ── לידים לפי יום ── */
  const contactRows: { created_at: string }[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    let qc = admin.from("contacts").select("created_at").eq("business_id", businessId).order("created_at", {
      ascending: true,
    });
    if (contactsStartIso) qc = qc.gte("created_at", contactsStartIso);
    const { data, error } = await qc.range(off, off + PAGE - 1);
    if (error) {
      console.warn("[premium-analytics] contacts:", error.message);
      break;
    }
    const rows = data ?? [];
    contactRows.push(...rows);
    if (rows.length < PAGE) break;
    if (contactRows.length > 45_000) break;
  }

  const countsByDay = new Map<string, number>();
  let earliestLeadKey: string | null = null;
  for (const r of contactRows) {
    const at = String(r.created_at ?? "").trim();
    if (!at) continue;
    const k = formatDateKeyIL(at);
    countsByDay.set(k, (countsByDay.get(k) ?? 0) + 1);
    if (!earliestLeadKey || k < earliestLeadKey) earliestLeadKey = k;
  }

  let seriesFrom = earliestLeadKey ?? todayK;
  if (range !== "all" && contactsStartIso) {
    const gate = formatDateKeyIL(contactsStartIso);
    seriesFrom = seriesFrom < gate ? gate : seriesFrom;
  }
  if (seriesFrom > todayK) seriesFrom = todayK;

  /** «כולם»: אם הפער גדול, קצץ את הגיליון מתחילה */
  let dayKeys = enumerateDayAxis(seriesFrom, todayK, 410);
  if (dayKeys.length > 370 && earliestLeadKey) {
    /** קצץ ראש */
    dayKeys = dayKeys.slice(-370);
  }
  const leadsByDay = dayKeys.map((date) => ({ date, count: countsByDay.get(date) ?? 0 }));

  /** ── הודעות משתמש: שיא שעות + תוכן + מפת session→מועד הודעה אחרונה ── */
  const inboundMessagesByHour = Array.from({ length: 24 }, () => 0);
  const userContents: string[] = [];
  const lastUserMsgAtBySession = new Map<string, string>();

  for (let off = 0; ; off += PAGE) {
    let qm = admin
      .from("messages")
      .select("created_at, content, session_id")
      .eq("business_slug", businessSlug)
      .eq("role", "user")
      .order("created_at", { ascending: true });
    if (msgStartIso) qm = qm.gte("created_at", msgStartIso);
    const { data, error } = await qm.range(off, off + PAGE - 1);
    if (error) {
      console.warn("[premium-analytics] messages:", error.message);
      break;
    }
    const rows = data ?? [];
    for (const m of rows) {
      const at = String((m as any).created_at ?? "").trim();
      const content = String((m as any).content ?? "");
      const sid = String((m as any).session_id ?? "").trim();
      if (at) {
        inboundMessagesByHour[hourInIsrael(at)] += 1;
        const prev = lastUserMsgAtBySession.get(sid);
        if (!prev || at > prev) lastUserMsgAtBySession.set(sid, at);
      }
      userContents.push(content.normalize("NFC"));
    }
    if (rows.length < PAGE) break;
    if (userContents.length > 200_000) break;
  }

  /** ── חזרה אחרי פולואפ ── */
  const followContacts: {
    phone: string;
    wa_followup_1_sent_at: string | null;
    wa_followup_2_sent_at: string | null;
    wa_followup_3_sent_at: string | null;
  }[] = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await admin
      .from("contacts")
      .select("phone, wa_followup_1_sent_at, wa_followup_2_sent_at, wa_followup_3_sent_at")
      .eq("business_id", businessId)
      .range(off, off + PAGE - 1);
    if (error) break;
    const rows = data ?? [];
    followContacts.push(...(rows as typeof followContacts));
    if (rows.length < PAGE) break;
  }

  let followupReturnCount = 0;

  outer: for (const c of followContacts) {
    const phone = String(c.phone ?? "").trim();
    if (!phone) continue;
    const lastFu = tsMax3(c.wa_followup_1_sent_at, c.wa_followup_2_sent_at, c.wa_followup_3_sent_at);
    if (!lastFu) continue;
    if (msgStartIso && lastFu < msgStartIso) continue;

    for (const [sid, lastAt] of lastUserMsgAtBySession.entries()) {
      const fromSid = waSessionExtractFromParticipant(sid);
      if (fromSid !== phone) continue;
      if (lastAt > lastFu) {
        followupReturnCount += 1;
        continue outer;
      }
    }
  }

  /** ── אימונים פופולריים ── */
  const names: string[] = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await admin.from("services").select("name").eq("business_id", businessId).range(off, off + PAGE - 1);
    if (error) break;
    const rows = data ?? [];
    for (const s of rows) {
      const n = String((s as any).name ?? "").trim();
      if (n) names.push(n);
    }
    if (rows.length < PAGE) break;
  }

  const pop = new Map<string, number>();
  for (const n of names) pop.set(n, 0);

  if (names.length) {
    const ordered = [...names].sort((a, b) => b.length - a.length);
    for (const text of userContents) {
      for (const name of ordered) {
        const re = new RegExp(escapeRe(name), "gi");
        const hits = text.match(re);
        const nHits = hits ? hits.length : 0;
        if (nHits) pop.set(name, (pop.get(name) ?? 0) + nHits);
      }
    }
  }

  const popularTrainings = [...pop.entries()]
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0], "he")))
    .map(([name, count]) => ({ name, count }));

  return {
    leadsByDay,
    inboundMessagesByHour,
    followupReturnCount,
    popularTrainings,
  };
}
