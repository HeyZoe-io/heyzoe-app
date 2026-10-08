-- Explicit per-rule activation-seed marker (lib/rule-activation.ts ruleIdsActiveSinceActivation).
-- A rule is seeded for its current activation when seeded_at >= greatest(created_at, updated_at).
-- Replaces "the rule is new if it has no queue rows": a long-existing rule with no rows is not new.
-- Re-enable / targeting edits move updated_at, so the rule seeds again; the code then stamps seeded_at.
-- Idempotent. Until this runs the code keeps the old row check.

alter table public.template_triggers
  add column if not exists seeded_at timestamptz default null;

comment on column public.template_triggers.seeded_at is
  'Activation seed pass finished at. >= greatest(created_at, updated_at) = not a new rule.';

-- Backfill (only rows still null):
-- 1) first seed / dedup row at or after the rule's current activation, in any activation log;
-- 2) else the activation itself, for rules activated more than a day ago (long-existing rules);
-- 3) rules activated in the last day with no row stay null: they are new and seed on their next run.
do $$
declare
  t record;
begin
  create temp table if not exists _rule_first_seed (trigger_id uuid, first_at timestamptz) on commit drop;
  for t in
    select * from (values
      ('arbox_trial_reminder_sync_log', 'processed_at'),
      ('scheduled_template_sends', 'updated_at'),
      ('arbox_trial_booking_confirm_log', 'processed_at'),
      ('arbox_sessions_expiring_sync_log', 'processed_at'),
      ('arbox_birthday_sync_log', 'processed_at'),
      ('arbox_expiring_sync_log', 'processed_at')
    ) as v(tbl, col)
  loop
    if to_regclass('public.' || t.tbl) is not null
       and exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = t.tbl and column_name = t.col
       )
       and exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = t.tbl and column_name = 'trigger_id'
       )
    then
      execute format(
        'insert into _rule_first_seed (trigger_id, first_at)
           select r.id, min(l.%1$I)
             from public.%2$I l
             join public.template_triggers r on r.id::text = l.trigger_id::text
            where r.seeded_at is null
              and l.%1$I >= greatest(r.created_at, coalesce(r.updated_at, r.created_at))
            group by r.id',
        t.col, t.tbl
      );
    end if;
  end loop;

  update public.template_triggers r
     set seeded_at = coalesce(
       (select min(f.first_at) from _rule_first_seed f where f.trigger_id = r.id),
       case
         when greatest(r.created_at, coalesce(r.updated_at, r.created_at)) < now() - interval '1 day'
         then greatest(r.created_at, coalesce(r.updated_at, r.created_at))
       end
     )
   where r.seeded_at is null;
end $$;

-- Verify: rules still unseeded (should be only rules activated in the last day)
select id, business_id, trigger_type, enabled, created_at, updated_at, seeded_at
  from public.template_triggers
 where seeded_at is null
 order by greatest(created_at, coalesce(updated_at, created_at)) desc
 limit 50;

-- Sanity: no trigger may rewrite updated_at on update (seeded_at stamping would look like a re-activation)
select tgname from pg_trigger
 where tgrelid = 'public.template_triggers'::regclass and not tgisinternal;
