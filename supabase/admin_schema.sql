-- Zoe admin analytics schema helpers
alter table if exists public.messages
  add column if not exists id bigserial primary key,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists business_slug text not null,
  add column if not exists role text not null check (role in ('user', 'assistant', 'event', 'system')),
  add column if not exists content text not null default '',
  add column if not exists model_used text,
  add column if not exists session_id text,
  add column if not exists error_code text;

create index if not exists idx_messages_created_at on public.messages(created_at desc);
create index if not exists idx_messages_slug_created_at on public.messages(business_slug, created_at desc);
create index if not exists idx_messages_session on public.messages(session_id);

create table if not exists public.conversions (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  business_slug text not null,
  session_id text,
  type text not null default 'cta_click'
);

create index if not exists idx_conversions_created_at on public.conversions(created_at desc);
create index if not exists idx_conversions_slug_created_at on public.conversions(business_slug, created_at desc);
create index if not exists idx_conversions_session on public.conversions(session_id);
