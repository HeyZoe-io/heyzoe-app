-- Meta-side marketing opt-out (Stop promotions / error 131050).
-- Separate from contacts.opted_out («הסר» — stops Zoe entirely).
-- Recurring M1 audience skips if opted_out OR marketing_opted_out.
-- RUN THIS IN THE SUPABASE SQL EDITOR before deploying app code that writes this column.

alter table public.contacts
  add column if not exists marketing_opted_out boolean not null default false;

comment on column public.contacts.marketing_opted_out is
  'WhatsApp marketing preference: user_preferences stop or Graph/status 131050. Does not silence Zoe session replies.';
