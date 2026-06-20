-- סאנגה יוגה: מעבר לטמפלייט Meta sanga_welcome2 (ללא {{1}} בשם פרטי).
-- להריץ ב-Supabase SQL Editor אחרי שהטמפלייט אושר ב-Meta Business Manager.

update public.businesses
set lead_template_name = 'sanga_welcome2'
where slug ilike '%sangha%'
   or slug ilike '%sanga%'
   or lead_template_name = 'sangha_lead_welcome';
