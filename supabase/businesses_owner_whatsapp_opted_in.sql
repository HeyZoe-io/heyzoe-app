-- בעל העסק אישר קבלת התראות WhatsApp דרך HEYZOE_OWNER_{slug}
alter table public.businesses
  add column if not exists owner_whatsapp_opted_in boolean not null default false;

create index if not exists idx_businesses_owner_whatsapp_opted_in
  on public.businesses (owner_whatsapp_opted_in)
  where owner_whatsapp_opted_in = false;
