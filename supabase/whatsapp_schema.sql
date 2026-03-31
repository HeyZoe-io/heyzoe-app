-- WhatsApp Business channels — one phone number per business
create table if not exists public.whatsapp_channels (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  business_id   bigint      not null references public.businesses(id) on delete cascade,
  business_slug text        not null,
  -- Meta phone number ID (e.g. "123456789012345") — unique per number
  phone_number_id text      not null unique,
  -- Human-readable display number (e.g. "+972-50-1234567")
  phone_display   text,
  is_active       boolean   not null default true
);

-- Per-session pause flags — when a session is paused, Zoe will not auto-respond
create table if not exists public.paused_sessions (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  business_slug text        not null,
  session_id    text        not null,
  paused_until  timestamptz not null
);

create index if not exists idx_paused_sessions_slug_session on public.paused_sessions(business_slug, session_id);
create index if not exists idx_paused_sessions_until on public.paused_sessions(paused_until);

create index if not exists idx_wa_channels_phone_number_id on public.whatsapp_channels(phone_number_id);
create index if not exists idx_wa_channels_business_slug   on public.whatsapp_channels(business_slug);
