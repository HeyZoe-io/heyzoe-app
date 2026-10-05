#!/usr/bin/env node
/**
 * Send one or more inbound WhatsApp texts through the real webhook.
 * Phone is always the warmup test number. Production needs ALLOW_PROD_TEST=1.
 *
 *   node --env-file=.env.local scripts/run-inbound-test.mjs \
 *     --business tights --text "מה יש ביום שני בבוקר?"
 */
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  assertWarmupTestEnvironmentSafe,
  assertWarmupTestPhone,
  enforceWarmupTestPhoneOnly,
  resolveBusinessFromSlug,
} from "./warmup-test-config.mjs";

const PREVIEW_BASE = process.env.PREVIEW_BASE?.replace(/\/$/, "") ?? "";
const BYPASS_TOKEN = process.env.BYPASS_TOKEN ?? "";
const APP_SECRET = (process.env.WHATSAPP_APP_SECRET ?? process.env.META_APP_SECRET ?? "").trim();
const BASE = PREVIEW_BASE || process.env.LOCAL_BASE || "http://127.0.0.1:3001";
const SLEEP_MS = Number(process.env.SLEEP_MS ?? 4000);

function argValues(flag) {
  const out = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === flag && argv[i + 1]) {
      out.push(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith(`${flag}=`)) out.push(arg.slice(flag.length + 1));
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PHONE = enforceWarmupTestPhoneOnly("run-inbound-test");
assertWarmupTestEnvironmentSafe("run-inbound-test", { httpBase: BASE });
assertWarmupTestPhone(PHONE, "run-inbound-test");

const slug = (argValues("--business")[0] || argValues("--slug")[0] || "").trim().toLowerCase();
const texts = argValues("--text").map((t) => t.trim()).filter(Boolean);
if (!slug || texts.length === 0) {
  console.error("Usage: --business <slug> --text \"<message>\" [--text \"<message>\" ...]");
  process.exit(1);
}

const { businessId, phoneNumberId } = await resolveBusinessFromSlug(slug);
const sessionId = `wa_${phoneNumberId}_${PHONE}`;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing Supabase env");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

const CONTACT_FIELDS = [
  "id",
  "session_phase",
  "flow_step",
  "warmup_extra_awaiting_idx",
  "sf_requested_date",
  "sf_requested_time",
  "human_requested_at",
  "wa_next_followup_at",
  "wa_no_response_due_at",
  "wa_no_response_at",
  "wa_followup_stage",
  "wa_followup_1_sent_at",
  "wa_followup_2_sent_at",
  "wa_followup_3_sent_at",
  "followup_sent",
  "last_contact_at",
  "last_zoe_reply_at",
].join(", ");

async function loadContact() {
  const { data, error } = await admin
    .from("contacts")
    .select(CONTACT_FIELDS)
    .eq("business_id", businessId)
    .eq("phone", PHONE)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function webhookUrl() {
  const path = "/api/whatsapp/webhook";
  if (PREVIEW_BASE && BYPASS_TOKEN) {
    return `${BASE}${path}?x-vercel-protection-bypass=${encodeURIComponent(BYPASS_TOKEN)}`;
  }
  return `${BASE}${path}`;
}

function metaPayload(wamid, text) {
  assertWarmupTestPhone(PHONE, "run-inbound-test metaPayload");
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "0",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550000000",
                phone_number_id: phoneNumberId,
              },
              contacts: [{ profile: { name: "Lior Nativ" }, wa_id: PHONE }],
              messages: [
                {
                  from: PHONE,
                  id: wamid,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

async function postText(wamid, text) {
  const body = metaPayload(wamid, text);
  const headers = { "Content-Type": "application/json" };
  if (APP_SECRET) {
    const hex = createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex");
    headers["x-hub-signature-256"] = `sha256=${hex}`;
  }
  const res = await fetch(webhookUrl(), { method: "POST", headers, body });
  const snippet = (await res.text()).slice(0, 160);
  return { status: res.status, snippet };
}

function parseLoggedModel(raw) {
  const value = String(raw ?? "").trim();
  const hash = value.indexOf("#");
  if (hash === -1) return { model: value, route: null, tagStatus: null };
  const model = value.slice(0, hash);
  const match = /^#route=([a-z_]+);tag=(ok|missing|invalid)$/.exec(value.slice(hash));
  if (!match) return { model, route: null, tagStatus: null };
  return { model, route: match[1], tagStatus: match[2] };
}

function isTimetable(row) {
  const parsed = parseLoggedModel(row.model_used);
  const content = String(row.content ?? "");
  return (
    parsed.model === "sales_flow_schedule_board_on_ask" ||
    content.startsWith("[media]")
  );
}

async function messagesSince(sinceIso) {
  const { data, error } = await admin
    .from("messages")
    .select("id, created_at, role, model_used, content")
    .eq("business_slug", slug)
    .eq("session_id", sessionId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

const startedAt = new Date().toISOString();
const contactBefore = await loadContact();
const rows = [];
const ts = Date.now();

for (let i = 0; i < texts.length; i++) {
  assertWarmupTestPhone(PHONE, `run-inbound-test step ${i}`);
  const text = texts[i];
  const before = new Date().toISOString();
  const http = await postText(`wamid.INBOUND_TEST_${ts}_${i + 1}`, text);
  await sleep(1500);
  const msgs = await messagesSince(before);
  const assistants = msgs.filter((m) => m.role === "assistant" || m.role === "event");
  const reply = assistants.find((m) => m.role === "assistant") ?? null;
  const parsed = parseLoggedModel(reply?.model_used);
  const timetable = assistants.some((m) => m.role === "assistant" && isTimetable(m));
  const teamNotified = assistants.some((m) => parseLoggedModel(m.model_used).model === "human_requested");
  rows.push({
    text,
    http: http.status,
    httpBody: http.snippet,
    route: parsed.route,
    tagStatus: parsed.tagStatus,
    model: parsed.model || null,
    timetableImage: timetable,
    teamNotified,
    outgoing: String(reply?.content ?? "").replace(/\s+/g, " ").slice(0, 240),
  });
  console.log(JSON.stringify(rows[rows.length - 1]));
  if (i < texts.length - 1) await sleep(SLEEP_MS);
}

const created = await messagesSince(startedAt);
if (created.length) {
  const { error } = await admin.from("messages").delete().in(
    "id",
    created.map((m) => m.id)
  );
  if (error) console.error("cleanup messages failed:", error.message);
}

if (contactBefore) {
  const restore = { ...contactBefore };
  delete restore.id;
  const { error } = await admin.from("contacts").update(restore).eq("id", contactBefore.id);
  if (error) console.error("cleanup contact failed:", error.message);
} else {
  const createdContact = await loadContact();
  if (createdContact?.id) {
    const { error } = await admin.from("contacts").delete().eq("id", createdContact.id);
    if (error) console.error("cleanup new contact failed:", error.message);
  }
}

console.log(
  JSON.stringify(
    {
      slug,
      phone: PHONE,
      sessionId,
      target: webhookUrl(),
      cleanedMessages: created.length,
      results: rows,
    },
    null,
    2
  )
);
