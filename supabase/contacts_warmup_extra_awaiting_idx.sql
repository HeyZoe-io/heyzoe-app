-- Warmup extra awaiting index for CAS/guard (PR1: column + reset only; not used in routing yet).
-- Run in Supabase Dashboard → SQL Editor before deploying PR1 app code.

alter table if exists public.contacts
  add column if not exists warmup_extra_awaiting_idx integer not null default -2;

comment on column public.contacts.warmup_extra_awaiting_idx is
  'Sales-flow warmup: -2 off, -1 Q1 experience pending (if configured), 0+ extra question index awaiting answer.';
