-- פלואו שיחה בנודים לבעל עסק (דף «שיחה»). לא כולל פולואפ — הפולואפים נשארים בדף שלהם.
-- הריצו ב-Supabase SQL Editor.

create table if not exists public.business_conversation_nodes (
  id uuid primary key default gen_random_uuid(),
  business_id bigint not null references public.businesses(id) on delete cascade,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  position_x double precision not null default 0,
  position_y double precision not null default 0,
  created_at timestamptz not null default now()
);

alter table public.business_conversation_nodes
  drop constraint if exists business_conversation_nodes_type_check;

alter table public.business_conversation_nodes
  add constraint business_conversation_nodes_type_check
  check (type in ('message', 'question', 'product', 'daytime', 'register', 'followup'));

create index if not exists idx_bcn_business on public.business_conversation_nodes(business_id);

create table if not exists public.business_conversation_edges (
  id uuid primary key default gen_random_uuid(),
  business_id bigint not null references public.businesses(id) on delete cascade,
  source_node_id uuid not null references public.business_conversation_nodes(id) on delete cascade,
  target_node_id uuid not null references public.business_conversation_nodes(id) on delete cascade,
  source_handle text not null default 'out',
  created_at timestamptz not null default now()
);

create index if not exists idx_bce_business on public.business_conversation_edges(business_id);

create table if not exists public.business_conversation_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id bigint not null references public.businesses(id) on delete cascade,
  phone text not null,
  current_node_id uuid references public.business_conversation_nodes(id) on delete set null,
  flow_completed boolean not null default false,
  product_slug text not null default '',
  captured_day text not null default '',
  captured_time text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, phone)
);

create index if not exists idx_bcs_business_phone on public.business_conversation_sessions(business_id, phone);

grant select, insert, update, delete on public.business_conversation_nodes to authenticated;
grant select, insert, update, delete on public.business_conversation_nodes to service_role;
alter table public.business_conversation_nodes enable row level security;

grant select, insert, update, delete on public.business_conversation_edges to authenticated;
grant select, insert, update, delete on public.business_conversation_edges to service_role;
alter table public.business_conversation_edges enable row level security;

grant select, insert, update, delete on public.business_conversation_sessions to authenticated;
grant select, insert, update, delete on public.business_conversation_sessions to service_role;
alter table public.business_conversation_sessions enable row level security;
