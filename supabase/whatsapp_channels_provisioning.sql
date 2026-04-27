-- Provisioning status + Twilio SID for WhatsApp channels
alter table public.whatsapp_channels
  add column if not exists twilio_sid text;

alter table public.whatsapp_channels
  add column if not exists provisioning_status text not null default 'active';

alter table public.whatsapp_channels
  drop constraint if exists whatsapp_channels_provisioning_status_check;

alter table public.whatsapp_channels
  add constraint whatsapp_channels_provisioning_status_check
  check (provisioning_status in ('pending', 'active', 'failed'));

create index if not exists idx_wa_channels_provisioning_status on public.whatsapp_channels(provisioning_status);

