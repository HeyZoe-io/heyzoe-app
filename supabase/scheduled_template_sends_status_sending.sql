-- Lets Stage C claim a queued template as 'sending' before the Graph call.
-- Until this runs, the drain logs the check failure and sends without the claim.
-- A row left at 'sending' is not selected again (the drain only takes pending).

alter table public.scheduled_template_sends
  drop constraint if exists scheduled_template_sends_status_check;

alter table public.scheduled_template_sends
  add constraint scheduled_template_sends_status_check
  check (status in ('pending', 'sending', 'sent', 'canceled', 'failed'));
