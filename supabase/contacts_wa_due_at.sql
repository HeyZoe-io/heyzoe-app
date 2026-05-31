-- WhatsApp: event-ish scheduling fields (reduce cron polling IO)
-- These timestamps are derived from last_contact_at + followup stage, so crons can query only due contacts.

alter table if exists public.contacts
  add column if not exists wa_next_followup_at timestamptz null;

alter table if exists public.contacts
  add column if not exists wa_no_response_due_at timestamptz null;

create or replace function public.hz_contacts_wa_recompute_due_at()
returns trigger
language plpgsql
as $$
declare
  stage integer;
begin
  -- Only for WhatsApp leads.
  if coalesce(new.source, '') <> 'whatsapp' then
    return new;
  end if;

  stage := coalesce(new.wa_followup_stage, 0);

  -- Next followup due (20m / 2h / 23h) derived from last_contact_at.
  if new.last_contact_at is null then
    new.wa_next_followup_at := null;
  elsif stage >= 3 then
    new.wa_next_followup_at := null;
  elsif stage < 1 then
    new.wa_next_followup_at := new.last_contact_at + interval '20 minutes';
  elsif stage < 2 then
    new.wa_next_followup_at := new.last_contact_at + interval '2 hours';
  else
    new.wa_next_followup_at := new.last_contact_at + interval '23 hours';
  end if;

  -- No-response due: 26 hours since last_contact_at (coarse but cheap).
  if new.last_contact_at is null or new.wa_no_response_at is not null then
    new.wa_no_response_due_at := null;
  else
    new.wa_no_response_due_at := new.last_contact_at + interval '26 hours';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_contacts_wa_recompute_due_at on public.contacts;
create trigger trg_contacts_wa_recompute_due_at
before insert or update of last_contact_at, wa_followup_stage, wa_no_response_at, source
on public.contacts
for each row
execute function public.hz_contacts_wa_recompute_due_at();

-- Indexes to support fast "due now" scans.
create index if not exists idx_contacts_wa_next_followup_due
  on public.contacts (wa_next_followup_at)
  where source = 'whatsapp'
    and wa_next_followup_at is not null
    and (opted_out is distinct from true)
    and (trial_registered is distinct from true);

create index if not exists idx_contacts_wa_no_response_due
  on public.contacts (wa_no_response_due_at)
  where source = 'whatsapp'
    and wa_no_response_due_at is not null
    and wa_no_response_at is null
    and (opted_out is distinct from true)
    and (trial_registered is distinct from true);

-- Backfill: שורות קיימות לפני הטריגר — מפעיל חישוב מחדש של wa_next_followup_at / wa_no_response_due_at
update public.contacts
set
  last_contact_at = last_contact_at,
  wa_followup_stage = coalesce(wa_followup_stage, 0)
where source = 'whatsapp'
  and last_contact_at is not null
  and (wa_next_followup_at is null or wa_no_response_due_at is null);

