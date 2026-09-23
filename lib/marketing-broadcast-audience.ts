import type { LeadRow } from "@/lib/leads-types";
import { resolveMarketingAdminColumn } from "@/lib/marketing-admin-status";

/** Same column as /admin/leads. */
export function marketingLeadColumnStatus(row: LeadRow): string {
  return resolveMarketingAdminColumn(row);
}

export function isMarketingNoResponseLead(row: LeadRow): boolean {
  return marketingLeadColumnStatus(row) === "no_response";
}

export function phonesForMarketingNoResponse(leads: LeadRow[]): string[] {
  const seen = new Set<string>();
  const phones: string[] = [];
  for (const lead of leads) {
    if (!isMarketingNoResponseLead(lead)) continue;
    const phone = String(lead.phone ?? "").trim();
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    phones.push(phone);
  }
  return phones;
}
