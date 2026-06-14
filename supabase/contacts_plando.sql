-- Plan Do CRM: contact + activity record linkage (HeyZoe WhatsApp / leads)
alter table if exists public.contacts
  add column if not exists plando_contact_id text null;

alter table if exists public.contacts
  add column if not exists plando_record_id text null;

comment on column public.contacts.plando_contact_id is 'contact_id returned by Plan Do POST /contacts/crm_form.';
comment on column public.contacts.plando_record_id is 'record_id returned by Plan Do POST /contacts/crm_form; sent back to update the same activity record.';
