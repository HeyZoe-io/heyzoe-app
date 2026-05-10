-- Sales flow: כפתורים שכבר נוצלו בהנעת פעולה (למעט ניסיון), ולא לחזור על הזמנה לעקוב באינסטגרם

alter table if exists public.contacts
  add column if not exists sf_clicked_cta_kinds text[] not null default '{}';

alter table if exists public.contacts
  add column if not exists instagram_follow_prompt_sent boolean not null default false;

comment on column public.contacts.sf_clicked_cta_kinds is 'WhatsApp HeyZoe: סוגי CTA שנלחצו (schedule/memberships/address) — כפתור ניסיון נשאר לפי allowTrial.';
comment on column public.contacts.instagram_follow_prompt_sent is 'נשלחה כבר הזמנה לעקוב באינסטגרם במסלול — לא לחזור שוב באותם ניסוחים.';
