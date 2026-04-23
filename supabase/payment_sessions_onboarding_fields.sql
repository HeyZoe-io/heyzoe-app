alter table if exists public.payment_sessions
  add column if not exists plan text,
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists phone text,
  add column if not exists studio_name text,
  add column if not exists business_type text,
  add column if not exists description text,
  add column if not exists address text,
  add column if not exists password_ciphertext text;

