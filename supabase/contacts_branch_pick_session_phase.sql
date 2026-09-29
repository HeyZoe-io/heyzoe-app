-- =============================================================================
-- MIGRATION TO RUN in Supabase before branch selection goes live
-- for tshelgine-8774 (תמרה — עמיעד / קריית שמונה).
-- Extends contacts.session_phase CHECK — does NOT remove existing values.
-- New value: branch_pick (after warmup, before product / schedule).
-- Scheduling of this step is in the WhatsApp sales flow, not a cron.
-- =============================================================================

alter table if exists public.contacts
  drop constraint if exists contacts_session_phase_check;

alter table if exists public.contacts
  add constraint contacts_session_phase_check
  check (
    session_phase in (
      'opening',
      'warmup',
      'branch_pick',
      'schedule_date',
      'schedule_time',
      'call_schedule_day',
      'call_schedule_time',
      'cta',
      'registered'
    )
  );
