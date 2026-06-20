-- אינדקס ל-cron/wa-status-check: לידי meta_lead_ad שלא ענו לטמפלייט תוך 6 שעות
-- הרצה ב-Supabase אחרי deploy של wa_no_response_due_at ב-leads/incoming

create index if not exists idx_contacts_meta_template_no_response_due
  on public.contacts (wa_no_response_due_at)
  where source = 'meta_lead_ad'
    and wa_no_response_due_at is not null
    and wa_no_response_at is null
    and (opted_out is distinct from true)
    and (trial_registered is distinct from true)
    and not_relevant_at is null
    and human_requested_at is null;
