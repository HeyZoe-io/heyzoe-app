-- Studio-specific Arbox profile id for manage.arboxapp.com/user-profile/{id}.
-- Distinct from contacts.arbox_user_id (global user_id — lead matching). No backfill here.

alter table if exists public.contacts
  add column if not exists arbox_profile_id text null;

comment on column public.contacts.arbox_profile_id is
  'Studio-specific Arbox profile id, parsed from searchUser profile_link. Used ONLY to build the /user-profile/ deep-link. Distinct from arbox_user_id (global user_id, used for lead matching).';
