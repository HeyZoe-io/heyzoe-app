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

export function commentsFromGeneralNotesPayload(json: unknown): string[] {
  const data = (json as { data?: unknown } | null)?.data;
  const rows = Array.isArray(data) ? data : [];
  const comments: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const comment = String((row as { comment?: unknown }).comment ?? "").trim();
    if (comment) comments.push(comment);
  }
  return comments;
}

/** Newest notes first, joined for a single WhatsApp template parameter. */
export function formatArboxGeneralNotesForTemplate(comments: readonly string[]): string {
  const parts = comments
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
    sort: "desc",
    limit: String(NOTES_LIMIT),
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
  return formatArboxGeneralNotesForTemplate(commentsFromGeneralNotesPayload(res.json));
}
