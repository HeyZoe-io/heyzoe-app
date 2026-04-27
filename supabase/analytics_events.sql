-- Public analytics events (LP tracking)
-- NOTE: this table is written by /api/track (no auth). Keep payload minimal.
create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('pageview','cta_click','chat_open','checkout_start','purchase','lp_10s','lp_30s','lp_60s','lp_scroll_50','lp_scroll_75')),
  value numeric null,
  source text null,
  session_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_analytics_events_created_at on public.analytics_events (created_at desc);
create index if not exists idx_analytics_events_type_created on public.analytics_events (event_type, created_at desc);
create index if not exists idx_analytics_events_session on public.analytics_events (session_id);
create index if not exists idx_analytics_events_source on public.analytics_events (source);

