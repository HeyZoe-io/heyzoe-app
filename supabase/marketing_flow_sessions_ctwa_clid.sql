-- Click-to-WhatsApp ad click id (Meta referral.ctwa_clid) — captured on the HeyZoe
-- marketing WhatsApp line for Meta Conversions API attribution (LeadSubmitted / Purchase).
alter table public.marketing_flow_sessions
  add column if not exists ctwa_clid text;
