-- Extend partial index for template no-response cron to include site_lead
-- (opening-template leads from website form webhook).
-- Safe to re-run: drop + create.

drop index if exists public.idx_contacts_meta_template_no_response_due;

create index if not exists idx_contacts_meta_template_no_response_due
  on public.contacts (wa_no_response_due_at)
  where source in ('meta_lead_ad', 'site_lead')
    and wa_no_response_due_at is not null
    and wa_no_response_at is null
    and (opted_out is distinct from true)
    and (trial_registered is distinct from true)
    and not_relevant_at is null
    and human_requested_at is null;
