-- Several rules of one trigger type. Each sync-log primary key gains trigger_id
-- so a handled event is not sent again by a second rule.
--
-- Backfill copies every existing log row onto EVERY template_triggers row of
-- that type which has a template name, including disabled rules. A second rule
-- that never fired must still see recent lookback events as already handled.
-- Rows whose business has no such rule stay on the sentinel
-- 00000000-0000-0000-0000-000000000000, which never equals a real rule id.
--
-- missed_class and missed_trial share one log with no kind column: each row is
-- copied onto every live rule of BOTH types.
-- attendance_gap copies only onto rules whose delay_days equals the log tier.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR before deploying the app code.
-- Idempotent and one transaction: re-running drops and recreates each primary
-- key, inserts only rows that are still missing, and leaves sentinels that
-- already have a real copy deleted.
--
-- incoming_lead / site_lead / campaign_lead do not use a sync-log table.
-- Their dedup key already includes trigger_id (scheduled_template_sends).
-- arbox_future_booking_snapshot keeps its old primary key. Per-rule sends
-- live in arbox_class_cancelled_customer_notify_log.

begin;

create or replace function pg_temp.copy_sentinel_rows(
  p_table text,
  p_type_match text,
  p_identity text[]
) returns void
language plpgsql
as $fn$
declare
  data_cols text;
  log_cols text;
  ident_pred text;
  sql text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
         string_agg('log.' || quote_ident(column_name), ', ' order by ordinal_position)
    into data_cols, log_cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = p_table
    and column_name <> 'trigger_id';

  if data_cols is null then
    raise exception 'sync log table % is missing', p_table;
  end if;

  select string_agg(format('x.%I is not distinct from log.%I', col, col), ' and ')
    into ident_pred
  from unnest(p_identity) as col;

  sql := format($q$
    insert into public.%I (trigger_id, %s)
    select t.id, %s
    from public.%I log
    join public.template_triggers t
      on t.business_id = log.business_id
     and t.template_name is not null
     and btrim(t.template_name) <> ''
     and (%s)
    where log.trigger_id = '00000000-0000-0000-0000-000000000000'
      and not exists (
        select 1
        from public.%I x
        where x.business_id = log.business_id
          and x.trigger_id = t.id
          and %s
      )
  $q$, p_table, data_cols, log_cols, p_table, p_type_match, p_table, ident_pred);

  execute sql;
end
$fn$;

create or replace function pg_temp.drop_copied_sentinels(
  p_table text,
  p_identity text[]
) returns void
language plpgsql
as $fn$
declare
  ident_pred text;
  sql text;
begin
  select string_agg(format('kept.%I is not distinct from log.%I', col, col), ' and ')
    into ident_pred
  from unnest(p_identity) as col;

  sql := format($q$
    delete from public.%I as log
    where log.trigger_id = '00000000-0000-0000-0000-000000000000'
      and exists (
        select 1
        from public.%I kept
        where kept.business_id = log.business_id
          and kept.trigger_id <> '00000000-0000-0000-0000-000000000000'
          and %s
      )
  $q$, p_table, p_table, ident_pred);

  execute sql;
end
$fn$;

create or replace function pg_temp.rekey_sync_log(
  p_table text,
  p_type_match text,
  p_identity text[],
  p_pk_cols text
) returns void
language plpgsql
as $fn$
begin
  execute format(
    'alter table public.%I add column if not exists trigger_id uuid not null default %L',
    p_table,
    '00000000-0000-0000-0000-000000000000'
  );
  execute format('alter table public.%I drop constraint if exists %I', p_table, p_table || '_pkey');
  perform pg_temp.copy_sentinel_rows(p_table, p_type_match, p_identity);
  perform pg_temp.drop_copied_sentinels(p_table, p_identity);
  execute format('alter table public.%I add primary key (%s)', p_table, p_pk_cols);
end
$fn$;

select pg_temp.rekey_sync_log(
  'arbox_trial_sync_log',
  't.trigger_type = ''purchase''',
  array['sale_id'],
  'business_id, sale_id, trigger_id'
);

select pg_temp.rekey_sync_log(
  'arbox_post_trial_followup_sync_log',
  't.trigger_type = case when log.outcome = ''registered'' then ''registered_after_trial'' else ''not_registered_after_trial'' end',
  array['user_id', 'class_date'],
  'business_id, trigger_id, user_id, class_date'
);

select pg_temp.rekey_sync_log(
  'arbox_attendance_gap_sync_log',
  't.trigger_type = ''attendance_gap'' and t.delay_days = log.tier',
  array['user_id', 'variant', 'gap_start_date', 'tier'],
  'business_id, trigger_id, user_id, variant, gap_start_date, tier'
);

select pg_temp.rekey_sync_log(
  'arbox_missed_class_sync_log',
  't.trigger_type in (''missed_class'', ''missed_trial'')',
  array['user_id', 'class_date', 'class_time', 'class_name'],
  'business_id, trigger_id, user_id, class_date, class_time, class_name'
);

