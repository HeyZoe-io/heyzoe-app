-- מייל ייעודי להתראות בעלים (ליד נרשם / נציג / סיכום יומי). אם ריק — fallback ל-businesses.email
alter table public.businesses
  add column if not exists owner_notification_email text;
