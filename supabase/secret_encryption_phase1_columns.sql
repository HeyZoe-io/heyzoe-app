-- APPLY MANUALLY IN SUPABASE SQL EDITOR - Phase 1 of secret encryption
-- Applied. These three nullable columns are the live schema.
-- Additive only. No defaults, no data changes, no drops, no RLS changes.
-- Plaintext columns stay. Re-running the adds is a no-op; the comments are catalog notes.
-- twilio_sid and facebook_pixel_id are not secrets and are not encrypted.

alter table public.businesses
  add column if not exists crm_api_key_enc text null,
  add column if not exists conversions_api_token_enc text null,
  add column if not exists leads_webhook_secret_enc text null;

comment on column public.businesses.crm_api_key_enc is
  'AES-256-GCM ciphertext of crm_api_key. Null until backfill. Plaintext column is kept.';

comment on column public.businesses.conversions_api_token_enc is
  'AES-256-GCM ciphertext of conversions_api_token. Null until backfill. Plaintext column is kept.';

comment on column public.businesses.leads_webhook_secret_enc is
  'AES-256-GCM ciphertext of leads_webhook_secret. Null until backfill. Plaintext column is kept.';
