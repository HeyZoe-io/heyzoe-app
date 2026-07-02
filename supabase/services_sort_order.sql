-- סדר מוצרים בדשבורד (גרירה) + תפריט שירותים בווטסאפ
alter table public.services
  add column if not exists sort_order int not null default 0;

create index if not exists idx_services_business_sort
  on public.services (business_id, sort_order, id);

comment on column public.services.sort_order is 'סדר תצוגה (0=ראשון) — נשמר מהדשבורד בגרירה';
