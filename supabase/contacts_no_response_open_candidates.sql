-- MANUAL. Run in the Supabase SQL editor. The app does not apply this.
--
-- Closed no_response episodes stay out of the candidate read:
--   wa_last_reengaged_at IS NULL OR wa_last_reengaged_at < last_contact_at
-- is an open episode. The partial index matches that predicate so a run
-- reads at most 200 open rows, however many closed rows exist.
--
-- CREATE INDEX / DROP INDEX are not CONCURRENTLY: the SQL editor runs this
-- file inside a transaction. Building the index takes a brief ACCESS
-- EXCLUSIVE lock on public.contacts. The table is small enough for that.
--
-- Replaces idx_contacts_no_response_reengage_candidates (same columns and
-- the same predicate, plus the open-episode clause). One index at the end.

drop index if exists public.idx_contacts_no_response_reengage_candidates;

create index if not exists idx_contacts_no_response_reengage_candidates
  on public.contacts (business_id, last_contact_at)
  where source = 'whatsapp'
    and last_contact_at is not null
    and (opted_out is distinct from true)
    and (trial_registered is distinct from true)
    and not_relevant_at is null
    and human_requested_at is null
    and (session_phase is distinct from 'registered')
    and arbox_is_member = false
    and (wa_last_reengaged_at is null or wa_last_reengaged_at < last_contact_at);

-- PostgREST cannot compare two columns. This function is the candidate query.
-- Its WHERE repeats the index predicate so the planner can use the index.
-- language sql so EXPLAIN of the body (below) can show the index scan.
create or replace function public.no_response_open_candidates(
  p_business_id bigint,
  p_silence_cutoff timestamptz,
  p_limit integer default 200
)
returns table (
  id uuid,
  phone text,
  full_name text,
  last_contact_at timestamptz,
  wa_last_reengaged_at timestamptz,
  opted_out boolean,
  not_relevant_at timestamptz,
  human_requested_at timestamptz,
  trial_registered boolean,
  session_phase text,
  arbox_user_id text,
  arbox_is_member boolean
)
language sql
stable
set search_path = public
as $$
  select
    c.id,
    c.phone,
    c.full_name,
    c.last_contact_at,
    c.wa_last_reengaged_at,
    c.opted_out,
    c.not_relevant_at,
    c.human_requested_at,
    c.trial_registered,
    c.session_phase,
    c.arbox_user_id,
    c.arbox_is_member
  from public.contacts c
  where c.business_id = p_business_id
    and c.source = 'whatsapp'
    and c.last_contact_at is not null
    and (c.opted_out is distinct from true)
    and (c.trial_registered is distinct from true)
    and c.not_relevant_at is null
    and c.human_requested_at is null
    and (c.session_phase is distinct from 'registered')
    and c.arbox_is_member = false
    and (c.wa_last_reengaged_at is null or c.wa_last_reengaged_at < c.last_contact_at)
    and c.last_contact_at <= p_silence_cutoff
  order by c.last_contact_at asc
  limit least(greatest(coalesce(p_limit, 200), 0), 200);
$$;

revoke all on function public.no_response_open_candidates(bigint, timestamptz, integer) from public;
revoke all on function public.no_response_open_candidates(bigint, timestamptz, integer) from anon;
revoke all on function public.no_response_open_candidates(bigint, timestamptz, integer) from authenticated;
grant execute on function public.no_response_open_candidates(bigint, timestamptz, integer) to service_role;
