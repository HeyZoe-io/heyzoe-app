-- Update AcrobyJoe WhatsApp channel to Meta Cloud API phone_number_id
update public.whatsapp_channels
set
  phone_number_id = '1048979848304824',
  phone_display = '+972 3 382 3034',
  business_slug = 'acrobyjoe',
  is_active = true
where business_slug = 'acrobyjoe';

