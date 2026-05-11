-- HeyZoe marketing WhatsApp (separate from per-business whatsapp_channels)
create table if not exists public.marketing_whatsapp_channel (
  id smallint primary key default 1 check (id = 1),
  phone_number_id text not null,
  phone_display text not null,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.marketing_whatsapp_channel (id, phone_number_id, phone_display, is_active)
values (1, '1179786855208358', '+972 3-382-4981', true)
on conflict (id) do update set
  phone_number_id = excluded.phone_number_id,
  phone_display = excluded.phone_display,
  is_active = excluded.is_active,
  updated_at = now();

-- Visual flow builder (single global marketing flow)
create table if not exists public.marketing_flow_nodes (
  id bigserial primary key,
  type text not null check (type in ('message', 'question', 'media', 'cta', 'followup')),
  data jsonb not null default '{}'::jsonb,
  position_x double precision not null default 0,
  position_y double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_flow_edges (
  id bigserial primary key,
  source_node_id bigint not null references public.marketing_flow_nodes (id) on delete cascade,
  target_node_id bigint not null references public.marketing_flow_nodes (id) on delete cascade,
  label text not null default ''
);

create index if not exists idx_marketing_flow_edges_source on public.marketing_flow_edges (source_node_id);
create index if not exists idx_marketing_flow_edges_target on public.marketing_flow_edges (target_node_id);

create table if not exists public.marketing_flow_settings (
  id smallint primary key default 1 check (id = 1),
  is_active boolean not null default false,
  root_node_id bigint references public.marketing_flow_nodes (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.marketing_flow_settings (id, is_active, root_node_id)
values (1, false, null)
on conflict (id) do nothing;

create table if not exists public.marketing_flow_sessions (
  id bigserial primary key,
  phone_number text not null,
  current_node_id bigint references public.marketing_flow_nodes (id) on delete set null,
  followup_wake_at timestamptz,
  followup_next_node_id bigint references public.marketing_flow_nodes (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_marketing_flow_sessions_phone on public.marketing_flow_sessions (phone_number);
