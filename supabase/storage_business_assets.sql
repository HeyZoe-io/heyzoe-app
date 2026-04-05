-- דלי ציבורי להעלאת מדיה (פתיחת ווטסאפ, לוגו). הרצה ב-Supabase → SQL Editor אם אין יצירה אוטומטית מהאפליקציה.
insert into storage.buckets (id, name, public, file_size_limit)
values ('business-assets', 'business-assets', true, 5242880)
on conflict (id) do nothing;

-- קריאה ציבורית לקבצים (getPublicUrl)
drop policy if exists "Public read business-assets" on storage.objects;
create policy "Public read business-assets"
on storage.objects for select
using (bucket_id = 'business-assets');
