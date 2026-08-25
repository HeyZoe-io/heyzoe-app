-- Append-only per-business LLM token usage (Anthropic / Gemini).
-- Written by the server (service_role) after each tracked LLM call when
-- AI_USAGE_TRACKING_ENABLED is on. Cost is NOT stored — tokens + model only;
-- admin aggregation estimates USD at query time from lib/ai-pricing.ts.
-- Admin read via service_role APIs (bypasses RLS). RLS enabled with no client
-- policies (= deny-all for anon/authenticated). No public access.
--
-- FK types (live schema): businesses.id = bigserial/bigint; contacts.id = uuid
-- (same as editor_corrections).
--
-- Run manually in the Supabase SQL Editor (paste + run).
-- Later: cleanup cron on created_at (like arbox_trial_sync_log 90-day) — not in v1;
-- idx_ai_usage_created is ready for that.

create table if not exists public.ai_usage (
  id bigserial primary key,
  business_id bigint not null references public.businesses (id) on delete cascade,
  contact_id uuid null references public.contacts (id) on delete set null,
  provider text not null,
  model text not null,
  call_type text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_usage_business_created
  on public.ai_usage (business_id, created_at desc);

create index if not exists idx_ai_usage_created
  on public.ai_usage (created_at);

comment on table public.ai_usage is
  'Append-only LLM token usage per business. Cost computed at query time, not stored.';

comment on column public.ai_usage.provider is
  'anthropic | google';

comment on column public.ai_usage.call_type is
  'generation | classifier | opt_out | start_intent | editor | dashboard_gen | other';

comment on column public.ai_usage.input_tokens is
  'Prompt / input tokens from the provider usage payload.';

comment on column public.ai_usage.output_tokens is
  'Completion / output tokens from the provider usage payload.';

grant select, insert, update, delete
  on public.ai_usage
  to authenticated;

grant select, insert, update, delete
  on public.ai_usage
  to service_role;

alter table public.ai_usage
  enable row level security;
