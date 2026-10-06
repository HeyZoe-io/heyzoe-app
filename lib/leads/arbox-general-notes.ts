/**
 * Arbox client-card general notes for trainer_trial_heads_up {{4}}.
 * GET /v3/users/notes?user_id= — one call per newly notified trial whose
 * approved template includes the notes slot. At ~10 studios and a handful of
 * due trials per day, that is a handful of GETs on the daily cron, plus one
 * more only if a failed send is retried.
 */
import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import { TEMPLATE_GENERAL_NOTES_FALLBACK } from "@/lib/template-send-params";

const NOTES_LIMIT = 3;
/** Arbox 500s when `sort` is set on this route. Page locally after a capped GET. */
const NOTES_FETCH_LIMIT = 100;
const NOTES_MAX_CHARS = 400;

/** Meta body params reject newlines, tabs, and long runs of spaces. */
export function flattenMetaTemplateParam(raw: string, maxChars = NOTES_MAX_CHARS): string {
  const flat = String(raw ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  if (!flat) return "";
  if (flat.length <= maxChars) return flat;
  return `${flat.slice(0, maxChars - 1).trimEnd()}…`;
}

type GeneralNoteRow = { comment: string; createdAt: string };

/**
 * Zoe writes Arbox notes as the API user, so action_by is a staff name and
 * there is no note-type field. The marker is the CRM text itself.
 */
const SYSTEM_NOTE_LINE =
  /(?:^|\n)\s*(?:[✅🙋⏰]\s*)?זואי\s*[—–\-:]/u;

const SYSTEM_NOTE_BODIES = [
  "עברו 24 שעות והליד לא נרשם - יש ליצור קשר טלפוני",
  "עברו 6 שעות והליד לא ענה להודעת הפתיחה - יש ליצור איתו קשר טלפוני",
] as const;

export function isSystemGeneratedArboxNote(comment: string): boolean {
  const text = String(comment ?? "").trim();
  if (!text) return true;
  if (SYSTEM_NOTE_LINE.test(text)) return true;
  return SYSTEM_NOTE_BODIES.some((body) => text.includes(body));
}

export function generalNoteRowsFromPayload(json: unknown): GeneralNoteRow[] {
  const data = (json as { data?: unknown } | null)?.data;
  const rows = Array.isArray(data) ? data : [];
  const notes: GeneralNoteRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const comment = String((row as { comment?: unknown }).comment ?? "").trim();
    if (!comment) continue;
    notes.push({
      comment,
      createdAt: String((row as { created_at?: unknown }).created_at ?? "").trim(),
    });
  }
  return notes;
}

/** Newest human notes first. System notes do not consume the limit. */
export function newestGeneralNoteComments(json: unknown, limit = NOTES_LIMIT): string[] {
  return generalNoteRowsFromPayload(json)
    .filter((row) => !isSystemGeneratedArboxNote(row.comment))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((row) => row.comment);
}

/** Newest notes first, joined for a single WhatsApp template parameter. */
export function formatArboxGeneralNotesForTemplate(comments: readonly string[]): string {
  const parts = comments
    .filter((comment) => !isSystemGeneratedArboxNote(comment))
    .map((comment) => flattenMetaTemplateParam(comment, NOTES_MAX_CHARS))
    .filter(Boolean);
  if (!parts.length) return TEMPLATE_GENERAL_NOTES_FALLBACK;
  return flattenMetaTemplateParam(parts.join(" · "), NOTES_MAX_CHARS) || TEMPLATE_GENERAL_NOTES_FALLBACK;
}

export async function fetchArboxGeneralNotesText(input: {
  apiKey: string;
  userId: number;
}): Promise<string> {
  const apiKey = String(input.apiKey ?? "").trim();
  const userId = Math.trunc(Number(input.userId));
  if (!apiKey || !Number.isFinite(userId) || userId <= 0) {
    return TEMPLATE_GENERAL_NOTES_FALLBACK;
  }

  const qs = new URLSearchParams({
    user_id: String(userId),
    limit: String(NOTES_FETCH_LIMIT),
    page: "1",
  });
  const res = await arboxPublicFetch(`/v3/users/notes?${qs.toString()}`, {
    apiKey,
    method: "GET",
  });
  if (!res.ok) {
    console.error("[leads/arbox-general-notes] notes lookup failed", {
      user_id: userId,
      status: res.status,
      body: res.rawText.slice(0, 300),
    });
    return TEMPLATE_GENERAL_NOTES_FALLBACK;
  }
  return formatArboxGeneralNotesForTemplate(newestGeneralNoteComments(res.json));
}
