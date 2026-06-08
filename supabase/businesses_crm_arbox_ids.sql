-- Arbox lead source / status API ids (per business; from Arbox → Business Settings → Leads)
alter table public.businesses
  add column if not exists crm_arbox_source_id text null,
  add column if not exists crm_arbox_status_id text null;

comment on column public.businesses.crm_arbox_source_id is 'Arbox lead source_id (e.g. Zoe).';
comment on column public.businesses.crm_arbox_status_id is 'Arbox lead status_id for new leads from Zoe.';
