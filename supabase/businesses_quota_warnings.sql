-- דגלים למניעת כפל מיילי התראת מכסה שיחות (מתאפסים ב-cron חודשי)
alter table public.businesses
  add column if not exists quota_warning_20_sent_at timestamptz,
  add column if not exists quota_warning_5_sent_at timestamptz,
  add column if not exists quota_limit_sent_at timestamptz,
  add column if not exists quota_pro_warning_sent_at timestamptz;

comment on column public.businesses.quota_warning_20_sent_at is 'נשלח מייל starter כשנוצלו ~80 שיחות החודש';
comment on column public.businesses.quota_warning_5_sent_at is 'נשלח מייל starter כשנוצלו ~95 שיחות החודש';
comment on column public.businesses.quota_limit_sent_at is 'נשלח מייל starter בהגעה ל-100 שיחות החודש';
comment on column public.businesses.quota_pro_warning_sent_at is 'נשלח מייל אופס על ~450 שיחות Pro החודש';
