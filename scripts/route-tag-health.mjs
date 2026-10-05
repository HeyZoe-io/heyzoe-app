#!/usr/bin/env node
/**
 * Read-only route-tag health for messages.model_used suffixes.
 *
 *   node --env-file=.env.local scripts/route-tag-health.mjs --days 7
 *   node --env-file=.env.local scripts/route-tag-health.mjs --from 2026-10-01 --business tights
 */
import { createClient } from "@supabase/supabase-js";

function argValue(flag) {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && argv[i + 1]) return argv[i + 1];
    if (argv[i].startsWith(`${flag}=`)) return argv[i].slice(flag.length + 1);
  }
  return "";
}

function parseLoggedModel(raw) {
  const value = String(raw ?? "").trim();
  const hash = value.indexOf("#");
  if (hash === -1) return { model: value, route: null, tagStatus: null, tagged: false };
  const match = /^#route=([a-z_]+);tag=(ok|missing|invalid)$/.exec(value.slice(hash));
  if (!match) return { model: value.slice(0, hash), route: null, tagStatus: "invalid", tagged: true };
  return { model: value.slice(0, hash), route: match[1], tagStatus: match[2], tagged: true };
}

const days = Number(argValue("--days") || "7");
const fromArg = argValue("--from");
const toArg = argValue("--to");
const business = argValue("--business").trim().toLowerCase();
const fromIso = fromArg
  ? new Date(fromArg).toISOString()
  : new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
const toIso = toArg ? new Date(toArg).toISOString() : new Date().toISOString();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing Supabase env");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

const rows = [];
for (let offset = 0; ; offset += 1000) {
  let q = admin
    .from("messages")
    .select("id, created_at, business_slug, session_id, role, model_used, content")
    .eq("role", "assistant")
    .gte("created_at", fromIso)
    .lt("created_at", toIso)
    .order("created_at", { ascending: true })
    .range(offset, offset + 999);
  if (business) q = q.eq("business_slug", business);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  rows.push(...(data ?? []));
  if ((data ?? []).length < 1000) break;
}

const byRoute = {};
let tagged = 0;
let missing = 0;
let invalid = 0;
for (const row of rows) {
  const parsed = parseLoggedModel(row.model_used);
  if (!parsed.tagged) continue;
  tagged += 1;
  const keyName = parsed.route || "(none)";
  byRoute[keyName] = (byRoute[keyName] ?? 0) + 1;
  if (parsed.tagStatus === "missing") missing += 1;
  if (parsed.tagStatus === "invalid") invalid += 1;
}

async function pairsFor(route) {
  const hits = rows
    .filter((row) => parseLoggedModel(row.model_used).route === route)
    .slice(-20)
    .reverse();
  const out = [];
  for (const row of hits) {
    const { data: prev } = await admin
      .from("messages")
      .select("content, created_at")
      .eq("business_slug", row.business_slug)
      .eq("session_id", row.session_id)
      .eq("role", "user")
      .lt("created_at", row.created_at)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    out.push({
      at: row.created_at,
      business: row.business_slug,
      tag: parseLoggedModel(row.model_used).tagStatus,
      inbound: String(prev?.content ?? "").replace(/\s+/g, " ").slice(0, 180),
      outbound: String(row.content ?? "").replace(/\s+/g, " ").slice(0, 180),
    });
  }
  return out;
}

const bookingChange = await pairsFor("booking_change");
const handoff = await pairsFor("handoff");
const rate = tagged === 0 ? 0 : (missing + invalid) / tagged;

console.log(
  JSON.stringify(
    {
      from: fromIso,
      to: toIso,
      business: business || null,
      assistantRows: rows.length,
      tagged,
      byRoute,
      missing,
      invalid,
      missingOrInvalidRate: Number(rate.toFixed(4)),
      booking_change: bookingChange,
      handoff,
    },
    null,
    2
  )
);
