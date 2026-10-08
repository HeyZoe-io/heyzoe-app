-- Meta delivery status per outbound message (sent / delivered / read / failed).
-- Written by /api/whatsapp/webhook after the 200 is returned. One row per (wamid, status).
-- The app ignores a missing table: the webhook logs one error and keeps answering 200.
-- Idempotent. RUN THIS IN THE SUPABASE SQL EDITOR.
--
-- Volume: Meta sends up to three status events per outbound message, so about three rows
-- per message. The primary key serves lookups by wamid.

create table if not exists public.wa_message_statuses (
  wamid text not null,
  status text not null,
  business_id bigint references public.businesses (id) on delete set null,
  phone_number_id text,
  recipient_phone text,
  error_code integer,
  error_title text,
  status_at timestamptz,
  received_at timestamptz not null default now(),
  primary key (wamid, status)
);

create index if not exists wa_message_statuses_status_at_idx
  on public.wa_message_statuses (status, status_at);

create index if not exists wa_message_statuses_received_idx
  on public.wa_message_statuses (received_at);

comment on table public.wa_message_statuses is
  'Meta status webhook per outbound wamid: sent, delivered, read, failed (+ error code/title).';

grant select, insert, update, delete on public.wa_message_statuses to service_role;
alter table public.wa_message_statuses enable row level security;

-- Every automated template send (wa_template_send_refs) with its delivery state.
-- accepted = Graph returned a wamid and no status has arrived yet.
create or replace view public.wa_template_send_delivery
with (security_invoker = true) as
select
  r.wamid,
  r.business_id,
  r.phone,
  r.template_name,
  r.trigger_id,
  r.created_at as accepted_at,
  s.sent_at,
  s.delivered_at,
  s.read_at,
  s.failed_at,
  s.error_code,
  s.error_title,
  case
    when s.failed_at is not null then 'failed'
    when s.read_at is not null then 'read'
    when s.delivered_at is not null then 'delivered'
    when s.sent_at is not null then 'sent'
    else 'accepted'
  end as delivery_status
from public.wa_template_send_refs r
left join lateral (
  select
    max(st.status_at) filter (where st.status = 'sent') as sent_at,
    max(st.status_at) filter (where st.status = 'delivered') as delivered_at,
    max(st.status_at) filter (where st.status = 'read') as read_at,
    max(st.status_at) filter (where st.status = 'failed') as failed_at,
    max(st.error_code) filter (where st.status = 'failed') as error_code,
    max(st.error_title) filter (where st.status = 'failed') as error_title
  from public.wa_message_statuses st
  where st.wamid = r.wamid
) s on true;

revoke all on public.wa_template_send_delivery from anon, authenticated;
grant select on public.wa_template_send_delivery to service_role;

-- Verify
select
  to_regclass('public.wa_message_statuses') is not null as table_ok,
  to_regclass('public.wa_template_send_delivery') is not null as view_ok;
