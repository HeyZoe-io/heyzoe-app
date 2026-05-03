-- תיעוד תשובת חסימת מכסה חודשית (Starter): הודעה אחת לכל חודש ישראלי
alter table public.contacts
  add column if not exists starter_quota_notice_month text;

comment on column public.contacts.starter_quota_notice_month is 'YYYY-MM ישראלי שבו נשלחה הודעת מכסה חודשית ל-contact';
