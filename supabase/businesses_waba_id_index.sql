-- Partial index on businesses.waba_id for fast PARTNER_ADDED webhook lookups.
-- Excludes empty defaults (default value is '' for backward compatibility).

CREATE INDEX IF NOT EXISTS idx_businesses_waba_id
  ON public.businesses(waba_id)
  WHERE waba_id != '';

COMMENT ON INDEX idx_businesses_waba_id IS
  'Partial index for PARTNER_ADDED webhook lookup. Excludes empty defaults.';
