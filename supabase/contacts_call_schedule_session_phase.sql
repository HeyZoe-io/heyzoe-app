-- =============================================================================
-- MIGRATION TO RUN before deploying call-schedule session phases
-- Extends contacts.session_phase CHECK — does NOT remove existing values.
-- New values: call_schedule_day, call_schedule_time
-- (separate from schedule_date / schedule_time)
-- =============================================================================

alter table if exists public.contacts
  drop constraint if exists contacts_session_phase_check;

alter table if exists public.contacts
  add constraint contacts_session_phase_check
  check (
    session_phase in (
      'opening',
      'warmup',
      'schedule_date',
      'schedule_time',
      'call_schedule_day',
      'call_schedule_time',
      'cta',
      'registered'
    )
  );