select pg_temp.rekey_sync_log(
  'arbox_trial_reminder_sync_log',
  't.trigger_type = ''trial_reminder''',
  array['user_id', 'class_date', 'class_time', 'class_name'],
  'business_id, trigger_id, user_id, class_date, class_time, class_name'
);

select pg_temp.rekey_sync_log(
  'arbox_freeze_created_sync_log',
  't.trigger_type = ''freeze_created''',
  array['membership_hold_id'],
  'business_id, trigger_id, membership_hold_id'
);

select pg_temp.rekey_sync_log(
  'arbox_freeze_ending_sync_log',
  't.trigger_type = case when log.variant = ''booked'' then ''freeze_ending_booked'' else ''freeze_ending_unbooked'' end',
  array['membership_hold_id', 'end_suspend_ymd'],
  'business_id, trigger_id, membership_hold_id, end_suspend_ymd'
);

select pg_temp.rekey_sync_log(
  'arbox_birthday_sync_log',
  't.trigger_type = case when log.birthday_year >= 1000000 then ''birthday_former'' else ''birthday'' end',
  array['user_id', 'birthday_year'],
  'business_id, trigger_id, user_id, birthday_year'
);

select pg_temp.rekey_sync_log(
  'arbox_expiring_sync_log',
  't.trigger_type = ''membership_expiring''',
  array['membership_user_id', 'end_date'],
  'business_id, trigger_id, membership_user_id, end_date'
);

select pg_temp.rekey_sync_log(
  'arbox_sessions_expiring_sync_log',
  't.trigger_type = ''sessions_expiring''',
  array['user_id', 'start_date', 'end_date'],
  'business_id, trigger_id, user_id, start_date, end_date'
);

select pg_temp.rekey_sync_log(
  'arbox_credit_refusal_sync_log',
  't.trigger_type = ''credit_refusal''',
  array['transaction_id'],
  'business_id, trigger_id, transaction_id'
);

select pg_temp.rekey_sync_log(
  'arbox_first_paid_purchase_log',
  't.trigger_type = ''first_paid_purchase''',
  array['user_id'],
  'business_id, trigger_id, user_id'
);

select pg_temp.rekey_sync_log(
  'arbox_new_lead_sync_log',
  't.trigger_type = ''arbox_new_lead''',
  array['lead_id'],
  'business_id, trigger_id, lead_id'
);

select pg_temp.rekey_sync_log(
  'arbox_trial_booking_confirm_log',
  't.trigger_type = ''trial_booked''',
  array['user_id', 'class_date', 'class_time', 'class_name'],
  'business_id, trigger_id, user_id, class_date, class_time, class_name'
);

create table if not exists public.arbox_class_cancelled_customer_notify_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  trigger_id uuid not null,
  schedule_id text not null,
  user_id text not null,
  status text not null,
  processed_at timestamptz not null default now(),
  primary key (business_id, trigger_id, schedule_id, user_id)
);

insert into public.arbox_class_cancelled_customer_notify_log (
  business_id, trigger_id, schedule_id, user_id, status, processed_at
)
select
  snap.business_id,
  t.id,
  snap.schedule_id,
  snap.user_id,
  snap.notify_status,
  coalesce(snap.notified_at, now())
from public.arbox_future_booking_snapshot snap
join public.template_triggers t
  on t.business_id = snap.business_id
 and t.trigger_type = 'class_cancelled_customer'
 and t.template_name is not null
 and btrim(t.template_name) <> ''
where snap.notify_status is not null
  and not exists (
    select 1
    from public.arbox_class_cancelled_customer_notify_log x
    where x.business_id = snap.business_id
      and x.trigger_id = t.id
      and x.schedule_id = snap.schedule_id
      and x.user_id = snap.user_id
  );

insert into public.arbox_class_cancelled_customer_notify_log (
  business_id, trigger_id, schedule_id, user_id, status, processed_at
)
select
  snap.business_id,
  '00000000-0000-0000-0000-000000000000',
  snap.schedule_id,
  snap.user_id,
  snap.notify_status,
  coalesce(snap.notified_at, now())
from public.arbox_future_booking_snapshot snap
where snap.notify_status is not null
  and not exists (
    select 1
    from public.template_triggers t
    where t.business_id = snap.business_id
      and t.trigger_type = 'class_cancelled_customer'
      and t.template_name is not null
      and btrim(t.template_name) <> ''
  )
  and not exists (
    select 1
    from public.arbox_class_cancelled_customer_notify_log x
    where x.business_id = snap.business_id
      and x.trigger_id = '00000000-0000-0000-0000-000000000000'
      and x.schedule_id = snap.schedule_id
      and x.user_id = snap.user_id
  );

grant select, insert, update, delete
  on public.arbox_class_cancelled_customer_notify_log
  to service_role;

alter table public.arbox_class_cancelled_customer_notify_log
  enable row level security;

commit;
