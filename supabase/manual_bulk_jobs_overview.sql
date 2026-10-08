-- «שליחות המוניות» on the automations page: every manual bulk job of a business with
-- queue counts and Meta delivery counts, in one call.
-- Idempotent. RUN THIS IN THE SUPABASE SQL EDITOR, after wa_message_statuses.sql and
-- messages_wamid.sql. Until it runs the page lists the jobs without counts.
--
-- IO per page load: one RPC. It reads up to p_limit jobs (+ any job still pending) on
-- idx_manual_bulk_jobs_business_created, their queue rows on idx_manual_bulk_queued_sends_job_id,
-- and the wa_message_statuses primary key once per sent row. No Meta calls.

-- 1) The Meta wamid of each sent queue row. Written by the drain from now on.
alter table public.manual_bulk_queued_sends
  add column if not exists wamid text default null;

comment on column public.manual_bulk_queued_sends.wamid is
  'Meta wamid of this send (same value as messages.wamid). Null before Oct 2026 and for unsent rows.';

-- 2) Backfill from messages.wamid: the drain logs the send on messages right after it marks
-- the row sent, so the match is business + recipient (last 9 digits) + the next few minutes.
-- Only rows from the last 60 days without a wamid; re-running changes nothing new.
with candidates as (
  select
    q.id,
    (
      select m.wamid
      from public.messages m
      where m.business_slug = b.slug
        and m.role = 'assistant'
        and m.model_used = 'lead_template'
        and m.wamid is not null
        and m.created_at >= q.updated_at - interval '30 seconds'
        and m.created_at <= q.updated_at + interval '3 minutes'
        and right(regexp_replace(coalesce(m.session_id, ''), '\D', '', 'g'), 9)
            = right(regexp_replace(q.contact_phone, '\D', '', 'g'), 9)
      order by abs(extract(epoch from (m.created_at - q.updated_at)))
      limit 1
    ) as wamid
  from public.manual_bulk_queued_sends q
  join public.businesses b on b.id = q.business_id
  where q.status = 'sent'
    and q.wamid is null
    and q.updated_at >= now() - interval '60 days'
)
update public.manual_bulk_queued_sends q
   set wamid = c.wamid
  from candidates c
 where q.id = c.id
   and c.wamid is not null
   and q.wamid is null;

-- 3) Jobs + counts for one business. Newest first; p_offset pages further back.
-- The first page also returns every job that still has pending rows, however old.
create or replace function public.manual_bulk_jobs_overview(
  p_business_id bigint,
  p_limit integer default 30,
  p_offset integer default 0
) returns table (
  id uuid,
  created_at timestamptz,
  created_by uuid,
  created_by_email text,
  schedule_id uuid,
  audience_type text,
  audience_params jsonb,
  template_name text,
  status text,
  queued_count integer,
  with_phone_count integer,
  without_phone_count integer,
  total_rows integer,
  pending_rows integer,
  sent_rows integer,
  canceled_rows integer,
  failed_rows integer,
  first_due_at timestamptz,
  first_sent_at timestamptz,
  last_sent_at timestamptz,
  tracked_rows integer,
  status_rows integer,
  delivered_rows integer,
  read_rows integer,
  delivery_failed_rows integer
)
language sql
stable
security definer
set search_path = public
as $$
  with page as (
    select j.id
    from public.manual_bulk_jobs j
    where j.business_id = p_business_id
    order by j.created_at desc
    limit greatest(1, least(coalesce(p_limit, 30), 200))
    offset greatest(0, coalesce(p_offset, 0))
  ),
  open_jobs as (
    select j.id
    from public.manual_bulk_jobs j
    where j.business_id = p_business_id
      and coalesce(p_offset, 0) = 0
      and j.status in ('queued', 'sending')
  ),
  job_ids as (
    select page.id from page
    union
    select open_jobs.id from open_jobs
  ),
  q as (
    select
      r.job_id,
      r.status,
      r.due_at,
      r.updated_at,
      r.wamid,
      st.any_status,
      st.delivered,
      st.read,
      st.failed
    from public.manual_bulk_queued_sends r
    left join lateral (
      select
        count(*) > 0 as any_status,
        coalesce(bool_or(s.status in ('delivered', 'read')), false) as delivered,
        coalesce(bool_or(s.status = 'read'), false) as read,
        coalesce(bool_or(s.status = 'failed'), false) as failed
      from public.wa_message_statuses s
      where s.wamid = r.wamid
    ) st on r.status = 'sent' and r.wamid is not null
    where r.job_id in (select job_ids.id from job_ids)
      and r.business_id = p_business_id
  ),
  agg as (
    select
      q.job_id,
      count(*)::int as total_rows,
      count(*) filter (where q.status = 'pending')::int as pending_rows,
      count(*) filter (where q.status = 'sent')::int as sent_rows,
      count(*) filter (where q.status = 'canceled')::int as canceled_rows,
      count(*) filter (where q.status = 'failed')::int as failed_rows,
      min(q.due_at) as first_due_at,
      min(q.updated_at) filter (where q.status = 'sent') as first_sent_at,
      max(q.updated_at) filter (where q.status = 'sent') as last_sent_at,
      count(*) filter (where q.status = 'sent' and q.wamid is not null)::int as tracked_rows,
      count(*) filter (where q.any_status)::int as status_rows,
      count(*) filter (where q.delivered and not q.failed)::int as delivered_rows,
      count(*) filter (where q.read and not q.failed)::int as read_rows,
      count(*) filter (where q.failed)::int as delivery_failed_rows
    from q
    group by q.job_id
  )
  select
    j.id,
    j.created_at,
    j.created_by,
    u.email::text as created_by_email,
    j.schedule_id,
    j.audience_type,
    j.audience_params,
    j.template_name,
    j.status,
    j.queued_count,
    j.with_phone_count,
    j.without_phone_count,
    coalesce(a.total_rows, 0),
    coalesce(a.pending_rows, 0),
    coalesce(a.sent_rows, 0),
    coalesce(a.canceled_rows, 0),
    coalesce(a.failed_rows, 0),
    a.first_due_at,
    a.first_sent_at,
    a.last_sent_at,
    coalesce(a.tracked_rows, 0),
    coalesce(a.status_rows, 0),
    coalesce(a.delivered_rows, 0),
    coalesce(a.read_rows, 0),
    coalesce(a.delivery_failed_rows, 0)
  from public.manual_bulk_jobs j
  join job_ids on job_ids.id = j.id
  left join agg a on a.job_id = j.id
  left join auth.users u on u.id = j.created_by
  order by j.created_at desc;
$$;

revoke all on function public.manual_bulk_jobs_overview(bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.manual_bulk_jobs_overview(bigint, integer, integer) to service_role;

-- Verify
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'manual_bulk_queued_sends' and column_name = 'wamid'
  ) as wamid_column_ok,
  to_regprocedure('public.manual_bulk_jobs_overview(bigint,integer,integer)') is not null as overview_ok,
  (select count(*) from public.manual_bulk_queued_sends where status = 'sent' and wamid is not null) as sent_rows_with_wamid;
