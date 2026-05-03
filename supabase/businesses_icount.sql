-- iCount לקוח / סטטוס ביטול הוראת קבע (בזמן לחיצת ביטול)
alter table public.businesses
  add column if not exists icount_client_id text,
  add column if not exists icount_hk_cancelled boolean not null default false;

comment on column public.businesses.icount_client_id is 'iCount client_id — נדרש ל-hk/get_list ול-hk/cancel';
comment on column public.businesses.icount_hk_cancelled is 'true אחרי hk/cancel מוצלח בזמן בקשת ביטול';
