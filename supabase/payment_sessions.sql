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

