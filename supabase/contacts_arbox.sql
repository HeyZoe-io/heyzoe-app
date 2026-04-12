-- Arbox WhatsApp: idempotent lead creation tracking
alter table if exists public.contacts
  add column if not exists arbox_lead_created_at timestamptz null;

comment on column public.contacts.arbox_lead_created_at is 'First successful Arbox POST /v3/leads for this contact (HeyZoe WhatsApp).';
