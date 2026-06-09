-- תשובות לידים לשאלות בפלואו השיווקי (זואי אדמין) — לתצוגה פר ליד ב-/admin/leads
create table if not exists public.marketing_lead_answers (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  phone text not null default '',
  flow_node_id uuid references public.marketing_flow_nodes(id) on delete set null,
  question_text text not null default '',
  answer_text text not null default '',
  answer_kind text not null default 'button'
    check (answer_kind in ('button', 'free_text'))
);

create index if not exists idx_mla_phone_created on public.marketing_lead_answers(phone, created_at desc);
create index if not exists idx_mla_flow_node on public.marketing_lead_answers(flow_node_id);
create index if not exists idx_mla_created on public.marketing_lead_answers(created_at desc);

comment on table public.marketing_lead_answers is 'תשובות לידים לשאלות בפלואו השיווקי (זואי וואטסאפ אדמין)';

grant select, insert, update, delete
  on public.marketing_lead_answers
  to authenticated;

grant select, insert, update, delete
  on public.marketing_lead_answers
  to service_role;

alter table public.marketing_lead_answers
  enable row level security;
