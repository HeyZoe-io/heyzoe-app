-- Rename legacy incoming-lead trigger types → incoming_lead (safe if none exist).
-- Resolver still accepts site_lead / campaign_lead until this runs.
-- App enforces at most one incoming_lead row per business (API).

update public.template_triggers
set
  trigger_type = 'incoming_lead',
  updated_at = timezone('utc', now())
where trigger_type in ('site_lead', 'campaign_lead');
