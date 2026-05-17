-- מספר וואטסאפ של בעל העסק להתראות (נשמר ב-HEYZOE_OWNER_{slug})
alter table public.businesses
  add column if not exists owner_whatsapp_phone text;
