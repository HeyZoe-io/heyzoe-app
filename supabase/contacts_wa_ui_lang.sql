-- WhatsApp UI language for this lead (he/en/ru). Empty = business default.
-- Set when inbound script is detected so the built sales flow (buttons included)
-- continues in the same language. Scheduling is the WhatsApp webhook, not a cron.

alter table if exists public.contacts
  add column if not exists wa_ui_lang text not null default '';

comment on column public.contacts.wa_ui_lang is
  'WhatsApp lead UI language: he, en, or ru. Empty uses the business content language.';
