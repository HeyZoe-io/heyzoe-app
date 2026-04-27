-- Extend analytics_events allowed types (engagement signals)
-- Run AFTER creating public.analytics_events.
-- This updates the CHECK constraint that limits event_type values.

alter table public.analytics_events
  drop constraint if exists analytics_events_event_type_check;

alter table public.analytics_events
  add constraint analytics_events_event_type_check
  check (
    event_type in (
      'pageview',
      'cta_click',
      'chat_open',
      'checkout_start',
      'purchase',
      'lp_10s',
      'lp_30s',
      'lp_60s',
      'lp_scroll_50',
      'lp_scroll_75'
    )
  );

