import { composeGreeting, defaultSalesFlowConfig } from "@/lib/sales-flow";

/** הודעת הפתיחה הרגילה של מסלול המכירה, ממולאת בשם העסק. */
export function buildDefaultConversationOpening(input: {
  botName?: string | null;
  businessName?: string | null;
  tagline?: string | null;
  address?: string | null;
}): string {
  return composeGreeting(
    defaultSalesFlowConfig([]),
    String(input.botName ?? "").trim() || "זואי",
    String(input.businessName ?? "").trim() || "העסק",
    String(input.tagline ?? "").trim(),
    String(input.address ?? "").trim()
  );
}

export function taglineFromSocialLinks(social: unknown): { tagline: string; address: string } {
  const sl = social && typeof social === "object" && !Array.isArray(social) ? (social as Record<string, unknown>) : {};
  const tagline =
    typeof sl.tagline === "string" && sl.tagline.trim()
      ? sl.tagline.trim()
      : typeof sl.business_description === "string"
        ? (sl.business_description.split("\n")[0] ?? "").trim()
        : "";
  const address = typeof sl.address === "string" ? sl.address.trim() : "";
  return { tagline, address };
}
