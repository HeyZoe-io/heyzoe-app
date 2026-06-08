-- Reactivate AcrobyJoe demo / internal account (WhatsApp + dashboard).
update public.businesses
set
  is_active = true,
  status = 'active'
where lower(slug) = 'acrobyjoe';

update public.whatsapp_channels
set is_active = true
where lower(business_slug) = 'acrobyjoe';
