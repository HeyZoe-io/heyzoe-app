/**
 * Arbox client-card general notes for trainer_trial_heads_up {{4}}.
 * GET /v3/users/notes?user_id= — one call per newly notified trial whose
 * approved template includes the notes slot. At ~10 studios and a handful of
 * due trials per day, that is a handful of GETs on the daily cron, plus one
 * more only if a failed send is retried.
 */
import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import { israelWallTimeToUtc } from "@/lib/marketing-call-time";
import { TEMPLATE_GENERAL_NOTES_FALLBACK } from "@/lib/template-send-params";

const NOTES_LIMIT = 3;
const NOTES_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
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

/** Arbox `created_at` is a naive Asia/Jerusalem wall time. */
export function arboxNoteCreatedAtUtc(createdAt: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?/.exec(String(createdAt ?? "").trim());
  if (!match) return null;
  const wall = israelWallTimeToUtc(match[1], match[2]);
  if (Number.isNaN(wall.getTime())) return null;
  const seconds = Number(match[3] ?? "0");
  if (!Number.isFinite(seconds)) return wall;
  return new Date(wall.getTime() + seconds * 1000);
}

/** True when the note was written in the 14 days before `now`, not after it. */
export function isArboxNoteInsideSendWindow(createdAt: string, now: Date): boolean {
  const created = arboxNoteCreatedAtUtc(createdAt);
  if (!created) return false;
  const ageMs = now.getTime() - created.getTime();
  return ageMs >= 0 && ageMs <= NOTES_WINDOW_MS;
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

/** Newest human notes from the 14 days before send. System notes do not consume the limit. */
export function newestGeneralNoteComments(
  json: unknown,
  options?: { limit?: number; now?: Date }
): string[] {
  const limit = options?.limit ?? NOTES_LIMIT;
  const now = options?.now ?? new Date();
  return generalNoteRowsFromPayload(json)
    .filter((row) => !isSystemGeneratedArboxNote(row.comment))
    .filter((row) => isArboxNoteInsideSendWindow(row.createdAt, now))
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
  /** Send time. The 14-day window is measured back from this instant. */
  now?: Date;
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
    });
    return TEMPLATE_GENERAL_NOTES_FALLBACK;
  }
  return formatArboxGeneralNotesForTemplate(
    newestGeneralNoteComments(res.json, { now: input.now ?? new Date() })
  );
}
