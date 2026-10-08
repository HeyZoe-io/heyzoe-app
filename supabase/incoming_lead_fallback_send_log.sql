-- Claim + 24h dedup for /api/leads/incoming fallback (businesses.lead_template_name, no rule; Sanga / Zapier).
-- One opening template per business + phone per 24 hours. Idempotent.
-- Until this runs the route keeps its old unclaimed send.

create table if not exists public.incoming_lead_fallback_send_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  phone text not null,
  sent_day date not null,
  template_name text not null default '',
  status text not null default 'sending',
  attempts integer not null default 0,
  reason text null,
  processed_at timestamptz not null default now(),
  primary key (business_id, phone, sent_day)
);

create index if not exists idx_incoming_lead_fallback_send_log_recent
  on public.incoming_lead_fallback_send_log (business_id, phone, processed_at desc);

alter table public.incoming_lead_fallback_send_log enable row level security;
