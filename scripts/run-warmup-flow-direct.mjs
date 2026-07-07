#!/usr/bin/env node
/**
 * Runs 8 Meta webhook steps by calling the route POST handler directly (no HTTP server).
 * Uses NODE_ENV=development so missing WHATSAPP_APP_SECRET skips signature check.
 *
 * Phone: always WARMUP_TEST_PHONE. Business: --slug or WARMUP_TEST_SLUG.
 *   node --env-file=.env.local scripts/run-warmup-flow-direct.mjs --slug info-2815
 */
import { createClient } from "@supabase/supabase-js";
import {
  assertWarmupTestPhone,
  enforceWarmupTestSafe,
  resolveBusinessFromSlug,
  resolveWarmupTestSlug,
} from "./warmup-test-config.mjs";

process.env.NODE_ENV ??= "development";

const { POST } = await import("../app/api/whatsapp/webhook/route.ts");

const PHONE = enforceWarmupTestSafe("run-warmup-flow-direct");
const SLUG = resolveWarmupTestSlug();
const { businessId: BUSINESS_ID, phoneNumberId: PHONE_NUMBER_ID } = await resolveBusinessFromSlug(SLUG);
const SESSION_ID = `wa_${PHONE_NUMBER_ID}_${PHONE}`;
const SLEEP_MS = Number(process.env.SLEEP_MS ?? 5000);

const STEPS = [
  { label: "0: היי", text: "היי" },
  { label: "1: W0", text: "רוגע והורדת מתח" },
  { label: "2: W1", text: "נשימה, רגיעה ושקט" },
  { label: "3: W2", text: "גב/צוואר/כתפיים" },
  { label: "4: W3", text: "מסגרת קבועה וליווי" },
  { label: "5: W4", text: "פעם ראשונה/מעט" },
  { label: "6: service", text: "שיעור יוגה ממשיכים" },
  { label: "7: slot", text: "יום שני ב07:00" },
];

function metaPayload(wamid, text) {
  assertWarmupTestPhone(PHONE, "run-warmup-flow-direct metaPayload");
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
                phone_number_id: PHONE_NUMBER_ID,
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runSql() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const admin = createClient(url, key);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: final } = await admin
    .from("contacts")
    .select("session_phase, flow_step, warmup_extra_awaiting_idx, sf_requested_date, sf_requested_time")
    .eq("business_id", BUSINESS_ID)
    .eq("phone", PHONE)
    .maybeSingle();

  const { data: msgs } = await admin
    .from("messages")
    .select("created_at, role, model_used, content")
    .eq("session_id", SESSION_ID)
    .gte("created_at", since)
    .order("created_at", { ascending: true });

  const assistants = (msgs ?? []).filter((m) => m.role === "assistant");
  const dupMap = new Map();
  for (const m of assistants) {
    const k = `${m.model_used}\0${m.content}`;
    dupMap.set(k, (dupMap.get(k) ?? 0) + 1);
  }
  const duplicates = [...dupMap.entries()]
    .filter(([, n]) => n > 1)
    .map(([k, n]) => {
      const [model_used, content] = k.split("\0");
      return { model_used, content_preview: content.slice(0, 100), count: n };
    });

  const timeline = (msgs ?? []).map((m) => ({
    created_at: m.created_at,
    role: m.role,
    model_used: m.model_used,
    preview: String(m.content ?? "").slice(0, 100),
  }));

  return { final, duplicates, timeline };
}

async function main() {
  console.log(
    JSON.stringify(
      {
        slug: SLUG,
        testPhone: PHONE,
        phoneNumberId: PHONE_NUMBER_ID,
        businessId: BUSINESS_ID,
        sleepMs: SLEEP_MS,
      },
      null,
      2
    )
  );

  const ts = Date.now();
  const http = [];

  for (let i = 0; i < STEPS.length; i++) {
    const s = STEPS[i];
    assertWarmupTestPhone(PHONE, `run-warmup-flow-direct step ${i}`);
    const wamid = `wamid.DIRECT_FLOW_${ts}_${i + 1}`;
    const body = metaPayload(wamid, s.text);
    const req = new Request("http://localhost/api/whatsapp/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const t0 = Date.now();
    const res = await POST(req);
    const ms = Date.now() - t0;
    http.push({ step: s.label, code: res.status, ms });
    console.log(JSON.stringify({ http: http[http.length - 1] }));
    if (i < STEPS.length - 1) await sleep(SLEEP_MS);
  }

  await sleep(1500);
  const sql = await runSql();
  console.log(JSON.stringify({ httpSummary: http, sql }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
