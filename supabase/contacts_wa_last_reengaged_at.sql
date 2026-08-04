-- no_response re-engage (>24h template): once-per-silence-episode marker + candidate index.
-- Safe to re-run. Run in Supabase SQL editor after deploy.

alter table if exists public.contacts
  add column if not exists wa_last_reengaged_at timestamptz null;

comment on column public.contacts.wa_last_reengaged_at is
  'When the no_response template re-engage last fired for this contact; compared to last user inbound to allow a new silence episode.';

-- Coarse candidate filter for daily cron (whatsapp conversation leads that may be silent).
create index if not exists idx_contacts_no_response_reengage_candidates
  on public.contacts (business_id, last_contact_at)
  where source = 'whatsapp'
    and last_contact_at is not null
    and (opted_out is distinct from true)
    and (trial_registered is distinct from true)
    and not_relevant_at is null
    and human_requested_at is null
    and (session_phase is distinct from 'registered');
