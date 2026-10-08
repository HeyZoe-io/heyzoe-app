-- Leave request (cancel / freeze / complaint handoff) on contacts. Idempotent.
-- Retention triggers skip the contact for 14 days (reason leave_request_14d).
-- Stamped by handleLeadHumanRequested from the closed-playbook category; no extra Claude call.

alter table public.contacts add column if not exists leave_request_at timestamptz null default null;
alter table public.contacts add column if not exists leave_request_kind text null default null;

create index if not exists idx_contacts_leave_request_at
  on public.contacts (business_id, leave_request_at)
  where leave_request_at is not null;

-- Backfill the last 14 days: a closed-playbook cancellation / freeze / complaint reply
-- sent within 2 minutes after a human_requested event in the same session.
with leave as (
  select
    m.business_slug,
    m.session_id,
    m.created_at,
    substring(m.model_used from '^closed_playbook_(?:fact_|catalog_)?(cancellation|freeze|complaint)(?:#|$)') as kind
  from public.messages m
  where m.role = 'assistant'
    and m.created_at >= now() - interval '14 days'
    and m.model_used ~ '^closed_playbook_(fact_|catalog_)?(cancellation|freeze|complaint)(#|$)'
    and exists (
      select 1
      from public.messages e
      where e.business_slug = m.business_slug
        and e.session_id = m.session_id
        and e.role = 'event'
        and e.model_used = 'human_requested'
        and e.created_at between m.created_at - interval '2 minutes' and m.created_at
    )
),
latest as (
  select distinct on (business_slug, session_id) business_slug, session_id, created_at, kind
  from leave
  order by business_slug, session_id, created_at desc
)
update public.contacts c
set leave_request_at = l.created_at,
    leave_request_kind = l.kind
from latest l
join public.businesses b on b.slug = l.business_slug
where c.business_id = b.id
  and c.phone = regexp_replace(l.session_id, '^wa_[^_]+_', '')
  and (c.leave_request_at is null or c.leave_request_at < l.created_at);
