-- הערות ידניות לשיחות קו זואי שיווק (אדמין → פלואו שיווקי → שיחות)
-- הרצה ב-Supabase SQL Editor לפני שימוש בפיצ׳ר.

create table if not exists public.marketing_conversation_notes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  session_id text not null default '',
  business_name text not null default '',
  notes text not null default '',
  status text not null default 'in_process'
    check (status in ('in_process', 'not_relevant', 'registered')),
  conversation_at date null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (phone)
);

create index if not exists idx_mcn_phone
  on public.marketing_conversation_notes (phone);

create index if not exists idx_mcn_status
  on public.marketing_conversation_notes (status);

create index if not exists idx_mcn_updated
  on public.marketing_conversation_notes (updated_at desc);

comment on table public.marketing_conversation_notes is
  'הערות CRM ידניות ללידים בקו זואי שיווק (שם עסק, תאריך שיחה, סטטוס)';

grant select, insert, update, delete
  on public.marketing_conversation_notes
  to authenticated;

grant select, insert, update, delete
  on public.marketing_conversation_notes
  to service_role;

alter table public.marketing_conversation_notes
  enable row level security;
