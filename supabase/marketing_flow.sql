-- Marketing Flow tables for the admin flow builder
-- Run this once in Supabase SQL Editor

create table if not exists marketing_flow_nodes (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'message',
  data jsonb not null default '{}',
  position_x double precision not null default 0,
  position_y double precision not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists marketing_flow_edges (
  id uuid primary key default gen_random_uuid(),
  source_node_id uuid not null references marketing_flow_nodes(id) on delete cascade,
  target_node_id uuid not null references marketing_flow_nodes(id) on delete cascade,
  label text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists marketing_flow_settings (
  id int primary key default 1 check (id = 1),
  is_active boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into marketing_flow_settings (id, is_active) values (1, false)
on conflict (id) do nothing;

-- Sessions: tracks which phone number has been through the flow
create table if not exists marketing_flow_sessions (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  current_node_id uuid references marketing_flow_nodes(id) on delete set null,
  flow_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mf_sessions_phone on marketing_flow_sessions (phone);
