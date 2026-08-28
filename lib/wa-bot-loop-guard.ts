import {
  digitsForMarketingLineCompare,
  isZoeAdminWhatsAppPhone,
} from "@/lib/wa-inbound-unsupported";

export function isSameWhatsAppPeer(a: string, b: string): boolean {
  const left = digitsForMarketingLineCompare(a);
  const right = digitsForMarketingLineCompare(b);
  return Boolean(left && right && left === right);
}

/**
 * הודעה נכנסת ממספר זואי האדמין (שיווק/התראות בדיקה) או ממספר הערוץ עצמו —
 * מענה אוטומטי יוצר לולאת בדיקות בין שני בוטים / הד עצמי.
 */
export function shouldSkipStudioAutoReplyPeer(
  from: string,
  channelPhoneDisplay?: string | null
): boolean {
  if (isZoeAdminWhatsAppPhone(from)) return true;
  const display = String(channelPhoneDisplay ?? "").trim();
  if (display && isSameWhatsAppPeer(from, display)) return true;
  return false;
}
