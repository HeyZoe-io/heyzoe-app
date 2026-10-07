-- Graph wamid for an outbound template.
-- A later «הפסק התראה» tap looks the wamid up and mutes that trigger.
-- The app already inserts here and ignores a missing table, so sends work
-- before this file is run. Without it the mute button cannot find the trigger.
-- RUN THIS IN THE SUPABASE SQL EDITOR.

create table if not exists public.wa_template_send_refs (
  wamid text primary key,
  business_id bigint not null references public.businesses (id) on delete cascade,
  phone text not null,
  template_name text not null,
  trigger_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists wa_template_send_refs_created_idx
  on public.wa_template_send_refs (created_at);

comment on table public.wa_template_send_refs is
  'Graph wamid of an outbound template, so a later «הפסק התראה» tap maps to one trigger.';

grant select, insert, update, delete on public.wa_template_send_refs to authenticated;
grant select, insert, update, delete on public.wa_template_send_refs to service_role;
alter table public.wa_template_send_refs enable row level security;
