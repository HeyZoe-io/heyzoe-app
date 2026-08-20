-- =============================================================================
-- acrobyjoe: delete conversations from stale WhatsApp lines; keep current line
-- =============================================================================
-- Scope: slug = 'acrobyjoe' ONLY. No schema changes. No other businesses.
-- Run manually in Supabase Studio → SQL Editor. Do NOT auto-execute from CI.
--
-- Current line = newest active whatsapp_channels row for the business
-- (same rule as the owner dashboard / pickDefaultActiveChannel).
-- Expected live Meta phone_number_id as of 2026-06: 1144781695390397
-- (display +972 3 382 3805).
--
-- IO: prefix deletes on messages.session_id (idx_messages_session) + slug filter.
-- Does NOT delete contacts (shared across lines).
--
-- BEFORE running: review the PRE-CHECK queries. Confirm current_pnid is the live line.
-- AFTER running: review VERIFICATION.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PRE-CHECK (read-only — run first, save output)
-- -----------------------------------------------------------------------------

SELECT id, slug, name, whatsapp_number, is_active
FROM public.businesses
WHERE lower(slug) = 'acrobyjoe';

SELECT id, phone_number_id, phone_display, is_active, provisioning_status, created_at
FROM public.whatsapp_channels
WHERE lower(coalesce(business_slug, '')) = 'acrobyjoe'
   OR business_id = (SELECT id FROM public.businesses WHERE lower(slug) = 'acrobyjoe' LIMIT 1)
ORDER BY created_at DESC, id DESC;

-- Messages per WhatsApp line (session_id = wa_{phone_number_id}_{leadPhone})
SELECT
  substring(m.session_id from '^wa_([^_]+)_') AS phone_number_id,
  count(*) AS message_count,
  count(DISTINCT m.session_id) AS session_count,
  min(m.created_at) AS first_at,
  max(m.created_at) AS last_at
FROM public.messages m
WHERE lower(m.business_slug) = 'acrobyjoe'
  AND m.session_id LIKE 'wa_%'
GROUP BY 1
ORDER BY message_count DESC;

-- -----------------------------------------------------------------------------
-- CLEANUP (transaction)
-- -----------------------------------------------------------------------------

BEGIN;

CREATE TEMP TABLE acrobyjoe_current_pnid ON COMMIT DROP AS
SELECT c.phone_number_id
FROM public.whatsapp_channels c
WHERE lower(coalesce(c.business_slug, '')) = 'acrobyjoe'
   OR c.business_id = (SELECT id FROM public.businesses WHERE lower(slug) = 'acrobyjoe' LIMIT 1)
ORDER BY (c.is_active IS TRUE) DESC, c.created_at DESC NULLS LAST, c.id DESC
LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM acrobyjoe_current_pnid WHERE coalesce(phone_number_id, '') <> '') THEN
    RAISE EXCEPTION 'acrobyjoe: no WhatsApp channel found — aborting delete';
  END IF;
END $$;

CREATE TEMP TABLE acrobyjoe_old_pnids ON COMMIT DROP AS
SELECT c.phone_number_id
FROM public.whatsapp_channels c
WHERE (
    lower(coalesce(c.business_slug, '')) = 'acrobyjoe'
    OR c.business_id = (SELECT id FROM public.businesses WHERE lower(slug) = 'acrobyjoe' LIMIT 1)
  )
  AND c.phone_number_id IS DISTINCT FROM (SELECT phone_number_id FROM acrobyjoe_current_pnid);

-- Keep current channel active; deactivate stale/test rows so they cannot reappear
UPDATE public.whatsapp_channels c
SET is_active = true,
    provisioning_status = 'active'
WHERE c.phone_number_id = (SELECT phone_number_id FROM acrobyjoe_current_pnid)
  AND (
    lower(coalesce(c.business_slug, '')) = 'acrobyjoe'
    OR c.business_id = (SELECT id FROM public.businesses WHERE lower(slug) = 'acrobyjoe' LIMIT 1)
  );

UPDATE public.whatsapp_channels c
SET is_active = false
WHERE (
    lower(coalesce(c.business_slug, '')) = 'acrobyjoe'
    OR c.business_id = (SELECT id FROM public.businesses WHERE lower(slug) = 'acrobyjoe' LIMIT 1)
  )
  AND c.phone_number_id IN (SELECT phone_number_id FROM acrobyjoe_old_pnids);

-- WhatsApp threads that are not the current line (includes orphaned pnids
-- whose channel row was already deleted). Prefix LIKE uses idx_messages_session.
DELETE FROM public.messages m
WHERE lower(m.business_slug) = 'acrobyjoe'
  AND m.session_id LIKE 'wa_%'
  AND m.session_id NOT LIKE 'wa_' || (SELECT phone_number_id FROM acrobyjoe_current_pnid) || '_%';

DELETE FROM public.paused_sessions p
WHERE lower(p.business_slug) = 'acrobyjoe'
  AND p.session_id LIKE 'wa_%'
  AND p.session_id NOT LIKE 'wa_' || (SELECT phone_number_id FROM acrobyjoe_current_pnid) || '_%';

DELETE FROM public.conversations conv
WHERE conv.business_id = (SELECT id FROM public.businesses WHERE lower(slug) = 'acrobyjoe' LIMIT 1)
  AND conv.session_id LIKE 'wa_%'
  AND conv.session_id NOT LIKE 'wa_' || (SELECT phone_number_id FROM acrobyjoe_current_pnid) || '_%';

DELETE FROM public.conversions cnv
WHERE lower(cnv.business_slug) = 'acrobyjoe'
  AND cnv.session_id LIKE 'wa_%'
  AND cnv.session_id NOT LIKE 'wa_' || (SELECT phone_number_id FROM acrobyjoe_current_pnid) || '_%';

COMMIT;

-- -----------------------------------------------------------------------------
-- VERIFICATION
-- -----------------------------------------------------------------------------

SELECT id, phone_number_id, phone_display, is_active, provisioning_status, created_at
FROM public.whatsapp_channels
WHERE lower(coalesce(business_slug, '')) = 'acrobyjoe'
   OR business_id = (SELECT id FROM public.businesses WHERE lower(slug) = 'acrobyjoe' LIMIT 1)
ORDER BY created_at DESC, id DESC;

SELECT
  substring(m.session_id from '^wa_([^_]+)_') AS phone_number_id,
  count(*) AS message_count,
  count(DISTINCT m.session_id) AS session_count
FROM public.messages m
WHERE lower(m.business_slug) = 'acrobyjoe'
  AND m.session_id LIKE 'wa_%'
GROUP BY 1
ORDER BY message_count DESC;
