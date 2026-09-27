-- שיחות שנפתחו: מספר ייחודי שזואי דיברה איתו.
-- last_zoe_reply_at = הפעם האחרונה שזואי שלחה הודעה (לא נציג, לא תבנית).
-- DEFAULT null — שורות קיימות לא נשברות. שיחה בלי מענה של זואי נשארת null ולא נספרת.
--
-- להריץ פעם אחת ב-Supabase SQL editor. לא cron.
-- IO חד-פעמי: אגרגציה על הודעות assistant של זואי + עדכון contacts תואמים.
-- אחר כך הדשבורד סופר באינדקס (business_id, last_zoe_reply_at) בלי לסרוק messages.
-- מודלים שלא נספרים: wa_business_app, manual_handoff, lead_template, starter_quota_cap_notice.

alter table public.contacts
  add column if not exists last_zoe_reply_at timestamptz;

comment on column public.contacts.last_zoe_reply_at is
  'Last Zoe assistant reply to this phone. Null when Zoe never spoke (including chats handled only while Zoe was off).';

create index if not exists idx_contacts_business_last_zoe_reply
  on public.contacts (business_id, last_zoe_reply_at)
  where last_zoe_reply_at is not null;

with raw as (
  select
    lower(business_slug) as business_slug,
    regexp_replace(substring(session_id from '^wa_[^_]+_(.+)$'), '\D', '', 'g') as digits,
    created_at
  from public.messages
  where role = 'assistant'
    and coalesce(model_used, '') <> ''
    and model_used not in ('wa_business_app', 'manual_handoff', 'lead_template', 'starter_quota_cap_notice')
    and session_id ~ '^wa_[^_]+_.+'
),
zoe_replies as (
  select
    business_slug,
    case
      when digits ~ '^0' then '972' || substring(digits from 2)
      else digits
    end as phone_key,
    max(created_at) as max_at
  from raw
  where digits <> ''
  group by 1, 2
)
update public.contacts c
set last_zoe_reply_at = z.max_at
from zoe_replies z
join public.businesses b on lower(b.slug) = z.business_slug
where c.business_id = b.id
  and (
    case
      when regexp_replace(c.phone, '\D', '', 'g') ~ '^0'
        then '972' || substring(regexp_replace(c.phone, '\D', '', 'g') from 2)
      else regexp_replace(c.phone, '\D', '', 'g')
    end
  ) = z.phone_key
  and (c.last_zoe_reply_at is null or c.last_zoe_reply_at < z.max_at);
