-- הנחיות פלטפורמה לזואי של בעלי עסקים (דשבורד אדמין → זואי). הרצה חוזרת בטוחה.
create table if not exists public.zoe_platform_settings (
  id int primary key default 1 check (id = 1),
  guidelines jsonb not null default '{"categories":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.zoe_platform_settings (id, guidelines)
values (1, '{"categories":[]}'::jsonb)
on conflict (id) do nothing;

comment on table public.zoe_platform_settings is 'הנחיות אופי/חוקיות/מבנה תשובה לזואי בבעלי עסקים — ריק = ברירת מחדל מהאפליקציה';
comment on column public.zoe_platform_settings.guidelines is 'JSON: { categories: [{ id, title, description, lines[] }] }';
