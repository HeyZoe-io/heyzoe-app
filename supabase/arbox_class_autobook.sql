-- Arbox class auto-booking after a paid trial sale (lib/leads/arbox-class-autobook-run.ts).
-- Runs inside /api/cron/arbox-trial-sync (scheduled on cron-job.org, not Vercel).
-- Code tolerates this migration missing: no column → flag off for every business.

alter table public.businesses
  add column if not exists arbox_class_autobook_enabled boolean not null default false;

comment on column public.businesses.arbox_class_autobook_enabled is
  'Book the Arbox class the lead picked in Zoe''s flow after a paid trial sale. Default off.';

create table if not exists public.arbox_class_autobook_attempts (
  business_id bigint not null references public.businesses (id) on delete cascade,
  sale_id bigint not null,
  contact_id uuid null references public.contacts (id) on delete set null,
  arbox_user_id text not null default '',
  -- claimed | booked | rejected | unknown | handoff | skipped
  status text not null default 'claimed',
  reason text not null default '',
  occurrence_date date null,
  occurrence_time text not null default '',
  class_name text not null default '',
  schedule_id bigint null,
  membership_user_id bigint null,
  booking_id bigint null,
  http_status integer null,
  error_summary text not null default '',
  message_outcome text not null default '',
  handoff_pending boolean not null default false,
  created_at timestamptz not null default now(),
  settled_at timestamptz null,
  primary key (business_id, sale_id)
);

create index if not exists idx_arbox_class_autobook_attempts_occurrence
  on public.arbox_class_autobook_attempts (business_id, occurrence_date)
  where status in ('booked', 'unknown', 'claimed');

comment on table public.arbox_class_autobook_attempts is
  'One row per Arbox trial sale considered for auto-booking. The PK is the claim: a sale is booked at most once.';

grant select, insert, update, delete
  on public.arbox_class_autobook_attempts
  to authenticated;

grant select, insert, update, delete
  on public.arbox_class_autobook_attempts
  to service_role;

alter table public.arbox_class_autobook_attempts
  enable row level security;
