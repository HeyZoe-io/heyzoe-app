-- שאלות שזואי לא ידעה לענות עליהן — סימון "טופל" בדשבורד אנליטיקס
-- הרצה ב-Supabase SQL Editor לפני שימוש בפיצ׳ר.

create table if not exists public.analytics_knowledge_gap_dismissals (
  id bigserial primary key,
  business_slug text not null,
  assistant_message_id bigint not null,
  dismissed_at timestamptz not null default now(),
  dismissed_by uuid null,
  unique (business_slug, assistant_message_id)
);

create index if not exists idx_analytics_kg_dismissals_slug
  on public.analytics_knowledge_gap_dismissals (business_slug, dismissed_at desc);

-- API משתמש ב-service_role; RLS מופעל לפי סטנדרט טבלאות חדשות.

grant select, insert, update, delete
  on public.analytics_knowledge_gap_dismissals
  to authenticated;

grant select, insert, update, delete
  on public.analytics_knowledge_gap_dismissals
  to service_role;

alter table public.analytics_knowledge_gap_dismissals
  enable row level security;
