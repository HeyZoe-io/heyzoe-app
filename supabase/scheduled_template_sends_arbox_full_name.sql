-- Arbox full name captured when a template is queued, so the drain greets
-- with the same first name as the immediate trigger path.
-- Null until a row is enqueued after this runs. The app still sends if the
-- column is missing: it looks the name up, then falls back to the contact card.
-- RUN THIS IN THE SUPABASE SQL EDITOR.

alter table public.scheduled_template_sends
  add column if not exists arbox_full_name text null;

comment on column public.scheduled_template_sends.arbox_full_name is
  'Arbox full name at enqueue time. The drain prefers this over the contact card.';
