-- SECURITY: payment_sessions contains pre-payment onboarding details (including encrypted password).
-- With RLS enabled, having a permissive SELECT policy is dangerous. We rely on service-role access only.

drop policy if exists "read own session" on public.payment_sessions;

