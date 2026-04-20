-- Support requests from business owners (dashboard help chat)

create table if not exists public.support_requests (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null,
  business_slug text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  callback_phone text,
  callback_requested_at timestamptz,
  last_message_at timestamptz not null default now()
);

create index if not exists idx_support_requests_user on public.support_requests(user_id, last_message_at desc);
create index if not exists idx_support_requests_business on public.support_requests(business_slug, last_message_at desc);
create index if not exists idx_support_requests_callback on public.support_requests(callback_requested_at desc) where callback_phone is not null;

create table if not exists public.support_request_messages (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  request_id bigint not null references public.support_requests(id) on delete cascade,
  role text not null check (role in ('owner', 'assistant', 'system')),
  content text not null default '',
  model_used text,
  error_code text
);

create index if not exists idx_support_request_messages_req on public.support_request_messages(request_id, created_at asc);

-- Note: no RLS policies here; API routes use service role and enforce access in code.

