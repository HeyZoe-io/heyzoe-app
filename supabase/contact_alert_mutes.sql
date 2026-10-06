-- «הפסק התראה»: mute one trigger, or one non-trigger template, for one customer.
-- Does not set contacts.marketing_opted_out.
-- RUN THIS IN THE SUPABASE SQL EDITOR before the button can be saved.

create table if not exists public.contact_alert_mutes (
  id uuid primary key default gen_random_uuid(),
  business_id bigint not null references public.businesses (id) on delete cascade,
  phone text not null,
  trigger_id uuid references public.template_triggers (id) on delete cascade,
  template_name text,
  created_at timestamptz not null default now(),
  constraint contact_alert_mutes_scope_chk check (
    trigger_id is not null
    or (template_name is not null and length(btrim(template_name)) > 0)
  )
);

create unique index if not exists contact_alert_mutes_trigger_uidx
  on public.contact_alert_mutes (business_id, phone, trigger_id)
  where trigger_id is not null;

create unique index if not exists contact_alert_mutes_template_uidx
  on public.contact_alert_mutes (business_id, phone, template_name)
  where trigger_id is null;

create index if not exists contact_alert_mutes_lookup_idx
  on public.contact_alert_mutes (business_id, phone);

comment on table public.contact_alert_mutes is
  'Customer tapped «הפסק התראה». trigger_id set = that trigger only. trigger_id null = that template when it is not sent by a trigger.';

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

grant select, insert, update, delete on public.contact_alert_mutes to authenticated;
grant select, insert, update, delete on public.contact_alert_mutes to service_role;
alter table public.contact_alert_mutes enable row level security;

grant select, insert, update, delete on public.wa_template_send_refs to authenticated;
grant select, insert, update, delete on public.wa_template_send_refs to service_role;
alter table public.wa_template_send_refs enable row level security;
