-- Dedup columns the trial_booked sender expects, plus a channel on the primary key
-- so a free message and a template are separate claims.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR before trial_booked sends are turned back on.
-- Idempotent. One transaction. Existing sent rows stay sent, so nothing is resent.
-- The closing DO block checks columns, status values, keys, and the no-response
-- RPC. Any failure raises and rolls the whole transaction back.
-- Scheduling is not a Vercel cron.

begin;

alter table public.arbox_trial_booking_confirm_log
  add column if not exists confirm_status text;

alter table public.arbox_trial_booking_confirm_log
  add column if not exists template_status text;

alter table public.arbox_trial_booking_confirm_log
  add column if not exists channel text;

-- Sent rows stay sent. Every other settled status stays terminal.
-- Pending stays pending and still loses the next claim, so it is not resent.
update public.arbox_trial_booking_confirm_log
set
  confirm_status = case
    when status = 'sent' then 'sent'
    when status = 'pending' then 'pending'
    else 'skipped'
  end
where confirm_status is null;

update public.arbox_trial_booking_confirm_log
set
  template_status = case
    when status = 'sent' then 'sent'
    when status = 'pending' then 'pending'
    else 'skipped'
  end
where template_status is null;

update public.arbox_trial_booking_confirm_log
set channel = case
  when trigger_id = '00000000-0000-0000-0000-000000000000' then 'free'
  else 'template'
end
where channel is null;

alter table public.arbox_trial_booking_confirm_log
  alter column confirm_status set default 'pending';

alter table public.arbox_trial_booking_confirm_log
  alter column template_status set default 'pending';

alter table public.arbox_trial_booking_confirm_log
  alter column channel set default 'template';

alter table public.arbox_trial_booking_confirm_log
  alter column confirm_status set not null;

alter table public.arbox_trial_booking_confirm_log
  alter column template_status set not null;

alter table public.arbox_trial_booking_confirm_log
  alter column channel set not null;

alter table public.arbox_trial_booking_confirm_log
  drop constraint if exists arbox_trial_booking_confirm_log_confirm_status_check;

alter table public.arbox_trial_booking_confirm_log
  add constraint arbox_trial_booking_confirm_log_confirm_status_check
  check (confirm_status in ('pending', 'sent', 'skipped', 'failed'));

alter table public.arbox_trial_booking_confirm_log
  drop constraint if exists arbox_trial_booking_confirm_log_template_status_check;

alter table public.arbox_trial_booking_confirm_log
  add constraint arbox_trial_booking_confirm_log_template_status_check
  check (template_status in ('pending', 'sent', 'skipped', 'failed'));

alter table public.arbox_trial_booking_confirm_log
  drop constraint if exists arbox_trial_booking_confirm_log_channel_check;

alter table public.arbox_trial_booking_confirm_log
  add constraint arbox_trial_booking_confirm_log_channel_check
  check (channel in ('free', 'template'));

alter table public.arbox_trial_booking_confirm_log
  drop constraint if exists arbox_trial_booking_confirm_log_status_check;

alter table public.arbox_trial_booking_confirm_log
  add constraint arbox_trial_booking_confirm_log_status_check
  check (status in ('pending', 'seeded', 'sent', 'skipped', 'abandoned', 'no_phone', 'failed'));

do $$
declare
  cols text;
begin
  select string_agg(a.attname, ',' order by k.ord)
    into cols
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  join unnest(c.conkey) with ordinality as k(attnum, ord) on true
  join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
  where n.nspname = 'public'
    and t.relname = 'arbox_trial_booking_confirm_log'
    and c.contype = 'p';

  if cols is distinct from 'business_id,trigger_id,user_id,class_date,class_time,class_name,channel' then
    alter table public.arbox_trial_booking_confirm_log
      drop constraint if exists arbox_trial_booking_confirm_log_pkey;
    alter table public.arbox_trial_booking_confirm_log
      add primary key (business_id, trigger_id, user_id, class_date, class_time, class_name, channel);
  end if;
end $$;

comment on table public.arbox_trial_booking_confirm_log is
  'One claim per trial booking, rule, and channel (free or template). PK business_id+trigger_id+user_id+class_date+class_time+class_name+channel. A sent or failed claim is not resent.';

-- Immediate companion claims use status=claimed so the pending drain does not send them again.
alter table public.scheduled_template_sends
  drop constraint if exists scheduled_template_sends_status_check;

alter table public.scheduled_template_sends
  add constraint scheduled_template_sends_status_check
  check (status in ('pending', 'sent', 'canceled', 'failed', 'claimed'));

