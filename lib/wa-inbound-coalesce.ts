import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { sleepMs } from "@/lib/claude";

/** חלון קצר לאיחוד הודעות רצופות בוואטסאפ (פיצול משפט) בלי להאריך כל מענה. */
export const WA_INBOUND_COALESCE_MS = 1200;

export const WA_INBOUND_PICKUP_MAX_DEPTH = 3;

export type SessionUserMessageRow = {
  content: string;
  created_at: string;
};

export type SessionHistoryMessage = {
  role: string;
  content: string;
  created_at?: string;
};

export async function fetchLatestUserMessageCreatedAt(input: {
  businessSlug: string;
  sessionId: string;
}): Promise<string | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("messages")
      .select("created_at")
      .eq("business_slug", input.businessSlug)
      .eq("session_id", input.sessionId)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("[wa-inbound-coalesce] latest user created_at failed:", error.message);
      return null;
    }
    const at = String((data as { created_at?: string } | null)?.created_at ?? "").trim();
    return at || null;
  } catch (e) {
    console.warn("[wa-inbound-coalesce] latest user created_at exception:", e);
    return null;
  }
}

/** הודעות user אחרי afterIso (לא כולל), לפי session — indexed (slug, session, role, created_at). */
export async function fetchSessionUserMessagesAfter(input: {
  businessSlug: string;
  sessionId: string;
  afterIso: string;
}): Promise<SessionUserMessageRow[]> {
  const afterIso = String(input.afterIso ?? "").trim();
  if (!afterIso) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("messages")
      .select("content, created_at")
      .eq("business_slug", input.businessSlug)
      .eq("session_id", input.sessionId)
      .eq("role", "user")
      .gt("created_at", afterIso)
      .order("created_at", { ascending: true })
      .limit(20);
    if (error) {
      console.warn("[wa-inbound-coalesce] fetch after failed:", error.message);
      return [];
    }
    const out: SessionUserMessageRow[] = [];
    for (const row of data ?? []) {
      const content = String((row as { content?: string }).content ?? "").trim();
      const created_at = String((row as { created_at?: string }).created_at ?? "").trim();
      if (!content || !created_at) continue;
      out.push({ content, created_at });
    }
    return out;
  } catch (e) {
    console.warn("[wa-inbound-coalesce] fetch after exception:", e);
    return [];
  }
}

/**
 * Claim the trailing user turn already in the prompt-history snapshot.
 * Pickup must use the returned throughIso only AFTER a successful inference
 * so a crash before Claude returns still leaves those rows visible to pickup.
 */
export function claimTrailingUserTurnFromHistory(input: {
  history: SessionHistoryMessage[];
  promptText: string;
  throughIso: string;
}): { text: string; throughIso: string; extraCount: number } {
  const trailing: SessionUserMessageRow[] = [];
  for (let i = input.history.length - 1; i >= 0; i--) {
    const row = input.history[i];
    if (!row || row.role !== "user") break;
    const content = String(row.content ?? "").trim();
    const created_at = String(row.created_at ?? "").trim();
    if (!content || !created_at) continue;
    trailing.unshift({ content, created_at });
  }
  if (!trailing.length) {
    return { text: input.promptText, throughIso: input.throughIso, extraCount: 0 };
  }
  const promptParts = new Set(
    String(input.promptText ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const extraCount = trailing.filter((row) => !promptParts.has(row.content)).length;
  let throughIso = input.throughIso;
  for (const row of trailing) {
    if (row.created_at > throughIso) throughIso = row.created_at;
  }
  return {
    text: joinInboundUserTexts(input.promptText, trailing),
    throughIso,
    extraCount,
  };
}

export function joinInboundUserTexts(base: string, extras: { content: string }[]): string {
  const parts: string[] = [];
  const push = (raw: string) => {
    const t = String(raw ?? "").trim();
    if (!t) return;
    const prev = parts.length ? parts[parts.length - 1] : "";
    if (prev === t) return;
    parts.push(t);
  };
  push(base);
  for (const row of extras) push(row.content);
  return parts.join("\n");
}

export async function coalesceTrailingUserMessages(input: {
  businessSlug: string;
  sessionId: string;
  baseText: string;
  afterIso: string;
  waitMs?: number;
}): Promise<{ text: string; throughIso: string; extraCount: number }> {
  const waitMs = input.waitMs ?? WA_INBOUND_COALESCE_MS;
  if (waitMs > 0) await sleepMs(waitMs);
  const extras = await fetchSessionUserMessagesAfter({
    businessSlug: input.businessSlug,
    sessionId: input.sessionId,
    afterIso: input.afterIso,
  });
  const throughIso = extras.length ? extras[extras.length - 1]!.created_at : input.afterIso;
  return {
    text: joinInboundUserTexts(input.baseText, extras),
    throughIso,
    extraCount: extras.length,
  };
}
