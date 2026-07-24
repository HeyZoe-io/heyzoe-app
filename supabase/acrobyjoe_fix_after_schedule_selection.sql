-- Restore day+time placeholders in after_schedule_selection for AcroByJoe.
-- (Restore/translate SQL had stripped {requested_date}/{requested_time}.)
-- Run in Supabase SQL Editor.

UPDATE public.businesses
SET
  social_links = jsonb_set(
    coalesce(social_links, '{}'::jsonb),
    '{sales_flow,after_schedule_selection}',
    to_jsonb(
      'מהמם! נדאג לשבץ אותך ל{serviceName} ביום {requested_date} בשעה {requested_time}'::text
    ),
    true
  ),
  updated_at = now()
WHERE lower(slug) = 'acrobyjoe';

-- Verify
SELECT social_links->'sales_flow'->>'after_schedule_selection' AS after_schedule_selection
FROM public.businesses
WHERE lower(slug) = 'acrobyjoe';
