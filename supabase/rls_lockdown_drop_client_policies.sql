-- APPLY MANUALLY IN SUPABASE SQL EDITOR - code on main does not depend on this
--
-- Closes anon and authenticated table access in the public schema.
-- RLS stays enabled. No replacement policies are created.
-- Every service_role_bypass policy is left as it is.
-- notice_ack_can_access_business() is left in place (unused once its policies are dropped).
-- Does not touch the auth, storage, or realtime schemas, and does not revoke service_role.

begin;

drop policy if exists "Business users can access business info" on public."Business Info";

drop policy if exists business_call_slots_select_member on public.business_call_slots;
drop policy if exists business_call_slots_write_member on public.business_call_slots;

drop policy if exists members_see_own_business on public.business_users;

drop policy if exists "Public businesses are viewable by everyone" on public.businesses;
drop policy if exists business_users_can_see_business on public.businesses;
drop policy if exists businesses_delete_own on public.businesses;
drop policy if exists businesses_insert_own on public.businesses;
drop policy if exists businesses_select_own on public.businesses;
drop policy if exists businesses_update_own on public.businesses;
drop policy if exists users_see_own_business on public.businesses;

drop policy if exists "Business users can access contacts" on public.contacts;

drop policy if exists "Public faqs are viewable by everyone" on public.faqs;
drop policy if exists faqs_delete_own on public.faqs;
drop policy if exists faqs_insert_own on public.faqs;
drop policy if exists faqs_select_own on public.faqs;
drop policy if exists faqs_update_own on public.faqs;

drop policy if exists members_see_messages on public.messages;

drop policy if exists "Public services are viewable by everyone" on public.services;
drop policy if exists members_see_services on public.services;
drop policy if exists services_delete_own on public.services;
drop policy if exists services_insert_own on public.services;
drop policy if exists services_select_own on public.services;
drop policy if exists services_update_own on public.services;

drop policy if exists "Business users can access whatsapp channels" on public.whatsapp_channels;

drop policy if exists notice_acknowledgments_insert_own on public.notice_acknowledgments;
drop policy if exists notice_acknowledgments_select_business on public.notice_acknowledgments;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- New tables in this project are created from the SQL editor, which runs as postgres.
alter default privileges for role postgres in schema public revoke all on tables from anon;

commit;
