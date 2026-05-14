-- WhatsApp Business Account ID (Embedded Signup / per-tenant WABA)
alter table public.businesses
  add column if not exists waba_id text not null default '';

comment on column public.businesses.waba_id is 'Meta WABA ID from Embedded Signup; empty = use platform META_WABA_ID in workers';
