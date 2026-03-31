-- Core multi-tenant schema for business owners
create table if not exists public.businesses (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null unique,
  name text not null,
  plan text not null default 'basic' check (plan in ('basic', 'premium')),
  niche text,
  bot_name text not null default 'זואי',
  logo_url text,
  social_links jsonb not null default '[]'::jsonb,
  primary_color text not null default '#ff85cf',
  secondary_color text not null default '#bc74e9',
  welcome_message text not null default 'נעים להכיר, אני זואי כאן ללוות אותך בדרך שלך.',
  cta_text text,
  cta_link text,
  facebook_pixel_id text,
  conversions_api_token text
);

create index if not exists idx_businesses_user_id on public.businesses(user_id);
create index if not exists idx_businesses_slug on public.businesses(slug);

create table if not exists public.services (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  business_id bigint not null references public.businesses(id) on delete cascade,
  name text not null,
  description text,
  location_mode text not null default 'online' check (location_mode in ('online', 'location')),
  location_text text,
  price_text text,
  service_slug text not null
);

create unique index if not exists uniq_services_business_slug on public.services(business_id, service_slug);
create index if not exists idx_services_business on public.services(business_id);

create table if not exists public.faqs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  business_id bigint not null references public.businesses(id) on delete cascade,
  service_id bigint references public.services(id) on delete cascade,
  question text not null,
  answer text not null,
  sort_order int not null default 0
);

create index if not exists idx_faqs_business on public.faqs(business_id);
create index if not exists idx_faqs_service on public.faqs(service_id);

-- Business members & roles
create table if not exists public.business_users (
  business_id bigint not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'employee')),
  status text not null default 'pending' check (status in ('pending', 'active')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create index if not exists idx_business_users_user on public.business_users(user_id);
create index if not exists idx_business_users_business on public.business_users(business_id);

alter table public.business_users enable row level security;

-- Members can see membership rows for businesses they belong to
create policy if not exists "business_users_select_own_memberships"
on public.business_users for select
using (auth.uid() = user_id);

-- Admin members can manage membership for their business
create policy if not exists "business_users_admin_manage"
on public.business_users for all
using (
  exists (
    select 1 from public.business_users bu
    where bu.business_id = business_users.business_id
      and bu.user_id = auth.uid()
      and bu.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.business_users bu
    where bu.business_id = business_users.business_id
      and bu.user_id = auth.uid()
      and bu.role = 'admin'
  )
);
