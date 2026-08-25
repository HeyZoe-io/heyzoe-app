import { matchCatalogServiceFromFreeText } from "@/lib/wa-unknown-class-slot";

/** גשר קבוע אחרי אישור מילולי של אימון — חובה לבחור מהרשימה כדי להמשיך בפלואו. */
export const OPENING_SERVICE_LIST_PICK_BRIDGE = "יש לבחור את השיעור מהרשימה";

export function replyContainsOpeningServiceListPickBridge(text: string): boolean {
  return String(text ?? "").includes(OPENING_SERVICE_LIST_PICK_BRIDGE);
}

export function ensureOpeningServiceListPickBridge(text: string): string {
  const raw = String(text ?? "").trim();
  if (!raw) return OPENING_SERVICE_LIST_PICK_BRIDGE;
  if (replyContainsOpeningServiceListPickBridge(raw)) return raw;
  return `${raw}\n\n${OPENING_SERVICE_LIST_PICK_BRIDGE}`;
}

function foldForMention(raw: string): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[׳״"'`]/g, "")
    .replace(/[&+]/g, " ")
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** האם תשובת זואי מזכירה שם אימון מהקטלוג (לא מילה כללית קצרה). */
export function assistantReplyMentionsCatalogService(
  assistantReply: string,
  serviceName: string
): boolean {
  const reply = foldForMention(assistantReply);
  const name = foldForMention(serviceName);
  if (!reply || !name || name.length < 4) return false;
  if (reply.includes(name)) return true;

  const withoutLatin = name.replace(/[a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  if (withoutLatin.length >= 5 && reply.includes(withoutLatin)) return true;

  const distinctive = name
    .split(" ")
    .map((w) => w.trim())
    .filter((w) => w.length >= 5 && !/^(אימוני|אימון|שיעור|שיעורי)$/u.test(w));
  if (!distinctive.length) return false;
  return distinctive.some((tok) => reply.includes(tok));
}

/**
 * רק כשממתינים לבחירת מוצר, עדיין אין sf_service, וזואי/הליד כבר «סגרו» אימון בעל־פה.
 * לא על שאלות מחיר/מידע כללי בלי שם מוצר מהרשימה.
 */
export function shouldAttachOpeningServiceListPickBridge(input: {
  phase: string;
  multiService: boolean;
  alreadyPickedService: boolean;
  inboundText: string;
  assistantReply: string;
  serviceNames: string[];
}): boolean {
  if (String(input.phase ?? "").trim() !== "opening") return false;
  if (!input.multiService || input.alreadyPickedService) return false;

  const names = (input.serviceNames ?? []).map((n) => String(n ?? "").trim()).filter(Boolean);
  if (names.length < 2) return false;

  const inboundMatch = matchCatalogServiceFromFreeText(
    input.inboundText,
    names.map((name) => ({ name }))
  );
  if (inboundMatch) return true;

  const mentioned = names.filter((name) =>
    assistantReplyMentionsCatalogService(input.assistantReply, name)
  );
  return mentioned.length === 1;
}
