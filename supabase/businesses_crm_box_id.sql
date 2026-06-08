-- Arbox branch / Client ID (sent as X-Box-Id header)
alter table public.businesses
  add column if not exists crm_box_id text null;

comment on column public.businesses.crm_box_id is 'CRM branch Client ID (Arbox X-Box-Id header). Null for CRMs that do not require it.';
