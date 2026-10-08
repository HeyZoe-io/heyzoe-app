-- Manual step: run once in the Supabase SQL editor before merging feat/arbox-member-badge.
-- Idempotent. One transaction: either every part applies or none does.
-- Replaces the unapplied supabase/contacts_arbox_membership_status.sql (Hebrew values).
-- Parts: 1 Arbox background pause, 2 membership badge, 3 follow-up series lock.

begin;

-- Part 1. Per-business pause of background Arbox work (crons, template triggers,
-- queued trigger sends, weekly campaigns, cron-raised CRM events, badge refresh).
-- Live-conversation Arbox calls are never paused. Default false: no business changes.
alter table public.businesses
  add column if not exists arbox_background_paused boolean not null default false;

comment on column public.businesses.arbox_background_paused is
  'True = no background Arbox calls or automated sends for this business. Replaces social_links.arbox_background_pause.';

-- acrobyjoe is the demo bot on a test number; its Arbox members are real people.
update public.businesses
  set arbox_background_paused = true
  where slug = 'acrobyjoe' and arbox_background_paused = false;

-- Part 2. Arbox membership badge on the conversations list. Null = not checked.
-- Not written for non-Arbox businesses.
alter table public.contacts
  add column if not exists arbox_membership_status text null,
  add column if not exists arbox_membership_checked_at timestamptz null;

alter table public.contacts
  drop constraint if exists contacts_arbox_membership_status_check;

alter table public.contacts
  add constraint contacts_arbox_membership_status_check
  check (
    arbox_membership_status is null
    or arbox_membership_status in ('active', 'inactive', 'lead')
  );

comment on column public.contacts.arbox_membership_status is
  'Arbox badge code: active | inactive | lead. Null = not checked or not an Arbox business.';

comment on column public.contacts.arbox_membership_checked_at is
  'When the per-contact Arbox membership lookup last succeeded. Refresh is skipped for 7 days.';

-- Part 3. Follow-up series runs once per contact. Set when the first follow-up is claimed,
-- or on any human involvement. Null on every existing row: nothing changes until the
-- backfill (scripts/backfill-followup-series-lock.mts) runs. The wa-followups due-time
-- trigger does not watch this column.
alter table public.contacts
  add column if not exists followup_series_locked_at timestamptz null;

comment on column public.contacts.followup_series_locked_at is
  'Set once: first follow-up claimed, or human request / staff reply / dashboard send. While set, no new follow-up series starts. Stage resets for tags are unaffected.';

commit;

-- Check after running:
-- select slug, arbox_background_paused from public.businesses where arbox_background_paused;
-- select count(*) from public.contacts where arbox_membership_status is not null;
-- select count(*) from public.contacts where followup_series_locked_at is not null;
