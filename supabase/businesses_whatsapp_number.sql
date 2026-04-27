-- Store assigned WhatsApp display number on business row
alter table public.businesses
  add column if not exists whatsapp_number text;

create index if not exists idx_businesses_whatsapp_number on public.businesses(whatsapp_number);

