-- דלי ציבורי להעלאת מדיה (פתיחת ווטסאפ, לוגו). מגבלת קובץ 16MB (העלאת מדיה מהדפדפן דרך Signed URL).
-- אם הדלי כבר קיים: Storage → business-assets → Edit → File size limit → 16MB.
insert into storage.buckets (id, name, public, file_size_limit)
values ('business-assets', 'business-assets', true, 16777216)
on conflict (id) do nothing;

-- קריאה ציבורית לקבצים (getPublicUrl)
drop policy if exists "Public read business-assets" on storage.objects;
create policy "Public read business-assets"
on storage.objects for select
using (bucket_id = 'business-assets');
