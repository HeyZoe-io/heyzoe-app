-- «הסר» או «הפסקת הודעות הקידום» — לא לתזמן פולואפ שיחה.
-- הקרון מסנן גם בלי הקובץ הזה. אחרי ההרצה, הודעה נכנסת לא מתזמנת מחדש.
-- RUN THIS IN THE SUPABASE SQL EDITOR.

create or replace function public.hz_contacts_wa_recompute_due_at()
returns trigger
language plpgsql
as $$
declare
  stage integer;
begin
  if coalesce(new.source, '') <> 'whatsapp' then
    return new;
  end if;

  if new.not_relevant_at is not null
     or new.human_requested_at is not null
     or new.opted_out is true
     or new.marketing_opted_out is true then
    new.wa_next_followup_at := null;
    new.wa_no_response_due_at := null;
    return new;
  end if;

  stage := coalesce(new.wa_followup_stage, 0);

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
before insert or update of last_contact_at, wa_followup_stage, wa_no_response_at, source, not_relevant_at, human_requested_at, opted_out, marketing_opted_out
on public.contacts
for each row
execute function public.hz_contacts_wa_recompute_due_at();

update public.contacts
set wa_next_followup_at = null
where wa_next_followup_at is not null
  and (opted_out is true or marketing_opted_out is true);
