-- WhatsApp: independent no-response status + daily owner email notification marker
alter table if exists public.contacts
  add column if not exists wa_no_response_at timestamptz null;

alter table if exists public.contacts
  add column if not exists no_response_notified_at timestamptz null;

create index if not exists idx_contacts_wa_no_response_pending
  on public.contacts (business_id, wa_no_response_at)
  where source = 'whatsapp'
    and wa_no_response_at is not null
    and no_response_notified_at is null;

create index if not exists idx_contacts_wa_no_response_candidates
  on public.contacts (business_id, last_contact_at)
  where source = 'whatsapp'
    and wa_no_response_at is null
    and (opted_out is distinct from true)
    and (trial_registered is distinct from true);
