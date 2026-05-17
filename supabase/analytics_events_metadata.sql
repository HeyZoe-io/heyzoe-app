-- Optional JSON metadata for server-side purchase attribution (e.g. wa_marketing)
alter table public.analytics_events
  add column if not exists metadata jsonb;

create index if not exists idx_analytics_events_metadata on public.analytics_events using gin (metadata);
