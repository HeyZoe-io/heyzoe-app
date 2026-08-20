-- Fix AcroByJoe WhatsApp display number (Twilio) in dashboard
-- Local IL: 03-382-3805 → E.164: +972 3 382 3805
-- Run in Supabase SQL Editor.
-- Only the current (newest) channel — do not blanket-activate stale/test rows.

UPDATE public.whatsapp_channels
SET
  phone_display = '+972 3 382 3805',
  is_active = true,
  provisioning_status = 'active',
  business_slug = 'acrobyjoe'
WHERE id = (
  SELECT c.id
  FROM public.whatsapp_channels c
  WHERE lower(coalesce(c.business_slug, '')) = 'acrobyjoe'
     OR c.business_id = (SELECT b.id FROM public.businesses b WHERE lower(b.slug) = 'acrobyjoe' LIMIT 1)
  ORDER BY (c.is_active IS TRUE) DESC, c.created_at DESC NULLS LAST, c.id DESC
  LIMIT 1
);

UPDATE public.businesses
SET
  whatsapp_number = '+972 3 382 3805',
  is_active = true,
  updated_at = now()
WHERE lower(slug) = 'acrobyjoe';

-- Verify
SELECT id, business_slug, phone_number_id, phone_display, is_active, provisioning_status
FROM public.whatsapp_channels
WHERE lower(coalesce(business_slug, '')) = 'acrobyjoe'
   OR business_id = (SELECT id FROM public.businesses WHERE lower(slug) = 'acrobyjoe' LIMIT 1);
