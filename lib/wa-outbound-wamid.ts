/**
 * Links the wamid Graph returns to the messages row that logs the same send.
 * Every send and its log run in the same request, so a per-instance registry is
 * enough. Key: last 9 digits of the recipient; phone_number_id is preferred, not required
 * (owner alerts go out from ZoeMaster and are logged on the marketing session).
 *
 * Send, then log: the log takes the wamid (content match, else the only candidate).
 * Log, then send: the log row id waits here and the send stamps it (strict content match).
 * No IO except that one update. Entries expire after two minutes.
 */
import { waOutboundLogMatches } from "@/lib/wa-message-log-context";
import { waSessionIdParts } from "@/lib/phone-normalize";

export const OUTBOUND_WAMID_TTL_MS = 2 * 60_000;
const MAX_ENTRIES_PER_KEY = 20;
const MAX_KEYS = 2000;

export type OutboundSendNote = {
  phoneNumberId: string;
  to: string;
  wamid: string;
  /** Text body, interactive body, media caption. Empty for templates. */
  text: string;
  /** Template body parameters. Empty for non-templates. */
  templateParams: string[];
  isTemplate: boolean;
};

type PendingSend = OutboundSendNote & { at: number };
type AwaitingRow = { rowId: string; phoneNumberId: string; content: string; at: number };

const pendingByKey = new Map<string, PendingSend[]>();
const awaitingByKey = new Map<string, AwaitingRow[]>();

export function outboundRecipientKey(phone: string): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

function fresh<T extends { at: number }>(list: T[] | undefined, nowMs: number): T[] {
  return (list ?? []).filter((item) => nowMs - item.at < OUTBOUND_WAMID_TTL_MS);
}

function prune(map: Map<string, unknown[]>): void {
  if (map.size <= MAX_KEYS) return;
  const drop = map.size - MAX_KEYS;
  let i = 0;
  for (const key of map.keys()) {
    if (i++ >= drop) break;
    map.delete(key);
  }
}

/** Graph `/messages` success body → wamid. */
export function wamidFromGraphResponse(json: unknown): string {
  const messages = (json as { messages?: Array<{ id?: unknown }> } | null)?.messages;
  return Array.isArray(messages) ? String(messages[0]?.id ?? "").trim() : "";
}

/** What the log row will say about this send, read from the Graph request body. */
export function describeGraphBody(body: unknown): { text: string; templateParams: string[]; isTemplate: boolean } {
  const b = (body ?? {}) as Record<string, unknown>;
  const type = String(b.type ?? "");
  if (type === "template") {
    const components = ((b.template as { components?: unknown } | undefined)?.components ?? []) as Array<{
      type?: unknown;
      parameters?: Array<{ text?: unknown }>;
    }>;
    const templateParams = Array.isArray(components)
      ? components
          .filter((c) => String(c?.type ?? "") === "body")
          .flatMap((c) => (Array.isArray(c.parameters) ? c.parameters : []))
          .map((p) => String(p?.text ?? "").trim())
          .filter(Boolean)
      : [];
    return { text: "", templateParams, isTemplate: true };
  }
  const pick = (v: unknown): string => String(v ?? "").replace(/[\u2067\u2069]/g, "").trim();
  if (type === "text") return { text: pick((b.text as { body?: unknown } | undefined)?.body), templateParams: [], isTemplate: false };
  if (type === "interactive") {
    const inter = b.interactive as { body?: { text?: unknown } } | undefined;
    return { text: pick(inter?.body?.text), templateParams: [], isTemplate: false };
  }
  const media = b[type] as { caption?: unknown } | undefined;
  return { text: pick(media?.caption), templateParams: [], isTemplate: false };
}

function sendMatchesContent(send: OutboundSendNote, content: string): boolean {
  if (send.isTemplate) {
    const params = send.templateParams.filter((p) => p.length >= 2);
    if (!params.length) return false;
    const flat = content.replace(/\s+/g, " ");
    return params.every((p) => flat.includes(p.replace(/\s+/g, " ")));
  }
  if (!send.text) return false;
  const stripped = content.replace(/^\[media\][^\n]*\n*/, "");
  return waOutboundLogMatches(send.text, content) || waOutboundLogMatches(send.text, stripped);
}

