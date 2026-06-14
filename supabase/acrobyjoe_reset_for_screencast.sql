-- =============================================================================
-- acrobyjoe: reset WhatsApp connection state for Embedded Signup screencast
-- =============================================================================
-- Scope: business_id = 1 / slug = 'acrobyjoe' ONLY. No other businesses touched.
-- Does NOT touch translated content (Prompt 10), Meta API, or schema migrations.
-- Run manually in Supabase Studio → SQL Editor. Do NOT auto-execute from CI.
--
-- BEFORE running: review the PRE-CHECK queries below.
-- AFTER running: review the VERIFICATION queries at the bottom.
--
-- OPTIONAL (see end): payment_sessions row — required for /onboarding/success
-- to load when using ?email=... (currently empty in production).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PRE-CHECK (read-only — run first, save output)
-- -----------------------------------------------------------------------------

SELECT id, slug, name, email, waba_id, status, plan, is_active
FROM public.businesses
WHERE id = 1;

SELECT id, business_id, business_slug, phone_number_id, phone_display,
       is_active, provisioning_status, twilio_sid, created_at
FROM public.whatsapp_channels
WHERE business_id = 1
ORDER BY created_at DESC;

SELECT id, business_id, business_slug, status, attempts, last_error,
       phone_e164, meta_phone_number_id, twilio_sid, created_at, updated_at
FROM public.wa_provision_jobs
WHERE business_id = 1
ORDER BY created_at DESC
LIMIT 10;

SELECT id, email, slug, ready, created_at
FROM public.payment_sessions
WHERE slug = 'acrobyjoe'
   OR email ILIKE '%joe%'
ORDER BY created_at DESC
LIMIT 10;

-- -----------------------------------------------------------------------------
-- RESET (transaction)
-- -----------------------------------------------------------------------------

BEGIN;

-- א. השבתת ערוץ WhatsApp קיים (שומר היסטוריה, לא DELETE)
UPDATE public.whatsapp_channels
SET
  is_active = false,
  provisioning_status = 'failed'
WHERE business_id = 1;

-- ב. וידוא ש-waba_id ריק (idempotent)
UPDATE public.businesses
SET
  waba_id = '',
  updated_at = now()
WHERE id = 1
  AND (waba_id IS NULL OR waba_id != '');

-- ג. job חדש ב-awaiting_waba — רק אם אין job פתוח (לא done/failed)
INSERT INTO public.wa_provision_jobs (
  business_id,
  business_slug,
  business_name,
  status,
  created_at,
  updated_at
)
SELECT
  1,
  'acrobyjoe',
  'Acro by Joe',
  'awaiting_waba',
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1
  FROM public.wa_provision_jobs
  WHERE business_id = 1
    AND status NOT IN ('done', 'failed')
);

COMMIT;

-- -----------------------------------------------------------------------------
-- VERIFICATION (run after COMMIT)
-- -----------------------------------------------------------------------------

SELECT id, business_slug, status, created_at, updated_at
FROM public.wa_provision_jobs
WHERE business_id = 1
ORDER BY created_at DESC
LIMIT 5;

SELECT id, phone_number_id, phone_display, is_active, provisioning_status
FROM public.whatsapp_channels
WHERE business_id = 1
ORDER BY created_at DESC;

SELECT id, slug, waba_id, email, status, is_active
FROM public.businesses
WHERE id = 1;

-- -----------------------------------------------------------------------------
-- OPTIONAL — נדרש ל-/onboarding/success?email=...
-- -----------------------------------------------------------------------------
-- הדף ממתין ל-payment_sessions.ready=true (poll /api/check-payment-ready).
-- נכון ליום ההכנה: אין שורות payment_sessions ל-acrobyjoe.
-- businesses.email גם null — השתמשי באימייל Auth של בעל העסק (ראה הוראות).
--
-- החליפי את האימייל למי שתשתמשי בו ב-URL, והריצי בנפרד אם צריך:
--
-- INSERT INTO public.payment_sessions (email, slug, ready)
-- VALUES ('liornativ@hotmail.com', 'acrobyjoe', true);
