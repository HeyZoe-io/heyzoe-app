-- Analytics: «לידים חדשים» = מי שפתח פלואו מכירה מול זואי (לא כל שיחה נכנסת).
-- DEFAULT null — שורות קיימות לא נשברות. חובה להריץ ב-Supabase.
-- IO: אנליטיקס נשאר COUNT ממדויק (business_id + sales_flow_started_at), בלי סריקת messages.

alter table if exists public.contacts
  add column if not exists sales_flow_started_at timestamptz null;

comment on column public.contacts.sales_flow_started_at is
  'First time this contact started a WhatsApp sales flow with Zoe. Null = inbound chat only, not a sales-flow lead.';

create index if not exists idx_contacts_sales_flow_started_at
  on public.contacts (business_id, sales_flow_started_at)
  where sales_flow_started_at is not null;

-- Backfill: contacts that already progressed in / completed a sales flow.
-- Does not scan messages. Opening-only chats stay null (correct).
update public.contacts
set sales_flow_started_at = coalesce(trial_registered_at, created_at)
where sales_flow_started_at is null
  and (
    trial_registered = true
    or coalesce(session_phase, 'opening') is distinct from 'opening'
    or coalesce(flow_step, 0) > 0
    or coalesce(wa_followup_stage, 0) > 0
  );
