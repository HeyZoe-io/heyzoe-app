-- חד-פעמי: נרמול session_id של WhatsApp מ-+972 ל-972 (בלי +)
-- טבלאות: messages, conversations, paused_sessions, conversions
-- פורmat ישן: wa_{phone_number_id}_+972585300108
-- פורmat קנוני: wa_{phone_number_id}_972585300108
--
-- הרצה: Supabase SQL Editor (לבדיקה — הרץ קודם רק את בלוק «תצוגה מקדימה»)
-- לא מריץ אוטומטית מהאפליקציה.

-- ── תצוגה מקדימה (SELECT בלבד) ────────────────────────────────────────────────
-- כמה שורות יושפעו?
select 'messages' as tbl, count(*) as rows_to_update
from public.messages
where session_id ~ '^wa_[^_]+_\+972'
union all
select 'conversations', count(*)
from public.conversations
where session_id ~ '^wa_[^_]+_\+972'
union all
select 'paused_sessions', count(*)
from public.paused_sessions
where session_id ~ '^wa_[^_]+_\+972'
union all
select 'conversions', count(*)
from public.conversions
where session_id ~ '^wa_[^_]+_\+972';

-- דוגמאות לפני/אחרי (עד 10 מכל טבלה)
select 'messages' as tbl, session_id as before,
  regexp_replace(session_id, '^(wa_[^_]+)_\+(972.+)$', '\1_\2') as after
from public.messages
where session_id ~ '^wa_[^_]+_\+972'
limit 10;

select 'conversations' as tbl, session_id as before,
  regexp_replace(session_id, '^(wa_[^_]+)_\+(972.+)$', '\1_\2') as after
from public.conversations
where session_id ~ '^wa_[^_]+_\+972'
limit 10;

select 'paused_sessions' as tbl, session_id as before,
  regexp_replace(session_id, '^(wa_[^_]+)_\+(972.+)$', '\1_\2') as after
from public.paused_sessions
where session_id ~ '^wa_[^_]+_\+972'
limit 10;

select 'conversions' as tbl, session_id as before,
  regexp_replace(session_id, '^(wa_[^_]+)_\+(972.+)$', '\1_\2') as after
from public.conversions
where session_id ~ '^wa_[^_]+_\+972'
limit 10;

-- כפילויות אפשריות ב-paused_sessions אחרי נרמול (שורה ישנה + חדשה לאותו session)
select ps.business_slug, ps.session_id, count(*) as cnt
from (
  select business_slug,
    regexp_replace(session_id, '^(wa_[^_]+)_\+(972.+)$', '\1_\2') as session_id
  from public.paused_sessions
  where session_id ~ '^wa_[^_]+_\+972'
     or session_id ~ '^wa_[^_]+_972'
) ps
group by ps.business_slug, ps.session_id
having count(*) > 1;

-- ── עדכון (הרץ רק אחרי שבדקת את התצוגה המקדימה) ─────────────────────────────
-- begin;

update public.messages
set session_id = regexp_replace(session_id, '^(wa_[^_]+)_\+(972.+)$', '\1_\2')
where session_id ~ '^wa_[^_]+_\+972';

update public.conversations
set session_id = regexp_replace(session_id, '^(wa_[^_]+)_\+(972.+)$', '\1_\2')
where session_id ~ '^wa_[^_]+_\+972';

update public.paused_sessions
set session_id = regexp_replace(session_id, '^(wa_[^_]+)_\+(972.+)$', '\1_\2')
where session_id ~ '^wa_[^_]+_\+972';

update public.conversions
set session_id = regexp_replace(session_id, '^(wa_[^_]+)_\+(972.+)$', '\1_\2')
where session_id ~ '^wa_[^_]+_\+972';

-- איחוד כפילויות ב-paused_sessions: שומרים את הרשומה עם paused_until המאוחר ביותר
delete from public.paused_sessions p
where p.id in (
  select id
  from (
    select id,
      row_number() over (
        partition by business_slug, session_id
        order by paused_until desc, id desc
      ) as rn
    from public.paused_sessions
  ) ranked
  where ranked.rn > 1
);

-- commit;
-- rollback;  -- אם רצית לבדוק בתוך טרנזקציה בלי לשמור

-- ── אימות אחרי ───────────────────────────────────────────────────────────────
select 'messages' as tbl, count(*) as remaining_plus972
from public.messages
where session_id ~ '^wa_[^_]+_\+972'
union all
select 'conversations', count(*)
from public.conversations
where session_id ~ '^wa_[^_]+_\+972'
union all
select 'paused_sessions', count(*)
from public.paused_sessions
where session_id ~ '^wa_[^_]+_\+972'
union all
select 'conversions', count(*)
from public.conversions
where session_id ~ '^wa_[^_]+_\+972';
