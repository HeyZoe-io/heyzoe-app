-- Mutual exclusion: Zoe's trial registration confirmation vs the trial purchase template.
-- NULL = neither notice recorded yet. First value sticks; the other channel must not send.
--
-- Safe for existing rows: DEFAULT null. No backfill.
-- Run in the Supabase SQL editor before the app relies on this column.

alter table public.contacts
  add column if not exists trial_signup_notice text null;

alter table public.contacts
  drop constraint if exists contacts_trial_signup_notice_check;

alter table public.contacts
  add constraint contacts_trial_signup_notice_check
  check (trial_signup_notice is null or trial_signup_notice in ('zoe', 'template'));

comment on column public.contacts.trial_signup_notice is
  'Trial signup notice already delivered: zoe = registration confirmation, template = purchase trigger for a trial product. NULL = not recorded.';
