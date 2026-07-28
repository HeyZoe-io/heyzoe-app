-- Per-lead throttle for Arbox trial WhatsApp notify (once per ~2 days).

alter table public.contacts
  add column if not exists arbox_trial_last_notified_at timestamptz null;

comment on column public.contacts.arbox_trial_last_notified_at is
  'Updated only after a real Arbox-trial notify attempt (in-window WA or future template path). Used to enforce once-per-~2-days per lead; seed must not set this.';
