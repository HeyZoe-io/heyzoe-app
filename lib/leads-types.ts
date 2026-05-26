export type LeadRow = {
  phone: string | null;
  full_name: string | null;
  source: string | null;
  created_at: string | null;
  opted_out: boolean | null;
  session_phase: string | null;
  trial_registered: boolean | null;
  wa_no_response_at: string | null;
  no_response_notified_at: string | null;
  wa_followup_stage: number | null;
  last_contact_at: string | null;
  cta_clicked_at: string | null;
  business_slug?: string | null;
  business_name?: string | null;
};
