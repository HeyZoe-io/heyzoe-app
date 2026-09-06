-- Purchase trigger: filter salesReport rows by Arbox item_type
-- (plan / session / service / trial) without listing membership_type_ids.
--
-- Why a new column (not product_filter):
--   product_filter is integer[] of membership_type_id. item_type is a different
--   dimension (class of sale). Encoding strings into that array would break
--   every other trigger that reads product_filter as ids.
--
-- Why not two purchase triggers by report (like expiring):
--   membership_expiring / sessions_expiring use TWO Arbox reports
--   (expiringMembershipsReport vs expiringSessionsReport). Purchase has only
--   salesReport in the v3 reportName enum — no per-class sales report.
--
-- Semantics:
--   NULL or '{}' = no class filter (all item_types; same as today).
--   Non-empty = sale.item_type must be in the list.
--   Coexists with product_filter (ids): class AND optional id include-list.
--
-- Safe for existing rows: DEFAULT null — no backfill, no behavior change until
-- the owner sets the filter on a purchase trigger.
--
-- Run in Supabase SQL editor before deploying app code that SELECTs this column.

alter table public.template_triggers
  add column if not exists item_type_filter text[] null;

comment on column public.template_triggers.item_type_filter is
  'Purchase only: optional include-list of salesReport item_type values (plan, session, service, trial). NULL/empty = all classes. Ignored by other trigger types.';
