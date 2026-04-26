-- שיחות זואי בדף נחיתה (מעקב אדמין, ללא business_slug)
create table if not exists public.lp_zoe_landing_chat_turns (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  session_id text not null,
  user_message text not null,
  assistant_message text not null
);

create index if not exists idx_lp_zoe_landing_created on public.lp_zoe_landing_chat_turns(created_at desc);
create index if not exists idx_lp_zoe_landing_session on public.lp_zoe_landing_chat_turns(session_id);

comment on table public.lp_zoe_landing_chat_turns is 'LP zoe-bot chat turns (session_id from browser localStorage)';
