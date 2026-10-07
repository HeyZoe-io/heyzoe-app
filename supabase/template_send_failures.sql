-- Meta error code + message for every failed template send.
-- Written by sendBusinessTemplate. Safe to run more than once.
-- Run this in Supabase before the next daily summary can show the code.

create table if not exists public.template_send_failures (
  id uuid primary key default gen_random_uuid(),
  business_id bigint,
  phone text not null default '',
  template_name text not null default '',
  trigger_id uuid,
  meta_code text not null default '',
  meta_message text not null default '',
  raw_error text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists template_send_failures_created_at_idx
  on public.template_send_failures (created_at desc);
