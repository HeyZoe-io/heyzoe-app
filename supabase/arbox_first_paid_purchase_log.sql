-- first_paid_purchase: one WhatsApp when a person first buys a non-trial
-- membership (plan) or punch card (session).
-- Scheduling stays on the existing cron-job.org job → GET /api/cron/arbox-trial-sync
-- (not a new Vercel cron — Hobby).
--
-- Grain: (business_id, user_id) — a later renewal does not send again.
-- Seed: existing active customers are inserted with seeded=true and no WhatsApp.
-- Same-day joins (member_since / start_date = today) are left for the sale path.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR before deploying app code that uses these objects.
-- Seed marker is a row with user_id = 0 (no businesses column, so the sales cron
-- keeps working before this table exists as long as the trigger is off).

create table if not exists public.arbox_first_paid_purchase_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  user_id bigint not null,
  sale_id bigint null,
  seeded boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

comment on table public.arbox_first_paid_purchase_log is
  'first_paid_purchase: one row per Arbox user. seeded=true means already a customer, no welcome. sale_id is the converting sale when seeded=false.';

grant select, insert, update, delete
  on public.arbox_first_paid_purchase_log
  to authenticated;

grant select, insert, update, delete
  on public.arbox_first_paid_purchase_log
  to service_role;

alter table public.arbox_first_paid_purchase_log
  enable row level security;
