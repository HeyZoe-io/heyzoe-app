import { normalizeSalesFlowGreetingToken } from "@/lib/sales-flow-start-triggers";

/** שאלת כתובת / הגעה / כניסה — כולל «איך נכנסים» (לא רק «איך מגיעים»). */
export function isAddressOrDirectionsIntent(text: string): boolean {
  const normalized = normalizeSalesFlowGreetingToken(text);
  return (
    normalized.includes("מה הכתובת") ||
    normalized.includes("כתובת") ||
    normalized.includes("איפה זה") ||
    normalized.includes("איפה אתם") ||
    normalized.includes("איפה נמצא") ||
    normalized.includes("מיקום") ||
    normalized.includes("איך מגיעים") ||
    normalized.includes("איך להגיע") ||
    normalized.includes("הנחיות הגעה") ||
    normalized.includes("דרכי הגעה") ||
    normalized.includes("איך באים") ||
    normalized.includes("איך מגיעה") ||
    normalized.includes("איך נכנסים") ||
    normalized.includes("איך נכנסות") ||
    normalized.includes("איך להיכנס") ||
    normalized.includes("איך נכנס") ||
    normalized.includes("כניסה ברגל") ||
    normalized.includes("נכנסים ברגל") ||
    normalized.includes("whats the address") ||
    normalized.includes("what is the address") ||
    normalized.includes("where are you located") ||
    normalized.includes("where are you") ||
    normalized.includes("where is the studio") ||
    normalized.includes("your address") ||
    normalized.includes("your location") ||
    normalized.includes("how do i get there") ||
    normalized.includes("how do i get in") ||
    normalized.includes("how to enter") ||
    normalized.includes("how to get in") ||
    normalized.includes("directions") ||
    normalized.includes("how to get to you") ||
    normalized.includes("where to find you")
  );
}
