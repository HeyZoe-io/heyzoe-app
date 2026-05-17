-- שאלות פתוחות מלידים בוואטסאפ שיווקי (זואי אדמין) — לטאב «שאלות שעלו» ב-/admin/zoe
create table if not exists public.marketing_lead_questions (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  phone text not null default '',
  question_text text not null default '',
  question_fingerprint text not null default '',
  topic_id text not null default 'other',
  flow_stage_key text not null default 'post_flow',
  flow_stage_label text not null default '',
  flow_node_id uuid references public.marketing_flow_nodes(id) on delete set null
);

create index if not exists idx_mlq_created on public.marketing_lead_questions(created_at desc);
create index if not exists idx_mlq_fingerprint on public.marketing_lead_questions(question_fingerprint);
create index if not exists idx_mlq_topic on public.marketing_lead_questions(topic_id);
create index if not exists idx_mlq_stage on public.marketing_lead_questions(flow_stage_key);

comment on table public.marketing_lead_questions is 'שאלות חופשיות מלידים אחרי/מחוץ לפלואו השיווקי (זואי וואטסאפ אדמין)';
