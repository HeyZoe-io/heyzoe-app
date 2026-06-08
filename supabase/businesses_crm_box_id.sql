-- Arbox location_id (branch Client ID in dashboard settings)
alter table public.businesses
  add column if not exists crm_box_id text null;

comment on column public.businesses.crm_box_id is 'Arbox location_id (branch Client ID). Null for CRMs that do not require it.';
