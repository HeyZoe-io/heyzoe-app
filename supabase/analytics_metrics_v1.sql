-- DB-side rollup for analytics date filter.
-- This avoids downloading many message rows just to count distinct sessions.
--
-- Usage (PostgREST/Supabase): rpc('analytics_metrics_v1', { p_business_slug, p_start_iso })
create or replace function public.analytics_metrics_v1(
  p_business_slug text,
  p_start_iso timestamptz default null
)
returns table (
  total_chats bigint,
  new_leads bigint
)
language sql
stable
as $$
  with sessions_in_range as (
    select distinct m.session_id
    from public.messages m
    where m.business_slug = p_business_slug
      and m.session_id is not null
      and (p_start_iso is null or m.created_at >= p_start_iso)
  ),
  first_messages as (
    select m.session_id, min(m.created_at) as first_at
    from public.messages m
    where m.business_slug = p_business_slug
      and m.session_id is not null
    group by m.session_id
  )
  select
    (select count(*) from sessions_in_range) as total_chats,
    (case
      when p_start_iso is null then (select count(*) from sessions_in_range)
      else (select count(*) from first_messages fm where fm.first_at >= p_start_iso)
    end) as new_leads;
$$;

