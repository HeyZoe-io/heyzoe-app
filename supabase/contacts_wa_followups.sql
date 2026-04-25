-- WhatsApp: multi-step idle followups (20m / 2h / 23h) per contact
alter table if exists public.contacts
  add column if not exists wa_followup_stage integer not null default 0;

alter table if exists public.contacts
  add column if not exists wa_followup_1_sent_at timestamptz null;

alter table if exists public.contacts
  add column if not exists wa_followup_2_sent_at timestamptz null;

alter table if exists public.contacts
  add column if not exists wa_followup_3_sent_at timestamptz null;

create index if not exists idx_contacts_wa_followup_stage
  on public.contacts (business_id, wa_followup_stage)
  where source = 'whatsapp' and (opted_out is distinct from true) and (trial_registered is distinct from true);

