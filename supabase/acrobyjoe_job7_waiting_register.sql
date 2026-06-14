-- One-off: job #7 reached status=done without Meta /register (Cloud API activation).
-- Requires wa_provision_jobs_waiting_register.sql applied first.
-- After running: cron-job.org wa-provision will POST /register for phone_number_id 1144781695390397.
--
-- Env (Vercel): WHATSAPP_REGISTRATION_PIN — 6-digit PIN for Meta register API (default 123456).

UPDATE public.wa_provision_jobs
SET
  status = 'waiting_register',
  updated_at = now(),
  last_error = null
WHERE id = 7
  AND meta_phone_number_id = '1144781695390397';
