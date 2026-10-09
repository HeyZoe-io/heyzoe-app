-- Read-only check for the behavior-rules round.
-- Edit the timestamp in params, then run in the Supabase SQL editor.
-- Does not write.
--
-- personal_route events: messages.role = 'event' and content like '[heyzoe:personal_message]%'.
--   trigger=owner_short_reply  rule 4 (short reply to a manual owner message)
--   trigger=personal_address   rule 5 (endearment or name plus a relationship signal)
--   anything else              previous (Claude [[route:personal]], or rows from before this round)
-- model_used stays wa_personal_pause so the dashboard label is unchanged.
--
-- booking_change policy replacements are assistant rows whose model base is
-- closed_playbook_fact_reschedule or class_reschedule_team_handoff
-- (the 12-hour fact, or the team handoff that replaced Claude's body).
--
-- handoffs are assistant or event rows whose model_used contains 'handoff'
-- or 'route=handoff'. A policy replacement that is also a handoff is counted in both.
--
-- answerFreeQuestion max_tokens hits are not in the database.
-- They are Vercel logs: [ai-models] max_tokens site=answerFreeQuestion
--
-- Rule 3 opener strips are not in the database.
-- They are Vercel logs: [rule3] stripped_opener with business_id and opener.

with params as (
  select timestamptz '2026-10-09 17:00:00+00' as start_at
),
personal as (
  select
    business_slug,
    (created_at at time zone 'Asia/Jerusalem')::date as day,
    case
      when content like '%trigger=owner_short_reply%' then 'rule4'
      when content like '%trigger=personal_address%' then 'rule5'
      else 'previous'
    end as trigger
  from public.messages, params
  where role = 'event'
    and content like '[heyzoe:personal_message]%'
    and created_at >= params.start_at
),
personal_counts as (
  select
    business_slug,
    day,
    count(*) filter (where trigger = 'rule4') as personal_rule4,
    count(*) filter (where trigger = 'rule5') as personal_rule5,
    count(*) filter (where trigger = 'previous') as personal_previous
  from personal
  group by business_slug, day
),
policy as (
  select
    business_slug,
    (created_at at time zone 'Asia/Jerusalem')::date as day,
    count(*) as booking_change_policy_replacements
  from public.messages, params
  where role = 'assistant'
    and created_at >= params.start_at
    and (
      model_used like 'closed_playbook_fact_reschedule%'
      or model_used like 'class_reschedule_team_handoff%'
    )
  group by business_slug, day
),
handoffs as (
  select
    business_slug,
    (created_at at time zone 'Asia/Jerusalem')::date as day,
    count(*) as handoffs
  from public.messages, params
  where created_at >= params.start_at
    and (
      model_used like '%handoff%'
      or model_used like '%route=handoff%'
    )
  group by business_slug, day
),
keys as (
  select business_slug, day from personal_counts
  union
  select business_slug, day from policy
  union
  select business_slug, day from handoffs
)
select
  keys.business_slug,
  keys.day,
  coalesce(personal_counts.personal_rule4, 0) as personal_rule4,
  coalesce(personal_counts.personal_rule5, 0) as personal_rule5,
  coalesce(personal_counts.personal_previous, 0) as personal_previous,
  coalesce(handoffs.handoffs, 0) as handoffs,
  coalesce(policy.booking_change_policy_replacements, 0) as booking_change_policy_replacements
from keys
left join personal_counts using (business_slug, day)
left join policy using (business_slug, day)
left join handoffs using (business_slug, day)
order by keys.day, keys.business_slug;
