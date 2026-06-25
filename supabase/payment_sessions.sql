create table if not exists public.payment_sessions (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  slug text,
  ready boolean default false,
  created_at timestamptz default now()
);

alter table public.payment_sessions enable row level security;

create policy "read own session" on public.payment_sessions
  for select using (true);

-- UTM attribution (additive, nullable, no default).
-- Captured client-side (landing page / onboarding) and persisted on save-session,
-- then read by /api/icount-ipn to enrich the wa_lp purchase row's metadata.
alter table if exists public.payment_sessions
  add column if not exists utm_source text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text;

