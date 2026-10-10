/**
 * Read-only. Since cd3bb150: flow re-entries and find-class offers sent to a lead who was already in a flow.
 * SELECT only. No sends, no writes, no webhooks. Output under gitignored eval-output/, phones masked.
 *
 *   npx tsx --env-file=.env.local scripts/sfs-flow-reentry-audit.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { sessionCountsAsSalesFlowStarted } from "@/lib/sales-flow-start-triggers";
import { SALES_FLOW_GREETING_RESET_MODELS } from "@/lib/analytics";
import { WA_FOLLOWUP_CYCLE_RESET_MS } from "@/lib/wa-followup-cycle-reset";

const OUT = path.join(process.cwd(), "eval-output");
const SINCE = "2026-10-06T16:52:43Z";
const MINE_SINCE = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

type Row = { id: string; created_at: string; business_slug: string; session_id: string | null; role: string; model_used: string | null; content: string | null };

const admin = createSupabaseAdminClient();

function maskSession(session: string): string {
  return session.replace(/\d{6,}$/, (digits) => `…${digits.slice(-3)}`);
}

async function triggers(): Promise<Row[]> {
  const out: Row[] = [];
  for (const pattern of ["signup_intent_flow_entry#%", "interest_answer_find_class_ask%"]) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from("messages")
        .select("id, created_at, business_slug, session_id, role, model_used, content")
        .eq("role", "assistant")
        .like("model_used", pattern)
        .gte("created_at", SINCE)
        .order("created_at", { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      out.push(...((data ?? []) as Row[]));
      if (!data || data.length < 1000) break;
    }
  }
  return out;
}

function sessionQuery(row: Row, beforeIso: string) {
  return admin
    .from("messages")
    .select("id, created_at, business_slug, session_id, role, model_used, content")
    .eq("business_slug", row.business_slug)
    .eq("session_id", row.session_id!)
    .lt("created_at", beforeIso)
    .order("created_at", { ascending: false })
    .limit(1);
}
type SessionQuery = ReturnType<typeof sessionQuery>;

async function lastBefore(row: Row, beforeIso: string, filter: (q: SessionQuery) => SessionQuery): Promise<Row | null> {
  const { data, error } = await filter(sessionQuery(row, beforeIso)).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Row | null) ?? null;
}

/** sessionHasSalesFlowGreeting, bounded to messages before the inbound. */
async function flowStartedBefore(row: Row, beforeIso: string): Promise<boolean> {
  const marker = await lastBefore(row, beforeIso, (q) => q.eq("role", "assistant").in("model_used", [...SALES_FLOW_GREETING_RESET_MODELS]));
  const preceding = marker ? await lastBefore(row, marker.created_at, (q) => q.eq("role", "user")) : null;
  const lastAssist = await lastBefore(row, beforeIso, (q) => q.eq("role", "assistant"));
  return sessionCountsAsSalesFlowStarted({
    greetingMarkerModel: marker?.model_used ?? null,
    precedingUserText: preceding?.content ?? null,
    lastAssistantModel: lastAssist?.model_used ?? null,
  });
}

async function main(): Promise<void> {
  const rows = await triggers();
  const hits: { business: string; session: string; at: string; kind: string; inboundId: string; inbound: string }[] = [];
  for (const row of rows) {
    if (!row.session_id) continue;
    const model = String(row.model_used ?? "");
    const kind = model.startsWith("interest_answer_find_class_ask") ? "find_class_offer" : "flow_reentry";
    if (kind === "flow_reentry" && /;hint=(?:signup|registration_no_member)\b/.test(model)) continue;
    const inbound = await lastBefore(row, row.created_at, (q) => q.eq("role", "user"));
    if (!inbound) continue;
    const beforeInbound = await lastBefore(row, inbound.created_at, (q) => q.neq("role", "event"));
    const dormant =
      !beforeInbound || Date.parse(inbound.created_at) - Date.parse(beforeInbound.created_at) >= WA_FOLLOWUP_CYCLE_RESET_MS;
    const reactivated = await lastBefore(row, row.created_at, (q) =>
      q.eq("model_used", "no_response_reactivated").gte("created_at", new Date(Date.parse(inbound.created_at) - 60_000).toISOString())
    );
    if (dormant || reactivated) continue;
    if (!(await flowStartedBefore(row, inbound.created_at))) continue;
    hits.push({
      business: row.business_slug,
      session: row.session_id,
      at: row.created_at,
      kind,
      inboundId: inbound.id,
      inbound: String(inbound.content ?? "").slice(0, 120),
    });
  }
  const perBusiness = new Map<string, { sessions: Set<string>; flow_reentry: number; find_class_offer: number }>();
  for (const hit of hits) {
    const entry = perBusiness.get(hit.business) ?? { sessions: new Set(), flow_reentry: 0, find_class_offer: 0 };
    entry.sessions.add(hit.session);
    entry[hit.kind as "flow_reentry" | "find_class_offer"] += 1;
    perBusiness.set(hit.business, entry);
  }
  const summary = [...perBusiness.entries()]
    .map(([business, v]) => ({ business, conversations: v.sessions.size, flow_reentry: v.flow_reentry, find_class_offer: v.find_class_offer }))
    .sort((a, b) => b.conversations - a.conversations);
  const mined = hits.filter((hit) => hit.at >= MINE_SINCE);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    path.join(OUT, "sfs-reentry-audit.json"),
    JSON.stringify(
      {
        since: SINCE,
        triggers_scanned: rows.length,
        total_conversations: new Set(hits.map((h) => `${h.business}|${h.session}`)).size,
        summary,
        mined_last_7_days: mined.map((h) => ({ ...h, session: maskSession(h.session) })),
      },
      null,
      2
    )
  );
  console.log(JSON.stringify({ triggers_scanned: rows.length, hits: hits.length, summary }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "audit failed");
  process.exit(1);
});
