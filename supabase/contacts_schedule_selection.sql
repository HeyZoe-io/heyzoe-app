-- WhatsApp sales-flow: date/time collection before CTA when direct schedule registration is disabled
alter table if exists public.contacts
  add column if not exists sf_requested_date text null;

alter table if exists public.contacts
  add column if not exists sf_requested_time text null;

alter table if exists public.contacts
  drop constraint if exists contacts_session_phase_check;

alter table if exists public.contacts
  add constraint contacts_session_phase_check
  check (session_phase in ('opening', 'warmup', 'schedule_date', 'schedule_time', 'cta', 'registered'));
