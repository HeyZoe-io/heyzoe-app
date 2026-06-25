-- סאנגה יוגה: מעבר לטמפלייט Meta sanga_quiz_welcome (קוויז פתיחה, ללא {{1}} בשם פרטי).
-- להריץ ב-Supabase SQL Editor אחרי שהטמפלייט אושר ב-Meta Business Manager.

update public.businesses
set lead_template_name = 'sanga_quiz_welcome'
where slug ilike '%sangha%'
   or slug ilike '%sanga%'
   or lead_template_name in ('sangha_lead_welcome', 'sanga_welcome2');
