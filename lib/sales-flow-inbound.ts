import type { WaIncomingMessage, WaIncomingText } from "@/lib/whatsapp";

/**
 * Meta `list_reply` / `button_reply` מגיעים כ־type:"text" + metaInteractiveReplyKind
 * (ראו parseOneMetaMessage). אין type:"interactive" ב־WaIncomingMessage.
 */
export function isMetaInteractiveMenuReply(msg: WaIncomingMessage): boolean {
  if (msg.type !== "text") return false;
  if (msg.metaInteractiveReplyKind === "button_reply" || msg.metaInteractiveReplyKind === "list_reply") {
    return true;
  }
  // Meta sets reply `id` on interactive; plain typed text never has it.
  return Boolean(msg.metaInteractiveReplyId?.trim());
}

/** טקסט שהוקלד/נשלח בלי list_reply / button_reply — מסלול Claude + resend שאלה אחר כך. */
export function isSalesFlowFreeTextInbound(msg: WaIncomingMessage): msg is WaIncomingText {
  return msg.type === "text" && !isMetaInteractiveMenuReply(msg);
}

/**
 * «לא זיהיתי את הבחירה» + שליחה מחדש של תפריט — רק לבחירת תפריט שלא הותאמה.
 * טקסט חופשי שלא הותאם → false (ממשיכים ל-Claude).
 */
export function shouldResendDeterministicMenuOnUnrecognizedPick(msg: WaIncomingMessage): boolean {
  return isMetaInteractiveMenuReply(msg);
}
