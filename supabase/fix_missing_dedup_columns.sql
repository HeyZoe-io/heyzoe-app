-- Dedup columns the trial_booked sender expects, plus a channel on the primary key
-- so a free message and a template are separate claims.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR before trial_booked sends are turned back on.
-- Idempotent. One transaction. Existing sent rows stay sent, so nothing is resent.
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

commit;
