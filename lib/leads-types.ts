export type LeadRow = {
  phone: string | null;
  full_name: string | null;
  source: string | null;
  created_at: string | null;
  opted_out: boolean | null;
  not_relevant_at: string | null;
  not_relevant_reason: string | null;
  human_requested_at: string | null;
  human_followup_at: string | null;
  next_call_at: string | null;
  next_call_time?: string | null;
  session_phase: string | null;
  trial_registered: boolean | null;
  wa_no_response_at: string | null;
  no_response_notified_at: string | null;
  wa_followup_stage: number | null;
  last_contact_at: string | null;
  cta_clicked_at: string | null;
  business_slug?: string | null;
  business_name?: string | null;
  /** סטטוס ידני בפייפליין אדמין — גובר על החישוב האוטומטי בתצוגה */
  pipeline_status?: string | null;
};
