-- Weekly knowledge suggestions for the Zoe Admin pilot.
-- Server-side only (service role). No anon/authenticated policies.
-- Run in the Supabase SQL editor before the feature writes these tables.

create table if not exists public.knowledge_update_suggestions (
  id uuid primary key default gen_random_uuid(),
  business_id bigint not null,
  iso_week text not null,
  cluster_key text not null,
  question text not null,
  owner_answers jsonb not null default '[]'::jsonb,
  knowledge_text text not null,
  lead_count int not null default 0,
  status text not null default 'pending',
  decided_at timestamptz null,
  decided_via text null,
  created_at timestamptz not null default now(),
  constraint knowledge_update_suggestions_status_chk
    check (status in ('pending', 'sent', 'added', 'skipped', 'corrected', 'expired')),
  constraint knowledge_update_suggestions_via_chk
    check (decided_via is null or decided_via in ('whatsapp', 'dashboard')),
  unique (business_id, iso_week, cluster_key)
);

create index if not exists idx_knowledge_update_suggestions_week
  on public.knowledge_update_suggestions (iso_week, status);

create table if not exists public.knowledge_update_sessions (
  id uuid primary key default gen_random_uuid(),
  recipient text not null,
  iso_week text not null,
  opened_at timestamptz null,
  expires_at timestamptz null,
  suggestion_ids uuid[] not null default '{}',
  current_index int not null default 0,
  awaiting_correction boolean not null default false,
  summary_sent boolean not null default false,
  created_at timestamptz not null default now(),
  unique (recipient, iso_week)
);

create table if not exists public.knowledge_update_sends (
  iso_week text primary key,
  sent_at timestamptz not null default now(),
  suggestion_count int not null default 0,
  recipient_mode text not null,
  template_status text not null default ''
);

alter table public.knowledge_update_suggestions enable row level security;
alter table public.knowledge_update_sessions enable row level security;
alter table public.knowledge_update_sends enable row level security;

revoke all on table public.knowledge_update_suggestions from public, anon, authenticated;
revoke all on table public.knowledge_update_sessions from public, anon, authenticated;
revoke all on table public.knowledge_update_sends from public, anon, authenticated;

grant select, insert, update, delete on table public.knowledge_update_suggestions to service_role;
grant select, insert, update, delete on table public.knowledge_update_sessions to service_role;
grant select, insert, update, delete on table public.knowledge_update_sends to service_role;
