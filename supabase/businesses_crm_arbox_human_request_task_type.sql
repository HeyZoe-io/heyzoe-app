-- Arbox task type to create on human-agent request (per business).
-- Empty/null → keep existing note-only CRM write.
alter table public.businesses
  add column if not exists crm_arbox_human_request_task_type_id text null default null;

comment on column public.businesses.crm_arbox_human_request_task_type_id is
  'Arbox task_type_id to create on human_requested. Null = note only.';
