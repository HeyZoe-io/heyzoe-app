import { computeContactStatus } from "@/lib/contact-status";
import type { LeadRow } from "@/lib/leads-types";
import { isMarketingPipelineDropStatus } from "@/lib/marketing-pipeline-status";

/** Same column as /admin/leads: a manual pipeline mark wins over the computed status. */
export function marketingLeadColumnStatus(row: LeadRow): string {
  if (isMarketingPipelineDropStatus(row.pipeline_status)) return row.pipeline_status;
  return computeContactStatus(row) ?? "none";
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
