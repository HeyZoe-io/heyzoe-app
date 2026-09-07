-- Drop C9 (attendance trend) leftovers, if any.
-- App code no longer references these objects. Safe to run after that deploy.
-- C8 (days in club / milestones) is NOT in this file.
--
-- These objects were planned in chat and may never have been created.
-- IF EXISTS / IF NOT EXISTS so a clean database is a no-op.

drop table if exists public.arbox_attendance_trend_sync_log;

alter table public.businesses
  drop column if exists arbox_attendance_trend_seeded;

alter table public.template_triggers
  drop column if exists variant_templates;
