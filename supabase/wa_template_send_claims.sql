-- Atomic 20h duplicate guard for automated business templates (sendBusinessTemplate).
-- One row per (business, phone tail, template). Params do not matter.
-- claim_template_send is a single statement: two workers can never both win the window.
-- A WhatsApp Business revoke after the claim lets the next send re-claim (p_reclaim_before).
-- Idempotent. The code falls back to the old messages lookup until this runs.

create table if not exists public.wa_template_send_claims (
  business_id bigint not null,
  phone text not null,
  template_name text not null,
  claimed_at timestamptz not null default now(),
  claim_token uuid not null default gen_random_uuid(),
  primary key (business_id, phone, template_name)
);

comment on table public.wa_template_send_claims is
  'sendBusinessTemplate: at most one automated send per business + phone (last 9 digits) + template per window.';

alter table public.wa_template_send_claims enable row level security;

create or replace function public.claim_template_send(
  p_business_id bigint,
  p_phone text,
  p_template_name text,
  p_token uuid,
  p_window_seconds integer default 72000,
  p_reclaim_before timestamptz default null
) returns boolean
language sql
security definer
set search_path = public
as $$
  with claimed as (
    insert into public.wa_template_send_claims as c (business_id, phone, template_name, claimed_at, claim_token)
    values (p_business_id, p_phone, p_template_name, now(), p_token)
    on conflict (business_id, phone, template_name) do update
      set claimed_at = now(), claim_token = p_token
      where c.claimed_at < now() - make_interval(secs => p_window_seconds)
         or (p_reclaim_before is not null and c.claimed_at < p_reclaim_before)
    returning 1
  )
  select exists (select 1 from claimed);
$$;

revoke all on function public.claim_template_send(bigint, text, text, uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_template_send(bigint, text, text, uuid, integer, timestamptz) to service_role;

-- Bulk audience cross-job check (lib/manual-bulk/queued-exclusion.ts)
create index if not exists idx_manual_bulk_queued_sends_business_template_status
  on public.manual_bulk_queued_sends (business_id, template_name, status);

-- Verify
select to_regclass('public.wa_template_send_claims') as claims_ok,
       to_regprocedure('public.claim_template_send(bigint,text,text,uuid,integer,timestamptz)') as rpc_ok,
       to_regclass('public.idx_manual_bulk_queued_sends_business_template_status') as index_ok;
