-- =====================================================================
-- pending_oct8_all.sql
-- Every SQL migration from Oct 6 on (main, hardening-oct8,
-- hardening-oct8-summary-cron, fix/due-today-seed) that is not yet in
-- production, checked against the production schema on Oct 8 2026 11:10 IDT.
--
-- Paste the whole file into the Supabase SQL Editor and run it once.
-- Each part is its own DO block. If a part fails, its block rolls back as a
-- whole (no half-applied part), a WARNING names it, and the next part still runs.
-- Every part is idempotent: running this file again is a no-op.
-- The last statement returns one row per check. Every row should show ok = true.
--
-- Order: 1 needs the status checks from arbox_sync_log_status_sending.sql
-- (already applied). 2-6 are independent tables/columns/indexes.
-- No part sends anything or calls an external API.
-- =====================================================================


-- ---------------------------------------------------------------------
-- PART 1 - source: supabase/send_outcome_unknown_status.sql
-- Separates a Meta error ('failed', retried up to 3) from an unknown send
-- outcome ('unknown', never retried).
--   a) sync logs: re-adds the single-column status check with 'unknown',
--      only where such a check already exists. A table whose existing rows do
--      not fit keeps its old check (inner block rolls back) and gets a NOTICE.
--   b) scheduled_template_sends: attempts column + status check with 'unknown'.
--   c) scheduled_marketing_template_sends / manual_bulk_queued_sends: attempts.
-- ---------------------------------------------------------------------
do $part1$
declare
  tbl text;
  r record;
  had_check boolean;
begin
  foreach tbl in array array[
    'arbox_cancellation_sync_log',
    'arbox_attendance_gap_sync_log',
    'arbox_freeze_created_sync_log',
    'arbox_freeze_ending_sync_log',
    'arbox_nth_workout_sync_log',
    'arbox_lost_lead_sync_log',
    'arbox_trial_reminder_sync_log',
    'arbox_post_trial_followup_sync_log',
    'arbox_missed_class_sync_log',
    'arbox_days_in_club_sync_log',
    'arbox_lead_status_change_sync_log',
    'arbox_birthday_sync_log',
    'arbox_sessions_expiring_sync_log',
    'arbox_credit_refusal_sync_log',
    'arbox_expiring_sync_log',
    'arbox_trial_sync_log',
    'arbox_new_lead_sync_log',
    'arbox_first_paid_purchase_log',
    'arbox_trial_booking_confirm_log',
    'arbox_trial_attended_sync_log'
  ]
  loop
    if to_regclass('public.' || tbl) is null then
      continue;
    end if;
    begin
      had_check := false;
      for r in
        select c.conname
        from pg_constraint c
        join pg_attribute a
          on a.attrelid = c.conrelid
         and a.attnum = any (c.conkey)
        where c.conrelid = ('public.' || tbl)::regclass
          and c.contype = 'c'
          and a.attname = 'status'
          and array_length(c.conkey, 1) = 1
      loop
        had_check := true;
        execute format('alter table public.%I drop constraint %I', tbl, r.conname);
      end loop;
      if had_check then
        execute format(
          'alter table public.%I add constraint %I check (status in (%L, %L, %L, %L, %L, %L, %L, %L, %L))',
          tbl,
          tbl || '_status_check',
          'pending',
          'seeded',
          'sent',
          'abandoned',
          'no_phone',
          'skipped',
          'sending',
          'failed',
          'unknown'
        );
      end if;
    exception
      when others then
        raise notice 'PART 1 skip %: %', tbl, sqlerrm;
    end;
  end loop;

  alter table public.scheduled_template_sends
    add column if not exists attempts integer not null default 0;
  alter table public.scheduled_template_sends
    drop constraint if exists scheduled_template_sends_status_check;
  alter table public.scheduled_template_sends
    add constraint scheduled_template_sends_status_check
    check (status in ('pending', 'sending', 'sent', 'canceled', 'failed', 'unknown'));

  if to_regclass('public.scheduled_marketing_template_sends') is not null then
    alter table public.scheduled_marketing_template_sends
      add column if not exists attempts integer not null default 0;
  end if;
  if to_regclass('public.manual_bulk_queued_sends') is not null then
    alter table public.manual_bulk_queued_sends
      add column if not exists attempts integer not null default 0;
  end if;

  raise notice 'PART 1 send_outcome_unknown_status: ok';
exception
  when others then
    raise warning 'PART 1 send_outcome_unknown_status FAILED, rolled back: %', sqlerrm;
end
$part1$;


