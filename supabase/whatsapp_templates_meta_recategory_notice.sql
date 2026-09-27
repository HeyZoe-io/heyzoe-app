-- Meta webhook template_category_update: remember UTILITY → MARKETING so the
-- automations page can show a one-time popup. No cron. One indexed read per
-- /templates page view; the webhook updates these columns on the same row write.
-- Run in the Supabase SQL editor.

alter table public.whatsapp_templates
  add column if not exists meta_recategorized_from text,
  add column if not exists meta_recategorized_at timestamptz,
  add column if not exists category_notice_dismissed_at timestamptz;

comment on column public.whatsapp_templates.meta_recategorized_from is
  'Previous Meta category when a template we sent as UTILITY was recategorized. UTILITY means the automations popup may show.';

comment on column public.whatsapp_templates.meta_recategorized_at is
  'When Meta last moved this template from UTILITY to MARKETING.';

comment on column public.whatsapp_templates.category_notice_dismissed_at is
  'Owner closed the automations popup (X or confirm) for this recategorization. Null = still show.';

create index if not exists idx_whatsapp_templates_utility_marketing_notice
  on public.whatsapp_templates (business_id)
  where meta_recategorized_from = 'UTILITY'
    and category = 'MARKETING'
    and category_notice_dismissed_at is null;
