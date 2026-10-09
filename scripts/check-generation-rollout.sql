-- Read-only. Edit the timestamp in `params`, then run in the SQL editor.
-- Does not insert, update, or delete.
--
-- max_tokens stops are not a database column. They are only a Vercel log line:
--   [wa-model-fallback] Claude hit max_tokens
-- The max_tokens_stops column below is always null for that reason.
--
-- A failed generation does not send a customer message. It is logged as
-- messages.role = 'event' and messages.content = '[heyzoe:ai_reply_failed]'.
-- Empty assistant rows (blank content) are counted separately.
--
-- Haiku 5.5 cost uses that row's input_tokens, not the hour's sum:
--   up to 100000 input tokens: $0.10 / $0.50 per MTok
--   over 100000 input tokens:  $0.50 / $2.50 per MTok
-- Haiku 4.5 and Gemini stay on their flat rates.

with params as (
  select timestamptz '2026-10-09 14:00:00+00' as since
),
priced as (
  select
    date_trunc('hour', u.created_at at time zone 'Asia/Jerusalem') as hour_il,
    b.slug as business_slug,
    u.model,
    u.input_tokens,
    u.output_tokens,
    case
      when u.model = 'claude-haiku-5-5' and u.input_tokens > 100000
        then u.input_tokens * 0.50 / 1000000.0 + u.output_tokens * 2.50 / 1000000.0
      when u.model = 'claude-haiku-5-5'
        then u.input_tokens * 0.10 / 1000000.0 + u.output_tokens * 0.50 / 1000000.0
      when u.model = 'claude-haiku-4-5'
        then u.input_tokens * 1.0 / 1000000.0 + u.output_tokens * 5.0 / 1000000.0
      when u.model = 'gemini-2.5-flash'
        then u.input_tokens * 0.30 / 1000000.0 + u.output_tokens * 2.50 / 1000000.0
      else 0
    end as cost_usd
  from public.ai_usage u
  join public.businesses b on b.id = u.business_id
  cross join params p
  where u.call_type = 'generation'
    and u.created_at >= p.since
),
gen as (
  select
    hour_il,
    business_slug,
    model,
    count(*)::int as generation_calls,
    avg(input_tokens) as avg_input_tokens,
    avg(output_tokens) as avg_output_tokens,
    sum(cost_usd) as cost_usd,
    count(*) filter (where model = 'gemini-2.5-flash')::int as gemini_fallback_calls
  from priced
  group by 1, 2, 3
),
events as (
  select
    date_trunc('hour', m.created_at at time zone 'Asia/Jerusalem') as hour_il,
    m.business_slug,
    split_part(coalesce(m.model_used, ''), '#', 1) as model,
    count(*) filter (
      where m.role = 'event' and m.content = '[heyzoe:ai_reply_failed]'
    )::int as failed_reply_events,
    count(*) filter (
      where m.role = 'assistant' and btrim(coalesce(m.content, '')) = ''
    )::int as empty_assistant_replies
  from public.messages m
  cross join params p
  where m.created_at >= p.since
    and split_part(coalesce(m.model_used, ''), '#', 1) in (
      'claude-haiku-5-5',
      'claude-haiku-4-5',
      'gemini-2.5-flash'
    )
    and (
      (m.role = 'event' and m.content = '[heyzoe:ai_reply_failed]')
      or (m.role = 'assistant' and btrim(coalesce(m.content, '')) = '')
    )
  group by 1, 2, 3
)
select
  g.hour_il,
  g.business_slug,
  g.model,
  g.generation_calls,
  round(g.avg_input_tokens::numeric, 1) as avg_input_tokens,
  round(g.avg_output_tokens::numeric, 1) as avg_output_tokens,
  round(g.cost_usd::numeric, 6) as cost_usd,
  g.gemini_fallback_calls,
  coalesce(e.failed_reply_events, 0) as failed_reply_events,
  coalesce(e.empty_assistant_replies, 0) as empty_assistant_replies,
  null::int as max_tokens_stops
from gen g
left join events e
  on e.hour_il = g.hour_il
 and e.business_slug = g.business_slug
 and e.model = g.model
order by g.hour_il, g.business_slug, g.model;
