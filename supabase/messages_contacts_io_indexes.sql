-- IO: שאילתות webhook (COUNT/SELECT לפי slug+session+role) ומכסת contacts חודשית

create index if not exists idx_messages_slug_session_role_created
  on public.messages (business_slug, session_id, role, created_at desc);

create index if not exists idx_contacts_business_created_at
  on public.contacts (business_id, created_at asc);
