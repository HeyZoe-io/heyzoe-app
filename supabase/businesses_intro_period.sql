-- חודש ראשון ב-₪5 (מבצע לחגים). NULL = לא במבצע.
-- בטוח להריץ שוב אחרי כשל. לא ממלא plan_price ישן (499/349) לכל העסקים.
alter table public.businesses
  add column if not exists plan_price numeric;

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

-- מי שכבר שילם במבצע: לפי payment_sessions.plan = intro, לא לפי plan_price.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payment_sessions'
      and column_name = 'plan'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'businesses'
      and column_name = 'email'
  ) then
    update public.businesses b
    set intro_period_ends_at = b.created_at + interval '1 month'
    where b.intro_period_ends_at is null
      and b.intro_full_price_at is null
      and b.created_at > now() - interval '40 days'
      and exists (
        select 1
        from public.payment_sessions ps
        where lower(ps.plan) = 'intro'
          and lower(ps.email) = lower(b.email)
      );
  end if;
end $$;