-- Self-check. A raise here aborts the transaction, so a partial migration cannot commit.
do $assert$
declare
  cols text;
  def text;
  tbl text;
  migrated text[] := array[
    'arbox_trial_sync_log',
    'arbox_post_trial_followup_sync_log',
    'arbox_attendance_gap_sync_log',
    'arbox_missed_class_sync_log',
    'arbox_trial_reminder_sync_log',
    'arbox_freeze_created_sync_log',
    'arbox_freeze_ending_sync_log',
    'arbox_birthday_sync_log',
    'arbox_expiring_sync_log',
    'arbox_sessions_expiring_sync_log',
    'arbox_credit_refusal_sync_log',
    'arbox_first_paid_purchase_log',
    'arbox_new_lead_sync_log',
    'arbox_class_cancelled_customer_notify_log',
    'arbox_lost_lead_sync_log',
    'arbox_cancellation_sync_log'
  ];
  required_columns text[] := array[
    'arbox_trial_booking_confirm_log.confirm_status',
    'arbox_trial_booking_confirm_log.template_status',
    'arbox_trial_booking_confirm_log.channel',
    'arbox_trial_booking_confirm_log.trigger_id',
    'arbox_trial_booking_confirm_log.status',
    'contacts.arbox_is_member',
    'scheduled_template_sends.status',
    'scheduled_template_sends.dedup_key',
    'scheduled_template_sends.last_error',
    'scheduled_template_sends.trigger_id',
    'arbox_birthday_sync_log.contact_id',
    'arbox_birthday_sync_log.user_id',
    'arbox_trial_attended_sync_log.contact_id',
    'arbox_trial_attended_sync_log.user_id',
    'arbox_missed_class_sync_log.contact_id',
    'arbox_missed_class_sync_log.user_id',
    'arbox_attendance_gap_sync_log.contact_id',
    'arbox_attendance_gap_sync_log.user_id',
    'arbox_expiring_sync_log.contact_id',
    'arbox_sessions_expiring_sync_log.contact_id',
    'arbox_sessions_expiring_sync_log.user_id',
    'arbox_credit_refusal_sync_log.contact_id'
  ];
  col_name text;
begin
  if to_regprocedure('public.no_response_open_candidates(bigint, timestamptz, integer)') is null then
    raise exception 'missing RPC public.no_response_open_candidates(bigint, timestamptz, integer)';
  end if;

  foreach col_name in array required_columns
  loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = split_part(col_name, '.', 1)
        and column_name = split_part(col_name, '.', 2)
    ) then
      raise exception 'missing column %', col_name;
    end if;
  end loop;

  select string_agg(a.attname, ',' order by k.ord)
    into cols
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  join unnest(c.conkey) with ordinality as k(attnum, ord) on true
  join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
  where n.nspname = 'public'
    and t.relname = 'arbox_trial_booking_confirm_log'
    and c.contype = 'p';

  if cols is distinct from 'business_id,trigger_id,user_id,class_date,class_time,class_name,channel' then
    raise exception
      'arbox_trial_booking_confirm_log primary key is %, expected business_id,trigger_id,user_id,class_date,class_time,class_name,channel',
      coalesce(cols, '(none)');
  end if;

  foreach tbl in array migrated
  loop
    select string_agg(a.attname, ',' order by k.ord)
      into cols
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join unnest(c.conkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
    where n.nspname = 'public'
      and t.relname = tbl
      and c.contype = 'p';

    if cols is null or (',' || cols || ',') not like '%,trigger_id,%' then
      raise exception '% primary key % is missing trigger_id', tbl, coalesce(cols, '(none)');
    end if;
  end loop;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'scheduled_template_sends'
      and c.contype in ('u', 'p')
      and (
        select string_agg(a.attname, ',' order by k.ord)
        from unnest(c.conkey) with ordinality as k(attnum, ord)
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
      ) = 'dedup_key'
  ) then
    raise exception 'scheduled_template_sends is missing unique (dedup_key)';
  end if;

  select pg_get_constraintdef(oid)
    into def
  from pg_constraint
  where conname = 'arbox_trial_booking_confirm_log_confirm_status_check';
  if def is null
     or def not like '%pending%'
     or def not like '%sent%'
     or def not like '%skipped%'
     or def not like '%failed%'
  then
    raise exception 'confirm_status check is %', coalesce(def, '(missing)');
  end if;

  select pg_get_constraintdef(oid)
    into def
  from pg_constraint
  where conname = 'arbox_trial_booking_confirm_log_template_status_check';
  if def is null
     or def not like '%pending%'
     or def not like '%sent%'
     or def not like '%skipped%'
     or def not like '%failed%'
  then
    raise exception 'template_status check is %', coalesce(def, '(missing)');
  end if;

  select pg_get_constraintdef(oid)
    into def
  from pg_constraint
  where conname = 'arbox_trial_booking_confirm_log_channel_check';
  if def is null or def not like '%free%' or def not like '%template%' then
    raise exception 'channel check is %', coalesce(def, '(missing)');
  end if;

  select pg_get_constraintdef(oid)
    into def
  from pg_constraint
  where conname = 'arbox_trial_booking_confirm_log_status_check';
  if def is null or def not like '%failed%' or def not like '%sent%' or def not like '%pending%' then
    raise exception 'confirm log status check is %', coalesce(def, '(missing)');
  end if;

  select pg_get_constraintdef(oid)
    into def
  from pg_constraint
  where conname = 'scheduled_template_sends_status_check';
  if def is null
     or def not like '%pending%'
     or def not like '%sent%'
     or def not like '%canceled%'
     or def not like '%failed%'
     or def not like '%claimed%'
  then
    raise exception 'scheduled_template_sends status check is %', coalesce(def, '(missing)');
  end if;
end
$assert$;

commit;
