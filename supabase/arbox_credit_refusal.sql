-- Credit-refusal (Arbox transactionsReport status=FAIL) detection.
-- Scheduling: same cron-job.org job as arbox-trial-sync (separate step in that route).

alter table public.contacts
  add column if not exists credit_refusal_last_notified_at timestamptz null;

comment on column public.contacts.credit_refusal_last_notified_at is
  'Updated only after a real credit_refusal notify (immediate template send or deferred enqueue). Used for per-customer throttle (~3 days); seed must not set this.';

alter table public.businesses
  add column if not exists arbox_credit_refusal_seeded boolean not null default false;

comment on column public.businesses.arbox_credit_refusal_seeded is
  'True after the first credit_refusal FAIL pass seeded the seen log without sending WhatsApp.';

-- Per-transaction "seen" for seed + already-processed (retries still get NEW transaction_ids;
-- per-customer throttle is contacts.credit_refusal_last_notified_at).
create table if not exists public.arbox_credit_refusal_sync_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  transaction_id bigint not null,
  contact_id uuid null references public.contacts (id) on delete set null,
  processed_at timestamptz not null default now(),
  primary key (business_id, transaction_id)
);

create index if not exists idx_arbox_credit_refusal_sync_log_processed_at
  on public.arbox_credit_refusal_sync_log (processed_at);

comment on table public.arbox_credit_refusal_sync_log is
  'Arbox FAIL transactions already seen/seeded (PK business_id+transaction_id). Not the per-customer notify throttle.';

grant select, insert, update, delete
  on public.arbox_credit_refusal_sync_log
  to service_role;

alter table public.arbox_credit_refusal_sync_log
  enable row level security;
