-- APPLY MANUALLY IN SUPABASE SQL EDITOR - Phase 1 of secret encryption
--
-- Additive only: one nullable text column. No defaults, no data changes, no drops, no RLS changes.
-- whatsapp_channels has no token, secret, or key column in the live schema, so nothing is added there.
-- Plaintext businesses.crm_api_key stays. Phase 2 fills crm_api_key_enc.

alter table public.businesses
  add column if not exists crm_api_key_enc text null;

comment on column public.businesses.crm_api_key_enc is
  'AES-256-GCM ciphertext of crm_api_key. Null until the Phase 2 backfill. Plaintext column is kept.';
