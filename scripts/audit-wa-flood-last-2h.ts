/**
 * Read-only: find WhatsApp sessions with assistant-message floods in the last 2 hours.
 *   npx tsx --env-file=.env.local scripts/audit-wa-flood-last-2h.ts
 */
import { createClient } from "@supabase/supabase-js";

const WINDOW_HOURS = 2;
const FLOOD_MIN_ASSISTANT = 12;
const JOE_DIGITS = "972559902641";
const LIOR_DIGITS = "972508318162";

function sessionPhoneTail(sessionId: string): string {
  const sid = String(sessionId ?? "");
  const parts = sid.split("_");
  return parts.length >= 3 ? parts.slice(2).join("_") : sid;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim() || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — cannot audit production.");
    process.exit(2);
  }

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const sinceIso = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("messages")
    .select("business_slug, session_id, created_at")
    .eq("role", "assistant")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true })
    .limit(5000);

  if (error) {
    console.error("messages query failed:", error.message);
    process.exit(1);
  }

  const counts = new Map<
    string,
    { slug: string; session_id: string; n: number; first: string; last: string }
  >();
  for (const row of data ?? []) {
    const slug = String((row as { business_slug?: string }).business_slug ?? "");
    const session_id = String((row as { session_id?: string }).session_id ?? "");
    const created_at = String((row as { created_at?: string }).created_at ?? "");
    if (!slug || !session_id || !created_at) continue;
    const key = `${slug}|${session_id}`;
    const prev = counts.get(key);
    if (!prev) {
      counts.set(key, { slug, session_id, n: 1, first: created_at, last: created_at });
    } else {
      prev.n += 1;
      prev.last = created_at;
    }
  }

  const floods = [...counts.values()].filter((r) => r.n >= FLOOD_MIN_ASSISTANT).sort((a, b) => b.n - a.n);

  console.log(`Window: ${sinceIso} → now. Assistant rows fetched: ${(data ?? []).length}`);
  console.log(`Sessions with >= ${FLOOD_MIN_ASSISTANT} assistant messages: ${floods.length}`);

  if (!floods.length) {
    console.log("No flood-sized sessions in this window (among first 5000 assistant rows).");
    return;
  }

  for (const f of floods) {
    const phone = sessionPhoneTail(f.session_id);
    const who =
      phone.replace(/\D/g, "").includes(JOE_DIGITS) || phone.replace(/\D/g, "").endsWith("559902641")
        ? "JOE"
        : phone.replace(/\D/g, "").includes(LIOR_DIGITS) || phone.replace(/\D/g, "").endsWith("508318162")
          ? "LIOR"
          : "OTHER";
    console.log(
      `${who}\t${f.n}\t${f.slug}\t${phone}\t${f.first} → ${f.last}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
