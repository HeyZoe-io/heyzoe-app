-- One-time inactive WhatsApp follow-up per dormancy cycle (daily cron ~morning IL; see /api/cron/followup)
alter table if exists public.contacts
  add column if not exists followup_sent boolean not null default false;

create index if not exists idx_contacts_inactive_followup
  on public.contacts (business_id, last_contact_at)
  where followup_sent = false and (opted_out is distinct from true);