/** Called after Graph accepted a send. Returns a log row id to stamp, when the log came first. */
export function noteOutboundSend(note: OutboundSendNote, nowMs: number = Date.now()): string | null {
  const wamid = String(note.wamid ?? "").trim();
  const key = outboundRecipientKey(note.to);
  if (!wamid || !key) return null;
  const awaiting = fresh(awaitingByKey.get(key), nowMs);
  const hit = awaiting.findIndex((row) => sendMatchesContent(note, row.content));
  if (hit >= 0) {
    const [row] = awaiting.splice(hit, 1);
    awaitingByKey.set(key, awaiting);
    return row!.rowId;
  }
  awaitingByKey.set(key, awaiting);
  const list = fresh(pendingByKey.get(key), nowMs);
  list.push({ ...note, wamid, at: nowMs });
  pendingByKey.set(key, list.slice(-MAX_ENTRIES_PER_KEY));
  prune(pendingByKey);
  return null;
}

function sessionKeyParts(sessionId: string): { key: string; phoneNumberId: string } | null {
  const parts = waSessionIdParts(sessionId);
  if (!parts) return null;
  const key = outboundRecipientKey(parts.phone);
  return key ? { key, phoneNumberId: parts.phoneNumberId } : null;
}

/** The wamid for an assistant log row, consumed so the next row cannot take it. */
export function takeOutboundWamid(
  input: { sessionId: string | null | undefined; content: string },
  nowMs: number = Date.now()
): string | null {
  const parts = sessionKeyParts(String(input.sessionId ?? ""));
  if (!parts) return null;
  const list = fresh(pendingByKey.get(parts.key), nowMs);
  if (!list.length) {
    pendingByKey.delete(parts.key);
    return null;
  }
  const samePid = (s: PendingSend) => s.phoneNumberId === parts.phoneNumberId;
  const content = String(input.content ?? "");
  let idx = list.findIndex((s) => samePid(s) && sendMatchesContent(s, content));
  if (idx < 0) idx = list.findIndex((s) => sendMatchesContent(s, content));
  if (idx < 0 && list.length === 1) idx = 0;
  if (idx < 0) {
    pendingByKey.set(parts.key, list);
    return null;
  }
  const [hit] = list.splice(idx, 1);
  if (list.length) pendingByKey.set(parts.key, list);
  else pendingByKey.delete(parts.key);
  return hit!.wamid;
}

/** A log row written before its send. The send that matches it stamps the wamid. */
export function awaitOutboundWamid(
  input: { sessionId: string | null | undefined; content: string; rowId: string },
  nowMs: number = Date.now()
): void {
  const parts = sessionKeyParts(String(input.sessionId ?? ""));
  const rowId = String(input.rowId ?? "").trim();
  if (!parts || !rowId) return;
  const list = fresh(awaitingByKey.get(parts.key), nowMs);
  list.push({ rowId, phoneNumberId: parts.phoneNumberId, content: String(input.content ?? ""), at: nowMs });
  awaitingByKey.set(parts.key, list.slice(-MAX_ENTRIES_PER_KEY));
  prune(awaitingByKey);
}

export function resetOutboundWamidRegistry(): void {
  pendingByKey.clear();
  awaitingByKey.clear();
}

/** PostgREST / Postgres error for a messages.wamid column that is not there yet. */
export function isMissingWamidColumn(message: string): boolean {
  return /wamid/i.test(message) && /column|schema cache|PGRST204|42703/i.test(message);
}

let wamidColumnMissingUntil = 0;
export function wamidColumnKnownMissing(nowMs: number = Date.now()): boolean {
  return nowMs < wamidColumnMissingUntil;
}
export function markWamidColumnMissing(nowMs: number = Date.now()): void {
  if (!wamidColumnKnownMissing(nowMs)) {
    console.error("[wa-outbound-wamid] messages.wamid missing — run supabase/messages_wamid.sql");
  }
  wamidColumnMissingUntil = nowMs + 10 * 60_000;
}
