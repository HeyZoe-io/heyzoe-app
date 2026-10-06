-- Trial booking identity: store trial / not_trial / unknown.
-- Existing rows were inserted only for bookings treated as trials, so the default stays trial.
-- Run this in the Supabase SQL editor. Until it is applied, sends keep the current name match.

alter table public.arbox_trial_booking_identity
  add column if not exists classification text not null default 'trial';

alter table public.arbox_trial_booking_identity
  add column if not exists classification_note text;

alter table public.arbox_trial_booking_identity
  drop constraint if exists arbox_trial_booking_identity_classification_check;

alter table public.arbox_trial_booking_identity
  add constraint arbox_trial_booking_identity_classification_check
  check (classification in ('trial', 'not_trial', 'unknown'));
