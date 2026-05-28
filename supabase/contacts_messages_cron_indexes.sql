-- Performance: cron jobs that poll WhatsApp followups/status should avoid sequential scans.

-- Used by wa-followups cron (pre-filter candidates before per-session message lookups).
create index if not exists idx_contacts_wa_followups_due
  on public.contacts (wa_followup_stage, last_contact_at)
  where source = 'whatsapp'
    and wa_no_response_at is null
    and (opted_out is distinct from true)
    and (trial_registered is distinct from true)
    and last_contact_at is not null;

-- Used by wa-status-check cron (no-response marking) to scan due candidates efficiently.
create index if not exists idx_contacts_wa_no_response_candidates_last_contact
  on public.contacts (last_contact_at)
  where source = 'whatsapp'
    and wa_no_response_at is null
    and (opted_out is distinct from true)
    and (trial_registered is distinct from true)
    and last_contact_at is not null;

