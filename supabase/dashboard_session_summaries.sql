-- Fast conversation-list rollup for owner dashboards (Limitless-scale).
-- Caps work to the newest 12k messages per business so the RPC cannot table-scan
-- the full messages history (that 504'd Vercel Hobby ~10s).
--
-- Run in Supabase SQL editor. App falls back to a bounded messages read if missing.
--
-- IO: 1 indexed scan on (business_slug, created_at desc) per dashboard list load.

create or replace function public.dashboard_session_summaries(
  slug_variants text[],
  wa_session_prefixes text[]
)
returns table (
  session_id text,
  last_at timestamptz,
  msg_count bigint,
  last_role text
)
language sql
stable
as $$
  with recent as (
    select m.session_id, m.created_at, m.role
    from public.messages m
    where m.business_slug = any (slug_variants)
      and m.session_id is not null
      and length(m.session_id) > 0
    order by m.created_at desc
    limit 12000
  ),
  filtered as (
    select r.*
    from recent r
    where coalesce(cardinality(wa_session_prefixes), 0) = 0
       or r.session_id like any (
         select unnest(wa_session_prefixes) || '%'
       )
  ),
  agg as (
    select
      f.session_id,
      max(f.created_at) as last_at,
      count(*)::bigint as msg_count
    from filtered f
    group by f.session_id
  ),
  last_roles as (
    select distinct on (f.session_id)
      f.session_id,
      f.role as last_role
    from filtered f
    order by f.session_id, f.created_at desc
  )
  select
    a.session_id,
    a.last_at,
    a.msg_count,
    lr.last_role
  from agg a
  join last_roles lr on lr.session_id = a.session_id
  order by a.last_at desc
  limit 500;
$$;

grant execute on function public.dashboard_session_summaries(text[], text[]) to service_role;
grant execute on function public.dashboard_session_summaries(text[], text[]) to authenticated;