-- ---------------------------------------------------------------------
-- PART 2 - source: supabase/incoming_lead_fallback_send_log.sql
-- Claim + 24h dedup for /api/leads/incoming fallback template (Sanga / Zapier).
-- One opening template per business + phone per day / 24h.
-- ---------------------------------------------------------------------
do $part2$
begin
  create table if not exists public.incoming_lead_fallback_send_log (
    business_id bigint not null references public.businesses (id) on delete cascade,
    phone text not null,
    sent_day date not null,
    template_name text not null default '',
    status text not null default 'sending',
    attempts integer not null default 0,
    reason text null,
    processed_at timestamptz not null default now(),
    primary key (business_id, phone, sent_day)
  );

  create index if not exists idx_incoming_lead_fallback_send_log_recent
    on public.incoming_lead_fallback_send_log (business_id, phone, processed_at desc);

  alter table public.incoming_lead_fallback_send_log enable row level security;

  raise notice 'PART 2 incoming_lead_fallback_send_log: ok';
exception
  when others then
    raise warning 'PART 2 incoming_lead_fallback_send_log FAILED, rolled back: %', sqlerrm;
end
$part2$;


-- ---------------------------------------------------------------------
-- PART 3 - source: supabase/contacts_leave_request.sql
-- contacts.leave_request_at / leave_request_kind (cancel / freeze / complaint
-- handoff). Retention triggers skip the contact for 14 days.
-- Backfills the last 14 days from messages: a closed-playbook cancellation /
-- freeze / complaint reply within 2 minutes after a human_requested event in
-- the same session. Only moves leave_request_at forward.
-- ---------------------------------------------------------------------
do $part3$
begin
  alter table public.contacts add column if not exists leave_request_at timestamptz null default null;
  alter table public.contacts add column if not exists leave_request_kind text null default null;

  create index if not exists idx_contacts_leave_request_at
    on public.contacts (business_id, leave_request_at)
    where leave_request_at is not null;

  with leave as (
    select
      m.business_slug,
      m.session_id,
      m.created_at,
      substring(m.model_used from '^closed_playbook_(?:fact_|catalog_)?(cancellation|freeze|complaint)(?:#|$)') as kind
    from public.messages m
    where m.role = 'assistant'
      and m.created_at >= now() - interval '14 days'
      and m.model_used ~ '^closed_playbook_(fact_|catalog_)?(cancellation|freeze|complaint)(#|$)'
      and exists (
        select 1
        from public.messages e
        where e.business_slug = m.business_slug
          and e.session_id = m.session_id
          and e.role = 'event'
          and e.model_used = 'human_requested'
          and e.created_at between m.created_at - interval '2 minutes' and m.created_at
      )
  ),
  latest as (
    select distinct on (business_slug, session_id) business_slug, session_id, created_at, kind
    from leave
    order by business_slug, session_id, created_at desc
  )
  update public.contacts c
  set leave_request_at = l.created_at,
      leave_request_kind = l.kind
  from latest l
  join public.businesses b on b.slug = l.business_slug
  where c.business_id = b.id
    and c.phone = regexp_replace(l.session_id, '^wa_[^_]+_', '')
    and (c.leave_request_at is null or c.leave_request_at < l.created_at);

  raise notice 'PART 3 contacts_leave_request: ok';
exception
  when others then
    raise warning 'PART 3 contacts_leave_request FAILED, rolled back: %', sqlerrm;
end
$part3$;


-- ---------------------------------------------------------------------
-- PART 4 - source: supabase/arbox_purchase_same_day_claim.sql
-- One purchase template per Arbox user + sale day + rule, across runs and
-- parallel workers (Tights sales 104660498 + 104660523, Oct 7).
-- ---------------------------------------------------------------------
do $part4$
begin
  create table if not exists public.arbox_purchase_same_day_claim (
    business_id bigint not null references public.businesses (id) on delete cascade,
    user_id text not null,
    sale_date date not null,
    trigger_id text not null,
    sale_id bigint not null,
    created_at timestamptz not null default now(),
    primary key (business_id, user_id, sale_date, trigger_id)
  );

  alter table public.arbox_purchase_same_day_claim enable row level security;

  raise notice 'PART 4 arbox_purchase_same_day_claim: ok';
exception
  when others then
    raise warning 'PART 4 arbox_purchase_same_day_claim FAILED, rolled back: %', sqlerrm;
end
$part4$;


-- ---------------------------------------------------------------------
-- PART 5 - source: supabase/arbox_daily_run_status.sql
-- Per business / Israel day / slot: did the Arbox daily run finish.
-- The 20:50 job ?slot=evening&pass=retry reruns only 'incomplete' businesses.
-- ---------------------------------------------------------------------
do $part5$
begin
  create table if not exists public.arbox_daily_run_status (
    business_id bigint not null references public.businesses (id) on delete cascade,
    run_day date not null,
    slot text not null default 'morning',
    status text not null default 'ok',
    reason text null,
    attempts integer not null default 1,
    pass text not null default 'main',
    updated_at timestamptz not null default now(),
    primary key (business_id, run_day, slot)
  );

  create index if not exists idx_arbox_daily_run_status_day_slot
    on public.arbox_daily_run_status (run_day, slot, status);

  create index if not exists idx_arbox_daily_run_status_incomplete_recent
    on public.arbox_daily_run_status (updated_at desc)
    where status = 'incomplete';

  alter table public.arbox_daily_run_status enable row level security;

  raise notice 'PART 5 arbox_daily_run_status: ok';
