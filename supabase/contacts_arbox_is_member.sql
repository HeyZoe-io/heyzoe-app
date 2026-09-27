-- Manual step: run in the Supabase SQL editor. The app tolerates this not having run yet.
-- Daily arbox-daily-triggers sets these from activeMembershipsReport. No new cron.
-- no_response then skips contacts.arbox_is_member = true (R3a).

alter table if exists public.contacts
  add column if not exists arbox_is_member boolean not null default false;

alter table if exists public.contacts
  add column if not exists arbox_member_synced_at timestamptz null;

comment on column public.contacts.arbox_is_member is
  'True when this contact phone was on the latest daily activeMembershipsReport. Default false so existing rows stay eligible until the first sync.';

comment on column public.contacts.arbox_member_synced_at is
  'When arbox-daily-triggers last wrote arbox_is_member for this contact.';

-- Daily clear of people who dropped off the report. Small: only current members.
create index if not exists idx_contacts_arbox_is_member_true
  on public.contacts (business_id)
  where arbox_is_member = true;

-- Candidate scan for no_response. Replaces the previous partial index so the
-- daily query (business_id + last_contact_at, whatsapp, not registered, not a
-- member) can skip members without a second filter pass.
drop index if exists public.idx_contacts_no_response_reengage_candidates;

create index if not exists idx_contacts_no_response_reengage_candidates
  on public.contacts (business_id, last_contact_at)
  where source = 'whatsapp'
    and last_contact_at is not null
    and (opted_out is distinct from true)
    and (trial_registered is distinct from true)
    and not_relevant_at is null
    and human_requested_at is null
    and (session_phase is distinct from 'registered')
    and arbox_is_member = false;

-- R3b: one lookup per business of candidate contact ids against member-trigger logs.
-- PK already leads with business_id; contact_id is not in it, so these indexes
-- keep the IN (contact_id) filter from scanning every log row for the business.
create index if not exists idx_arbox_birthday_sync_log_business_contact
  on public.arbox_birthday_sync_log (business_id, contact_id)
  where contact_id is not null;

create index if not exists idx_arbox_trial_attended_sync_log_business_contact
  on public.arbox_trial_attended_sync_log (business_id, contact_id)
  where contact_id is not null;

create index if not exists idx_arbox_missed_class_sync_log_business_contact
  on public.arbox_missed_class_sync_log (business_id, contact_id)
  where contact_id is not null;

create index if not exists idx_arbox_attendance_gap_sync_log_business_contact
  on public.arbox_attendance_gap_sync_log (business_id, contact_id)
  where contact_id is not null;

create index if not exists idx_arbox_expiring_sync_log_business_contact
  on public.arbox_expiring_sync_log (business_id, contact_id)
  where contact_id is not null;

create index if not exists idx_arbox_sessions_expiring_sync_log_business_contact
  on public.arbox_sessions_expiring_sync_log (business_id, contact_id)
  where contact_id is not null;

create index if not exists idx_arbox_credit_refusal_sync_log_business_contact
  on public.arbox_credit_refusal_sync_log (business_id, contact_id)
  where contact_id is not null;
