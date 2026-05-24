-- שם תצוגה מוואטסאפ (ProfileName) ללידים בקו זואי אדמין
alter table public.marketing_flow_sessions
  add column if not exists full_name text null;

comment on column public.marketing_flow_sessions.full_name is
  'שם פרופיל וואטסאפ של הליד (Meta ProfileName)';
