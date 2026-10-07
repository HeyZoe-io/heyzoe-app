/**
 * One-shot TIGHTS re-enable cleanup. Not a migration.
 * Run: npx tsx --env-file=.env.local scripts/tights-reenable-phase0.ts
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllArboxMembershipTypes, membershipTypeNameById } from "@/lib/arbox-membership-types";
import {
  bookingMatchesTrialScope,
  fetchArboxBookingsReport,
  formatDateYmdIsrael,
  normalizeMembershipTypeName,
  parseClassDateYmd,
} from "@/lib/leads/arbox-trial-attended";
import { SYNC_LOG_SENTINEL_TRIGGER_ID } from "@/lib/multi-rule-dedup";
import {
  canonicalContactPhone,
  contactPhoneLookupVariants,
  waSessionIdParts,
} from "@/lib/phone-normalize";
import { resolveSupabaseServiceRoleKey, resolveSupabaseUrl } from "@/lib/server-env";

const BUSINESS_ID = 3543;
const OFF_START = "2026-10-05T13:20:00.000Z";
const INCIDENT_FROM = "2026-10-05T12:00:00.000Z";
const INCIDENT_TO = "2026-10-05T16:00:00.000Z";
const REASON = "tights_reenable_cleanup";

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map((n) => Number(n));
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days, 12, 0, 0));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function mask(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `***${digits.slice(-4)}`;
}

function phoneFromSession(sessionId: string): string | null {
  const parts = waSessionIdParts(sessionId);
  return canonicalContactPhone(parts?.phone ?? sessionId);
}

async function main() {
  const { liveScriptSlug } = await import("./live-guard");
  if (!liveScriptSlug("tights")) return;
  const admin = createClient(resolveSupabaseUrl(), resolveSupabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });

  const { data: incidentMsgs, error: incErr } = await admin
    .from("messages")
    .select("session_id, created_at")
    .eq("business_slug", "tights")
    .eq("model_used", "lead_template")
    .gte("created_at", INCIDENT_FROM)
    .lt("created_at", INCIDENT_TO);
  if (incErr) throw incErr;
  const incidentPhones = [
    ...new Set(
      (incidentMsgs ?? [])
        .map((row) => phoneFromSession(String(row.session_id ?? "")))
        .filter((phone): phone is string => Boolean(phone))
    ),
  ];
  console.log("incident phones", incidentPhones.length);

  const phoneVariants = [...new Set(incidentPhones.flatMap((phone) => contactPhoneLookupVariants(phone)))];
  const { data: contacts, error: contactErr } = await admin
    .from("contacts")
    .select("id, phone, arbox_user_id")
    .eq("business_id", BUSINESS_ID)
    .in("phone", phoneVariants);
  if (contactErr) throw contactErr;
  const userIds = [
    ...new Set(
      (contacts ?? [])
        .map((row) => Number(row.arbox_user_id))
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
  console.log(
    "incident contacts",
    (contacts ?? []).map((row) => ({
      phone: mask(String(row.phone ?? "")),
      user: row.arbox_user_id,
    }))
  );
  const missing = incidentPhones.filter(
    (phone) => !(contacts ?? []).some((row) => contactPhoneLookupVariants(phone).includes(String(row.phone)))
  );
  if (missing.length) console.log("incident phones without contact", missing.map(mask));

  const { data: biz, error: bizErr } = await admin
    .from("businesses")
    .select("id, crm_api_key, crm_api_key_enc, crm_box_id, arbox_trial_membership_type_ids")
    .eq("id", BUSINESS_ID)
    .maybeSingle();
  if (bizErr || !biz) throw bizErr ?? new Error("missing business");
  const { getArboxApiKey } = await import("@/lib/business-secret-read");
  const apiKey = getArboxApiKey(biz);
  const boxId = String(biz.crm_box_id ?? "").trim();
  const trialTypeIds = Array.isArray(biz.arbox_trial_membership_type_ids)
    ? biz.arbox_trial_membership_type_ids.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  const names = await fetchAllArboxMembershipTypes({ apiKey, logLabel: "tights-reenable" });
  const trialTypeNamesNormalized = new Set<string>();
  if (names.ok) {
    const byId = membershipTypeNameById(names.types);
    for (const id of trialTypeIds) {
      const name = byId.get(id);
      if (name) trialTypeNamesNormalized.add(normalizeMembershipTypeName(name));
    }
  }
  const today = formatDateYmdIsrael(new Date());
  const toDate = addDaysYmd(today, 14);
  const report = await fetchArboxBookingsReport({ apiKey, fromDate: today, toDate, locationId: boxId });
  if (!report.ok) throw new Error(report.error);
  const userSet = new Set(userIds);
  const bookings = report.rows.flatMap((row) => {
    const userId = Number(row.user_id);
    const classDate = parseClassDateYmd(row.date);
    const classTime = String(row.time ?? "").trim();
    const className = String(row.class_name ?? "").trim();
    if (!userSet.has(userId) || !classDate || !classTime || !className) return [];
    if (classDate < today || classDate > toDate) return [];
    if (!bookingMatchesTrialScope(row, { trialTypeIds, trialTypeNamesNormalized })) return [];
    return [{ userId, classDate, classTime, className }];
  });
  console.log("future trial bookings for incident users", bookings.length, "users", userIds.length);

  const { data: rules, error: ruleErr } = await admin
    .from("template_triggers")
    .select("id, template_name")
    .eq("business_id", BUSINESS_ID)
    .eq("trigger_type", "trial_booked");
  if (ruleErr) throw ruleErr;
  const ruleIds = (rules ?? []).map((row) => String(row.id));
  const touched: Array<Record<string, unknown>> = [];
  for (const item of bookings) {
    const rows = [
      {
        business_id: BUSINESS_ID,
        trigger_id: SYNC_LOG_SENTINEL_TRIGGER_ID,
        user_id: item.userId,
        class_date: item.classDate,
        class_time: item.classTime,
        class_name: item.className,
        status: "sent",
        attempts: 0,
        confirm_status: "sent",
        template_status: "skipped",
        channel: "free",
        processed_at: new Date().toISOString(),
      },
      ...ruleIds.map((triggerId) => ({
        business_id: BUSINESS_ID,
        trigger_id: triggerId,
        user_id: item.userId,
        class_date: item.classDate,
        class_time: item.classTime,
        class_name: item.className,
        status: "sent",
        attempts: 0,
        confirm_status: "skipped",
        template_status: "sent",
        channel: "template",
        processed_at: new Date().toISOString(),
      })),
    ];
    const { error } = await admin.from("arbox_trial_booking_confirm_log").upsert(rows, {
      onConflict: "business_id,trigger_id,user_id,class_date,class_time,class_name,channel",
    });
    if (error) throw error;
    for (const row of rows) {
      touched.push({
        user_id: row.user_id,
        class_date: row.class_date,
        class_time: row.class_time,
        channel: row.channel,
        trigger_id: row.trigger_id,
      });
    }
  }
  console.log("confirm log rows upserted", touched.length);
  console.log(JSON.stringify(touched, null, 2));

  const unmatchedPhones = incidentPhones.filter((phone) => {
    const variants = new Set(contactPhoneLookupVariants(phone));
    return !(contacts ?? []).some(
      (row) => variants.has(String(row.phone ?? "")) && Number(row.arbox_user_id) > 0
    );
  });
  const phoneHits = report.rows.flatMap((row) => {
    const digits = String(row.phone ?? "").replace(/\D/g, "");
    const phone = unmatchedPhones.find((item) => digits.endsWith(item.slice(-9)));
    if (!phone) return [];
    const userId = Number(row.user_id);
    const classDate = parseClassDateYmd(row.date);
    const classTime = String(row.time ?? "").trim();
    const className = String(row.class_name ?? "").trim();
    if (!userId || !classDate || classDate < today || !classTime || !className) return [];
    if (!bookingMatchesTrialScope(row, { trialTypeIds, trialTypeNamesNormalized })) return [];
    return [{ userId, classDate, classTime, className, phone: mask(phone) }];
  });
  console.log("bookings matched by phone", phoneHits);
  if (phoneHits.length) {
    const extra = phoneHits.flatMap((item) => [
      {
        business_id: BUSINESS_ID,
        trigger_id: SYNC_LOG_SENTINEL_TRIGGER_ID,
        user_id: item.userId,
        class_date: item.classDate,
        class_time: item.classTime,
        class_name: item.className,
        status: "sent",
        attempts: 0,
        confirm_status: "sent",
        template_status: "skipped",
        channel: "free",
        processed_at: new Date().toISOString(),
      },
      ...ruleIds.map((triggerId) => ({
        business_id: BUSINESS_ID,
        trigger_id: triggerId,
        user_id: item.userId,
        class_date: item.classDate,
        class_time: item.classTime,
        class_name: item.className,
        status: "sent",
        attempts: 0,
        confirm_status: "skipped",
        template_status: "sent",
        channel: "template",
        processed_at: new Date().toISOString(),
      })),
    ]);
    const { error: extraErr } = await admin.from("arbox_trial_booking_confirm_log").upsert(extra, {
      onConflict: "business_id,trigger_id,user_id,class_date,class_time,class_name,channel",
    });
    if (extraErr) throw extraErr;
    console.log("phone-matched rows", extra.length);
  }

  if (userIds.length) {
    const { data: openRows, error: openErr } = await admin
      .from("arbox_trial_booking_confirm_log")
      .select("user_id, class_date, class_time, class_name, status, channel, trigger_id")
      .eq("business_id", BUSINESS_ID)
      .gte("class_date", today)
      .in("user_id", userIds)
      .neq("status", "sent");
    if (openErr) throw openErr;
    console.log("still open future rows", openRows ?? []);
    for (const row of openRows ?? []) {
      const channel = String(row.channel ?? "");
      const { error: markErr } = await admin
        .from("arbox_trial_booking_confirm_log")
        .update({
          status: "sent",
          confirm_status: channel === "free" ? "sent" : "skipped",
          template_status: channel === "template" ? "sent" : "skipped",
          processed_at: new Date().toISOString(),
        })
        .eq("business_id", BUSINESS_ID)
        .eq("trigger_id", row.trigger_id)
        .eq("user_id", row.user_id)
        .eq("class_date", row.class_date)
        .eq("class_time", row.class_time)
        .eq("class_name", row.class_name)
        .eq("channel", row.channel);
      if (markErr) throw markErr;
    }
  }

  const inbound: Array<{ created_at: string; session_id: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("messages")
      .select("created_at, session_id")
      .eq("business_slug", "tights")
      .eq("role", "user")
      .gte("created_at", OFF_START)
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    inbound.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  console.log("off-window inbound", inbound.length);
  const lastByPhone = new Map<string, string>();
  for (const row of inbound) {
    const phone = phoneFromSession(String(row.session_id ?? ""));
    if (!phone) continue;
    const prev = lastByPhone.get(phone);
    if (!prev || row.created_at > prev) lastByPhone.set(phone, row.created_at);
  }
  console.log(
    "off-window sessions",
    [...lastByPhone.entries()].map(([phone, at]) => ({ phone: mask(phone), at }))
  );

  const { data: noResponseRules, error: nrErr } = await admin
    .from("template_triggers")
    .select("id, template_name")
    .eq("business_id", BUSINESS_ID)
    .eq("trigger_type", "no_response");
  if (nrErr) throw nrErr;

  const nowIso = new Date().toISOString();
  let episodes = 0;
  let followups = 0;
  let nrRows = 0;
  for (const [phone, lastAt] of lastByPhone) {
    const variants = contactPhoneLookupVariants(phone);
    const { data: rows, error } = await admin
      .from("contacts")
      .select("id, phone, last_contact_at")
      .eq("business_id", BUSINESS_ID)
      .in("phone", variants.length ? variants : [phone]);
    if (error) throw error;
    for (const contact of rows ?? []) {
      const lastContact = String(contact.last_contact_at ?? lastAt);
      if (Date.parse(lastContact) < Date.parse(OFF_START)) continue;
      const { error: upErr } = await admin
        .from("contacts")
        .update({ wa_last_reengaged_at: nowIso, wa_followup_stage: 3, updated_at: nowIso })
        .eq("id", contact.id);
      if (upErr) throw upErr;
      episodes += 1;
      followups += 1;
      const episodeKey = new Date(Date.parse(lastAt)).toISOString();
      const phoneNorm = canonicalContactPhone(contact.phone) ?? phone;
      for (const rule of noResponseRules ?? []) {
        const dedup = `no_response:${BUSINESS_ID}:${rule.id}:${phoneNorm}:${episodeKey}`;
        const { error: insErr } = await admin.from("scheduled_template_sends").upsert(
          {
            business_id: BUSINESS_ID,
            trigger_id: rule.id,
            contact_phone: phoneNorm,
            template_name: String(rule.template_name ?? "no_response"),
            due_at: nowIso,
            status: "sent",
            dedup_key: dedup,
            last_error: REASON,
            updated_at: nowIso,
          },
          { onConflict: "dedup_key" }
        );
        if (insErr) throw insErr;
        nrRows += 1;
      }
    }
  }
  console.log("episodes closed", episodes, "followup stages closed", followups, "no_response log rows", nrRows);
  console.log("no_response rules", (noResponseRules ?? []).map((rule) => rule.id));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