exception
  when others then
    raise warning 'PART 5 arbox_daily_run_status FAILED, rolled back: %', sqlerrm;
end
$part5$;


-- ---------------------------------------------------------------------
-- PART 6 - sources: supabase/arbox_retention_cap_sync_log_indexes.sql
--                   supabase/marketing_calendar_feed_index.sql
-- Index-only files. PostgREST cannot show indexes, so these could not be
-- confirmed. "if not exists" makes this a no-op when they are already there.
-- ---------------------------------------------------------------------
do $part6$
begin
  create index if not exists idx_arbox_lost_lead_sync_log_biz_status_processed
    on public.arbox_lost_lead_sync_log (business_id, status, processed_at);

  create index if not exists idx_arbox_missed_class_sync_log_biz_status_processed
    on public.arbox_missed_class_sync_log (business_id, status, processed_at);

  create index if not exists idx_arbox_attendance_gap_sync_log_biz_status_processed
    on public.arbox_attendance_gap_sync_log (business_id, status, processed_at);

  create index if not exists idx_mf_sessions_calendar_call_status
    on public.marketing_flow_sessions (pipeline_status, next_call_at)
    where pipeline_status in ('setup_call', 'requires_call', 'human_followup')
      and next_call_at is not null;

  raise notice 'PART 6 indexes: ok';
exception
  when others then
    raise warning 'PART 6 indexes FAILED, rolled back: %', sqlerrm;
end
$part6$;


-- ---------------------------------------------------------------------
-- VERIFY - read only. Every row should show ok = true.
-- ---------------------------------------------------------------------
with status_tables(tbl) as (
  values
    ('arbox_cancellation_sync_log'), ('arbox_attendance_gap_sync_log'),
    ('arbox_freeze_created_sync_log'), ('arbox_freeze_ending_sync_log'),
    ('arbox_nth_workout_sync_log'), ('arbox_lost_lead_sync_log'),
    ('arbox_trial_reminder_sync_log'), ('arbox_post_trial_followup_sync_log'),
    ('arbox_missed_class_sync_log'), ('arbox_days_in_club_sync_log'),
    ('arbox_lead_status_change_sync_log'), ('arbox_birthday_sync_log'),
    ('arbox_sessions_expiring_sync_log'), ('arbox_credit_refusal_sync_log'),
    ('arbox_expiring_sync_log'), ('arbox_trial_sync_log'),
    ('arbox_new_lead_sync_log'), ('arbox_first_paid_purchase_log'),
    ('arbox_trial_booking_confirm_log'), ('scheduled_template_sends')
),
checks as (
  select 'PART 1 status check has unknown: ' || s.tbl as item,
         exists (
           select 1
           from pg_constraint c
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
           where c.conrelid = to_regclass('public.' || s.tbl)
             and c.contype = 'c'
             and a.attname = 'status'
             and array_length(c.conkey, 1) = 1
             and pg_get_constraintdef(c.oid) like '%unknown%'
         ) as ok
  from status_tables s
  where to_regclass('public.' || s.tbl) is not null
  union all
  select 'PART 1 scheduled_template_sends.attempts',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'scheduled_template_sends' and column_name = 'attempts')
  union all
  select 'PART 1 scheduled_marketing_template_sends.attempts',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'scheduled_marketing_template_sends' and column_name = 'attempts')
  union all
  select 'PART 1 manual_bulk_queued_sends.attempts',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'manual_bulk_queued_sends' and column_name = 'attempts')
  union all
  select 'PART 2 incoming_lead_fallback_send_log', to_regclass('public.incoming_lead_fallback_send_log') is not null
  union all
  select 'PART 3 contacts.leave_request_at',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'contacts' and column_name = 'leave_request_at')
  union all
  select 'PART 3 contacts.leave_request_kind',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'contacts' and column_name = 'leave_request_kind')
  union all
  select 'PART 4 arbox_purchase_same_day_claim', to_regclass('public.arbox_purchase_same_day_claim') is not null
  union all
  select 'PART 5 arbox_daily_run_status', to_regclass('public.arbox_daily_run_status') is not null
  union all
  select 'PART 6 ' || i.name, to_regclass('public.' || i.name) is not null
  from (values
    ('idx_arbox_lost_lead_sync_log_biz_status_processed'),
    ('idx_arbox_missed_class_sync_log_biz_status_processed'),
    ('idx_arbox_attendance_gap_sync_log_biz_status_processed'),
    ('idx_mf_sessions_calendar_call_status')
  ) as i(name)
)
select item, ok from checks order by ok, item;
