-- Manual step: run in the Supabase SQL editor before merging feat/arbox-member-badge.
-- The conversations list reads these columns. Null means not checked.
-- Non-Arbox businesses stay null. The webhook refresh no-ops until the columns exist.

alter table if exists public.contacts
  add column if not exists arbox_membership_status text null,
  add column if not exists arbox_membership_checked_at timestamptz null;

alter table public.contacts
  drop constraint if exists contacts_arbox_membership_status_check;

alter table public.contacts
  add constraint contacts_arbox_membership_status_check
  check (
    arbox_membership_status is null
    or arbox_membership_status in ('מנוי פעיל', 'מנוי לא בתוקף', 'ליד')
  );

comment on column public.contacts.arbox_membership_status is
  'Arbox conversations badge. Null = not checked. Not written for non-Arbox businesses.';

comment on column public.contacts.arbox_membership_checked_at is
  'When the per-contact Arbox membership lookup last succeeded. Refresh is skipped for 7 days.';
