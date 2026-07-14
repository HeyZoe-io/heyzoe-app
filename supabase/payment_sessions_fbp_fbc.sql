-- Meta fbp/fbc attribution (additive, nullable, no default).
-- Captured client-side (landing page / onboarding) from the _fbp/_fbc cookies (or fbclid),
-- persisted on save-session, then read by /api/onboarding/save-session (InitiateCheckout)
-- and /api/icount-ipn (Purchase) to send action_source:"website" Conversions API events.
alter table if exists public.payment_sessions
  add column if not exists fbp text,
  add column if not exists fbc text;
