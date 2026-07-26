import type { SupabaseClient } from "@supabase/supabase-js";

/** ניסוחי חוסר-ידע של זואי (עברית + אנגלית) — לא כולל מגבלת 24ש׳ / redirect כללי. */
export const KNOWLEDGE_GAP_NEEDLES = [
  "אין לי את הפרטים",
  "אין לי כרגע מידע",
  "אין לי מידע על",
  "אין לי מידע לגבי",
  "אין לי את המידע",
  "לא מצאתי את המידע",
  "לא מצאתי מידע",
  "אני מתנצלת, אין לי",
  "i don't have the details",
  "i don't currently have information",
  "i don't have information",
  "i couldn't find the information",
  "i could not find the information",
] as const;

const EXCLUDED_MODELS = new Set(["claude_limit_24h"]);

/** חלון סריקה — מונע table scan מלא. ~1 שאילתה + סינון בזיכרון. */
const SCAN_DAYS = 90;
const ASSISTANT_SCAN_LIMIT = 1500;
const RESULT_LIMIT = 20;

export type KnowledgeGapItem = {
  id: string;
  assistantMessageId: number;
  sessionId: string;
  question: string;
  assistantSnippet: string;
  createdAt: string;
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export function isKnowledgeGapAssistantText(content: string, modelUsed?: string | null): boolean {
  if (modelUsed && EXCLUDED_MODELS.has(String(modelUsed).trim())) return false;
  const t = String(content ?? "").trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  return KNOWLEDGE_GAP_NEEDLES.some((n) => lower.includes(n.toLowerCase()));
}

function truncate(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * מוצא שאלות משתמש שלפני תשובת חוסר-ידע של זואי.
 * IO משוער לעסק: 3 שאילתות ממוקדות (assistant scan + dismissals + messages לפי session).
 */
export async function findKnowledgeGaps(input: {
  admin: SupabaseClient;
  businessSlug: string;
}): Promise<KnowledgeGapItem[]> {
  const slug = input.businessSlug.trim().toLowerCase();
  if (!slug) return [];

  const startIso = isoDaysAgo(SCAN_DAYS);

  const { data: assistants, error: aErr } = await input.admin
    .from("messages")
    .select("id, content, session_id, created_at, model_used")
    .eq("business_slug", slug)
    .eq("role", "assistant")
    .gte("created_at", startIso)
    .order("created_at", { ascending: false })
    .limit(ASSISTANT_SCAN_LIMIT);

  if (aErr) {
    console.error("[analytics-knowledge-gaps] assistant scan failed:", aErr.message);
    throw new Error(aErr.message);
  }

  const candidates = (assistants ?? [])
    .map((row) => ({
      id: Number((row as { id?: unknown }).id),
      content: String((row as { content?: unknown }).content ?? ""),
      sessionId: String((row as { session_id?: unknown }).session_id ?? "").trim(),
      createdAt: String((row as { created_at?: unknown }).created_at ?? ""),
      modelUsed: ((row as { model_used?: unknown }).model_used as string | null) ?? null,
    }))
    .filter(
      (r) =>
        Number.isFinite(r.id) &&
        r.id > 0 &&
        r.sessionId &&
        r.createdAt &&
        isKnowledgeGapAssistantText(r.content, r.modelUsed)
    );

  if (!candidates.length) return [];

  const candidateIds = candidates.map((c) => c.id);
  const { data: dismissedRows, error: dErr } = await input.admin
    .from("analytics_knowledge_gap_dismissals")
    .select("assistant_message_id")
    .eq("business_slug", slug)
    .in("assistant_message_id", candidateIds);

  if (dErr) {
    // טבלה עדיין לא קיימת / שגיאת הרשאה — לא נכשלים בשקט בלי לוג
    console.error("[analytics-knowledge-gaps] dismissals fetch failed:", dErr.message);
    if (/analytics_knowledge_gap_dismissals|does not exist|relation/i.test(dErr.message)) {
      // ממשיכים בלי dismiss — ה-UI עדיין יעבוד; dismiss ייכשל עד migration
    } else {
      throw new Error(dErr.message);
    }
  }

  const dismissed = new Set(
    (dismissedRows ?? []).map((r) => Number((r as { assistant_message_id?: unknown }).assistant_message_id))
  );

  const open = candidates.filter((c) => !dismissed.has(c.id)).slice(0, RESULT_LIMIT * 2);
  if (!open.length) return [];

  const sessionIds = [...new Set(open.map((c) => c.sessionId))];
  const oldest = open.reduce((min, c) => (c.createdAt < min ? c.createdAt : min), open[0]!.createdAt);
  // מרווח קטן אחורה כדי לתפוס את שאלת היוזר שלפני
  const padMs = 7 * 24 * 60 * 60 * 1000;
  const padStart = new Date(new Date(oldest).getTime() - padMs).toISOString();

  const { data: sessionMsgs, error: sErr } = await input.admin
    .from("messages")
    .select("session_id, role, content, created_at")
    .eq("business_slug", slug)
    .in("session_id", sessionIds)
    .in("role", ["user", "assistant"])
    .gte("created_at", padStart)
    .order("created_at", { ascending: true })
    .limit(8000);

  if (sErr) {
    console.error("[analytics-knowledge-gaps] session messages failed:", sErr.message);
    throw new Error(sErr.message);
  }

  const bySession = new Map<string, { role: string; content: string; createdAt: string }[]>();
  for (const m of sessionMsgs ?? []) {
    const sid = String((m as { session_id?: unknown }).session_id ?? "").trim();
    if (!sid) continue;
    const list = bySession.get(sid) ?? [];
    list.push({
      role: String((m as { role?: unknown }).role ?? ""),
      content: String((m as { content?: unknown }).content ?? ""),
      createdAt: String((m as { created_at?: unknown }).created_at ?? ""),
    });
    bySession.set(sid, list);
  }

  const out: KnowledgeGapItem[] = [];
  for (const gap of open) {
    if (out.length >= RESULT_LIMIT) break;
    const msgs = bySession.get(gap.sessionId) ?? [];
    let question = "";
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]!;
      if (m.createdAt >= gap.createdAt) continue;
      if (m.role === "user") {
        const q = String(m.content ?? "").trim();
        if (!q || q.startsWith("[media]") || q.startsWith("[heyzoe:")) continue;
        question = q;
        break;
      }
    }
    if (!question) continue;
    out.push({
      id: String(gap.id),
      assistantMessageId: gap.id,
      sessionId: gap.sessionId,
      question: truncate(question, 280),
      assistantSnippet: truncate(gap.content, 160),
      createdAt: gap.createdAt,
    });
  }

  return out;
}

export async function dismissKnowledgeGap(input: {
  admin: SupabaseClient;
  businessSlug: string;
  assistantMessageId: number;
  dismissedBy?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const slug = input.businessSlug.trim().toLowerCase();
  const mid = Number(input.assistantMessageId);
  if (!slug || !Number.isFinite(mid) || mid <= 0) {
    return { ok: false, error: "invalid_input", status: 400 };
  }

  const { error } = await input.admin.from("analytics_knowledge_gap_dismissals").upsert(
    {
      business_slug: slug,
      assistant_message_id: mid,
      dismissed_at: new Date().toISOString(),
      dismissed_by: input.dismissedBy ?? null,
    },
    { onConflict: "business_slug,assistant_message_id" }
  );

  if (error) {
    console.error("[analytics-knowledge-gaps] dismiss failed:", error.message);
    if (/analytics_knowledge_gap_dismissals|does not exist|relation/i.test(error.message)) {
      return {
        ok: false,
        error: "migration_required",
        status: 503,
      };
    }
    return { ok: false, error: error.message, status: 500 };
  }

  return { ok: true };
}
