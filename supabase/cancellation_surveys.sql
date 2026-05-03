-- שאלון ביטול מנוי (נשמר לפני עדכון תאריכי ביטול בעסק)
create table if not exists public.cancellation_surveys (
  id uuid primary key default gen_random_uuid(),
  business_id integer references public.businesses (id) on delete set null,
  business_slug text,
  reason text not null,
  reason_detail text,
  created_at timestamptz not null default now()
);

create index if not exists idx_cancellation_surveys_created_at
  on public.cancellation_surveys (created_at desc);

create index if not exists idx_cancellation_surveys_business_id
  on public.cancellation_surveys (business_id);

comment on table public.cancellation_surveys is 'תשובות שאלון ביטול לפני ביצוע הביטול ב-API';
