/**
 * Read-only: Tights timetable-image rows from the last 30 days.
 * The original Claude text was replaced before it was stored, so this replay
 * cannot re-parse a route tag. It shows the lead message that preceded each
 * image, and whether the high-precision schedule fast path would still send
 * the image before Claude.
 *
 *   npx tsx --env-file=.env.local scripts/replay-tights-timetable-route.ts
 */
import { createClient } from "@supabase/supabase-js";
import { isScheduleIntent } from "@/lib/wa-schedule-intent";
import { matchesBookedClassMoveIntent } from "@/lib/wa-registration-intent";

function loadEnv(): Record<string, string> {
  return process.env as Record<string, string>;
}

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("messages")
    .select("created_at, session_id, role, model_used, content")
    .eq("business_slug", "tights")
    .gte("created_at", since)
    .eq("role", "assistant")
    .or("model_used.eq.sales_flow_schedule_board_on_ask,model_used.like.sales_flow_schedule_board_on_ask#*")
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) throw new Error(error.message);
  const boards = data ?? [];
  console.log(`timetable rows ${boards.length} since ${since}`);
  const examples: string[] = [];
  let fastSchedule = 0;
  let fastMove = 0;
  let wouldReachClaude = 0;
  for (const row of boards) {
    const { data: prev } = await admin
      .from("messages")
      .select("content, created_at")
      .eq("business_slug", "tights")
      .eq("session_id", row.session_id)
      .eq("role", "user")
      .lt("created_at", row.created_at)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const text = String(prev?.content ?? "").replace(/\s+/g, " ").trim();
    const scheduleFast = isScheduleIntent(text);
    const moveFast = matchesBookedClassMoveIntent(text);
    if (scheduleFast) fastSchedule += 1;
    else if (moveFast) fastMove += 1;
    else wouldReachClaude += 1;
    if (examples.length < 5) {
      examples.push(
        `${row.created_at} fastSchedule=${scheduleFast} fastMove=${moveFast} | ${text.slice(0, 180)}`
      );
    }
  }
  console.log(`explicit schedule fast path ${fastSchedule}`);
  console.log(`booking-change fast path (image would not send) ${fastMove}`);
  console.log(`would reach Claude route tag ${wouldReachClaude}`);
  console.log("examples:");
  console.log(examples.join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
