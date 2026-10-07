-- Run in the Supabase SQL editor AFTER supabase/rls_lockdown_drop_client_policies.sql.
-- Each block rolls back. Nothing here is written.
--
-- Identities (user ids only, no other PII):
--   owner     2d0cc6fa-24ff-4a73-98e5-3eed39c45f73
--             a real businesses.user_id
--   employee  50f1618c-e3c1-4654-a772-052007538f39
--             a real business_users.user_id who does not own a business
--   non-member
--             none exists: every auth user is an owner or a business_users member
--             (17 users, all attached). The block below uses a synthetic sub,
--             00000000-0000-4000-8000-000000000001, which is not an auth user.
--
-- Expected after the migration:
--   anon        permission denied (42501) on every table below. Never 42P17.
--   owner       0 rows on every table. Never 42P17.
--   employee    0 rows on every table. Never 42P17.
--   non-member  0 rows on every table. Never 42P17.
--   policies    no remaining non-service_role policy on these tables.

-- anon — expected: permission denied (42501) for each table, never 42P17
begin;
set local role anon;
do $$
declare
  rel text;
  n bigint;
  rels text[] := array[
    'businesses',
    'business_users',
    'contacts',
    'messages',
    'services',
    'faqs',
    'whatsapp_channels',
    'business_call_slots',
    'Business Info',
    'notice_acknowledgments'
  ];
begin
  foreach rel in array rels loop
    begin
      execute format('select count(*) from public.%I', rel) into n;
      raise exception 'anon % returned % rows; expected permission denied', rel, n;
    exception
      when insufficient_privilege then
        raise notice 'anon % permission denied (expected)', rel;
    end;
  end loop;
end $$;
rollback;

-- owner — expected: 0 rows, no 42P17
begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"2d0cc6fa-24ff-4a73-98e5-3eed39c45f73","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', '2d0cc6fa-24ff-4a73-98e5-3eed39c45f73', true);
do $$
declare
  rel text;
  n bigint;
  rels text[] := array[
    'businesses',
    'business_users',
    'contacts',
    'messages',
    'services',
    'faqs',
    'whatsapp_channels',
    'business_call_slots',
    'Business Info',
    'notice_acknowledgments'
  ];
begin
  foreach rel in array rels loop
    execute format('select count(*) from public.%I', rel) into n;
    if n <> 0 then
      raise exception 'owner % count=%; expected 0', rel, n;
    end if;
    raise notice 'owner % count=0 (expected)', rel;
  end loop;
end $$;
rollback;

-- employee — expected: 0 rows, no 42P17
begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"50f1618c-e3c1-4654-a772-052007538f39","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', '50f1618c-e3c1-4654-a772-052007538f39', true);
do $$
declare
  rel text;
  n bigint;
  rels text[] := array[
    'businesses',
    'business_users',
    'contacts',
    'messages',
    'services',
    'faqs',
    'whatsapp_channels',
    'business_call_slots',
    'Business Info',
    'notice_acknowledgments'
  ];
begin
  foreach rel in array rels loop
    execute format('select count(*) from public.%I', rel) into n;
    if n <> 0 then
      raise exception 'employee % count=%; expected 0', rel, n;
    end if;
    raise notice 'employee % count=0 (expected)', rel;
  end loop;
end $$;
rollback;

-- non-member — no such auth user exists; synthetic sub, expected: 0 rows, no 42P17
begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$
declare
  rel text;
  n bigint;
  rels text[] := array[
    'businesses',
    'business_users',
    'contacts',
    'messages',
    'services',
    'faqs',
    'whatsapp_channels',
    'business_call_slots',
    'Business Info',
    'notice_acknowledgments'
  ];
begin
  foreach rel in array rels loop
    execute format('select count(*) from public.%I', rel) into n;
    if n <> 0 then
      raise exception 'non-member % count=%; expected 0', rel, n;
    end if;
    raise notice 'non-member % count=0 (expected)', rel;
  end loop;
end $$;
rollback;

-- non-service_role policies on the locked tables — expected: zero rows
select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'businesses',
    'business_users',
    'contacts',
    'messages',
    'services',
    'faqs',
    'whatsapp_channels',
    'business_call_slots',
    'Business Info',
    'notice_acknowledgments'
  )
  and roles::text not ilike '%service_role%'
order by tablename, policyname;
