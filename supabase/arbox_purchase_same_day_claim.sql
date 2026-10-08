-- One purchase template per Arbox user + sale day + rule, across cron runs and parallel workers.
-- Arbox can split one checkout into two sale rows (Tights, sales 104660498 + 104660523, Oct 7 2026).
-- The first sale to reach the send takes the claim; a sibling sale on the same day is marked seen and not sent.
-- Until this runs, the purchase path keeps the in-run Set only. Idempotent.

create table if not exists public.arbox_purchase_same_day_claim (
  business_id bigint not null references public.businesses (id) on delete cascade,
  user_id text not null,
  sale_date date not null,
  trigger_id text not null,
  sale_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (business_id, user_id, sale_date, trigger_id)
);

alter table public.arbox_purchase_same_day_claim enable row level security;
