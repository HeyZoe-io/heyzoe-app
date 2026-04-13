-- WhatsApp: user confirmed trial registration ("נרשמתי" / etc.) — automated after-trial message sent
alter table if exists public.contacts
  add column if not exists trial_registered boolean not null default false;

alter table if exists public.contacts
  add column if not exists trial_registered_at timestamptz null;

create index if not exists idx_contacts_trial_registered
  on public.contacts (business_id, trial_registered)
  where trial_registered = true;

comment on column public.contacts.trial_registered is 'True after contact sent a trial-registration confirmation keyword in WhatsApp (HeyZoe webhook).';
comment on column public.contacts.trial_registered_at is 'When trial_registered was first set true.';
