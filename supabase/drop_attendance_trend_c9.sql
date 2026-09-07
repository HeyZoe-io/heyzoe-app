-- C9 only — מגמת נוכחות (attendance_trend).
-- Run in Supabase SQL editor AFTER the app deploy that no longer references these objects.
-- C8 (milestones / ימים במועדון) is NOT dropped here.
--
-- Safe on a clean DB: IF EXISTS / IF NOT EXISTS. Objects may never have been created.
--
-- Order: delete trigger rows first, then drop C9-only table/columns.

delete from public.template_triggers
where trigger_type = 'attendance_trend';

drop table if exists public.arbox_attendance_trend_sync_log;

alter table public.businesses
  drop column if exists arbox_attendance_trend_seeded;

-- variant_templates existed only for C9's three copy variants. No remaining
-- trigger type reads this column. Drop it; add a new JSON column later if needed.
alter table public.template_triggers
  drop column if exists variant_templates;
