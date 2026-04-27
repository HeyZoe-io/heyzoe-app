-- Add optional label (e.g., button text) for click events
alter table public.analytics_events
  add column if not exists label text;

create index if not exists idx_analytics_events_label on public.analytics_events(label);

