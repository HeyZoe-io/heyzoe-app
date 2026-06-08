-- CRM integration credentials (per business)
alter table public.businesses
  add column if not exists crm_type text null,
  add column if not exists crm_api_key text null;

comment on column public.businesses.crm_type is 'CRM slug: arbox | physikal | boostapp | plan_do (null = disabled).';
comment on column public.businesses.crm_api_key is 'API key / token for the selected CRM (server-side only).';
