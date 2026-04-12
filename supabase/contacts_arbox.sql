-- Arbox WhatsApp: lead + user linkage
alter table if exists public.contacts
  add column if not exists arbox_lead_created_at timestamptz null;

alter table if exists public.contacts
  add column if not exists arbox_lead_id text null;

alter table if exists public.contacts
  add column if not exists arbox_user_id text null;

comment on column public.contacts.arbox_lead_created_at is 'First successful Arbox POST /v3/leads for this contact (HeyZoe WhatsApp).';
comment on column public.contacts.arbox_lead_id is 'lead id returned by Arbox POST /v3/leads.';
comment on column public.contacts.arbox_user_id is 'User id from Arbox GET /v3/users/searchUser when found by phone.';
