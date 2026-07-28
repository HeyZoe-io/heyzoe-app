-- Arbox sales→Zoe trial sync: per-business trial product IDs + first-pass seed flag.
-- Defaults safe for existing rows (empty list = skip detection; seeded=false = first sales pass).

alter table public.businesses
  add column if not exists arbox_trial_membership_type_ids bigint[] not null default '{}'::bigint[],
  add column if not exists arbox_sales_sync_seeded boolean not null default false;

comment on column public.businesses.arbox_trial_membership_type_ids is
  'Arbox membership_type_id values that count as trial purchases for salesReport sync.';

comment on column public.businesses.arbox_sales_sync_seeded is
  'True after the first arbox-trial-sync salesReport pass seeded the dedup table without sending WhatsApp.';
