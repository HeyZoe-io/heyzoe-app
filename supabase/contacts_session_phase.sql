-- WhatsApp sales-flow: coarse session phase + step index on contacts
-- Postgres: CHECK is a separate constraint, not on the same line as ADD COLUMN.

alter table if exists public.contacts
  add column if not exists session_phase text not null default 'opening';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'contacts_session_phase_check'
  ) then
    alter table public.contacts
      add constraint contacts_session_phase_check
      check (session_phase in ('opening', 'warmup', 'cta', 'registered'));
  end if;
end $$;

alter table if exists public.contacts
  add column if not exists flow_step integer not null default 0;
