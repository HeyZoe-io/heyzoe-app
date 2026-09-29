-- דשבורד אדמין סופר שיחות שנפתחו לפי last_zoe_reply_at בלי business_id.
-- האינדקס הקיים (business_id, last_zoe_reply_at) לא משרת את הסינון הזה.
-- בטוח להריץ שוב. לא משנה שורות קיימות.
create index if not exists idx_contacts_last_zoe_reply_at
  on public.contacts (last_zoe_reply_at)
  where last_zoe_reply_at is not null;
