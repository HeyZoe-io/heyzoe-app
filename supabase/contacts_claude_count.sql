-- Contacts: track Claude usage per contact for rate limiting / abuse prevention
alter table if exists public.contacts
  add column if not exists claude_message_count integer not null default 0;

create index if not exists idx_contacts_business_phone on public.contacts(business_id, phone);

