-- Legacy flag: inactive WhatsApp follow-up per dormancy cycle (deprecated cron removed; column kept for existing rows)
alter table if exists public.contacts
  add column if not exists followup_sent boolean not null default false;

create index if not exists idx_contacts_inactive_followup
  on public.contacts (business_id, last_contact_at)
  where followup_sent = false and (opted_out is distinct from true);
