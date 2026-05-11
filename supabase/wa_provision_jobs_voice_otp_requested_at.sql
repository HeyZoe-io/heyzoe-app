-- Anchor time for Twilio recording search (after Meta voice OTP request succeeds).
-- Avoids picking old recordings to the same reused Twilio number from prior verifications.
alter table public.wa_provision_jobs
  add column if not exists voice_otp_requested_at timestamptz;
