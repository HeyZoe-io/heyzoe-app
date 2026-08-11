-- Soft-disable WhatsApp templates on our side only (never touches Meta).
-- Sync / webhook status updates must not clear this flag (upsert omits the column).
-- Run in Supabase SQL editor.

alter table if exists public.whatsapp_templates
  add column if not exists disabled boolean not null default false;

comment on column public.whatsapp_templates.disabled is
  'Owner soft-hide in HeyZoe pickers/sends. Independent of Meta APPROVED status; refresh sync must not overwrite.';

create index if not exists idx_whatsapp_templates_business_disabled
  on public.whatsapp_templates (business_id, disabled)
  where disabled = false;
