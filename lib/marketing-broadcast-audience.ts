import type { LeadRow } from "@/lib/leads-types";
import {
  isMarketingStage,
  resolveMarketingAdminColumn,
  type MarketingStage,
} from "@/lib/marketing-admin-status";

/** Same column as /admin/leads. */
export function marketingLeadColumnStatus(row: LeadRow): string {
  return resolveMarketingAdminColumn(row);
}

export function isMarketingNoResponseLead(row: LeadRow): boolean {
  return marketingLeadColumnStatus(row) === "no_response";
}

/** Unique phones whose leads column matches a secondary status. «לא רלוונטי» ו«הסר» לא נכללים. */
export function phonesForMarketingStage(leads: LeadRow[], stage: MarketingStage): string[] {
  const seen = new Set<string>();
  const phones: string[] = [];
  for (const lead of leads) {
    if (marketingLeadColumnStatus(lead) !== stage) continue;
    const phone = String(lead.phone ?? "").trim();
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    phones.push(phone);
  }
  return phones;
}

export function phonesForMarketingNoResponse(leads: LeadRow[]): string[] {
  return phonesForMarketingStage(leads, "no_response");
}

/** Union of several columns. A phone in more than one row is sent once. */
export function phonesForMarketingStages(leads: LeadRow[], stages: readonly MarketingStage[]): string[] {
  const wanted = new Set<string>(stages);
  const seen = new Set<string>();
  const phones: string[] = [];
  for (const lead of leads) {
    if (!wanted.has(marketingLeadColumnStatus(lead))) continue;
    const phone = String(lead.phone ?? "").trim();
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    phones.push(phone);
  }
  return phones;
}

export function isMarketingBroadcastStage(value: string): value is MarketingStage {
  return isMarketingStage(value);
}
