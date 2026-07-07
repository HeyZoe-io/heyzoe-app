#!/usr/bin/env node
/**
 * Simulates 8 Meta webhook POSTs for sanga warmup → CTA regression.
 * Default: local dev (no signature / bypass). Set PREVIEW_BASE + BYPASS + WHATSAPP_APP_SECRET for preview.
 *
 * Phone: always WARMUP_TEST_PHONE (default 972508318162). Business: --slug or WARMUP_TEST_SLUG.
 *   node --env-file=.env.local scripts/run-warmup-flow-test.mjs --slug info-2815
 */
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  assertWarmupTestPhone,
  enforceWarmupTestSafe,
  resolveBusinessFromSlug,
  resolveWarmupTestSlug,
} from "./warmup-test-config.mjs";

const PREVIEW_BASE = process.env.PREVIEW_BASE?.replace(/\/$/, "") ?? "";
const BYPASS_TOKEN = process.env.BYPASS_TOKEN ?? "";
const APP_SECRET = (process.env.WHATSAPP_APP_SECRET ?? process.env.META_APP_SECRET ?? "").trim();
const BASE = PREVIEW_BASE || process.env.LOCAL_BASE || "http://127.0.0.1:3001";
const SLEEP_MS = Number(process.env.SLEEP_MS ?? 5000);

const PHONE = enforceWarmupTestSafe("run-warmup-flow-test", { httpBase: BASE });
const SLUG = resolveWarmupTestSlug();
const { businessId: BUSINESS_ID, phoneNumberId: PHONE_NUMBER_ID } = await resolveBusinessFromSlug(SLUG);
const SESSION_ID = `wa_${PHONE_NUMBER_ID}_${PHONE}`;

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
  assertWarmupTestPhone(PHONE, "run-warmup-flow-test metaPayload");
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

function webhookUrl() {
  const path = "/api/whatsapp/webhook";
  if (PREVIEW_BASE && BYPASS_TOKEN) {
    return `${BASE}${path}?x-vercel-protection-bypass=${encodeURIComponent(BYPASS_TOKEN)}`;
  }
  return `${BASE}${path}`;
}

async function sign(body) {
  if (!APP_SECRET) return null;
  const hex = createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex");
  return `sha256=${hex}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postStep(step, wamid, text) {
  const body = metaPayload(wamid, text);
  const headers = { "Content-Type": "application/json" };
  const sig = await sign(body);
  if (sig) headers["x-hub-signature-256"] = sig;
  const res = await fetch(webhookUrl(), { method: "POST", headers, body });
  const code = res.status;
  let snippet = "";
  try {
    snippet = (await res.text()).slice(0, 120);
  } catch {
    /* ignore */
  }
  return { step: step.label, code, snippet };
}

async function runSql() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: "missing supabase env" };
  const admin = createClient(url, key);
  const since = new Date(Date.now() - 45 * 60 * 1000).toISOString();

  const final = await admin
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

  return { final: final.data, duplicates, timeline };
}

async function main() {
  console.log(
    JSON.stringify(
      {
        target: webhookUrl(),
        mode: PREVIEW_BASE ? "preview" : "local",
        sleepMs: SLEEP_MS,
        slug: SLUG,
        testPhone: PHONE,
        phoneNumberId: PHONE_NUMBER_ID,
        businessId: BUSINESS_ID,
      },
      null,
      2
    )
  );

  const ts = Date.now();
  const http = [];
  for (let i = 0; i < STEPS.length; i++) {
    const s = STEPS[i];
    assertWarmupTestPhone(PHONE, `run-warmup-flow-test step ${i}`);
    const wamid = `wamid.FLOW_TEST_${ts}_${i + 1}`;
    const result = await postStep(s, wamid, s.text);
    http.push(result);
    console.log(JSON.stringify({ http: result }));
    if (i < STEPS.length - 1) await sleep(SLEEP_MS);
  }

  await sleep(2000);
  const sql = await runSql();
  console.log(JSON.stringify({ httpSummary: http, sql }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
