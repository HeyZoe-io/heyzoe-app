-- ביטול מנוי: תאריך בקשה + תוקף (אחרי המרווח המחודשת ~30 יום)
-- הרצה חד-פעמית אם עדיין לא הופעל:
alter table public.businesses
  add column if not exists cancellation_requested_at timestamptz,
  add column if not exists cancellation_effective_at timestamptz;

create index if not exists idx_businesses_cancellation_effective
  on public.businesses (cancellation_effective_at)
  where cancellation_effective_at is not null;

comment on column public.businesses.cancellation_requested_at is 'When the user requested subscription cancellation (dashboard)';
comment on column public.businesses.cancellation_effective_at is 'Access paid until this date; then should be cut off (cron)';
