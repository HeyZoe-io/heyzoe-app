-- חודש ראשון ב-₪5 (מבצע לחגים). NULL = לא במבצע.
-- יש להריץ ב-Supabase לפני שהקרוון והאדמין מסתמכים על העמודות.
alter table public.businesses
  add column if not exists intro_period_ends_at timestamptz;

alter table public.businesses
  add column if not exists intro_reminder_sent_at timestamptz;

alter table public.businesses
  add column if not exists intro_full_price_at timestamptz;

comment on column public.businesses.intro_period_ends_at is
  'סוף חודש המבצע (₪5). כל עוד עתידי והמעבר למחיר מלא לא סומן — העסק במחיר מוזל.';
comment on column public.businesses.intro_reminder_sent_at is
  'מתי נשלח מייל האדמין, 3 ימים לפני סוף חודש ה-₪5. NULL = עדיין לא נשלח.';
comment on column public.businesses.intro_full_price_at is
  'מתי סומן באדמין שהלקוח עבר ל-Starter או Pro במחיר מלא.';

create index if not exists idx_businesses_intro_reminder_due
  on public.businesses (intro_period_ends_at)
  where intro_period_ends_at is not null
    and intro_reminder_sent_at is null
    and intro_full_price_at is null;

-- לקוחות שכבר שילמו ₪5 לפני העמודה (רק premium במחיר 5, מהחודש האחרון).
update public.businesses
set intro_period_ends_at = created_at + interval '1 month'
where plan_price = 5
  and plan = 'premium'
  and intro_period_ends_at is null
  and intro_full_price_at is null
  and created_at > now() - interval '40 days';
