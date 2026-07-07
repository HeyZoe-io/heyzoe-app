-- יום חיוב חודשי (1–28) — נקבע ב-IPN ראשון; משמש לחישוב cancellation_effective_at
alter table public.businesses
  add column if not exists billing_anchor_day smallint;

alter table public.businesses
  drop constraint if exists businesses_billing_anchor_day_check;

alter table public.businesses
  add constraint businesses_billing_anchor_day_check
  check (billing_anchor_day is null or (billing_anchor_day between 1 and 28));

comment on column public.businesses.billing_anchor_day is 'יום החיוב החודשי, נגזר מיום התשלום הראשון';
