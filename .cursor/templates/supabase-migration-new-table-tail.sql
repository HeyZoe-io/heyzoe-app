-- =============================================================================
-- סוף migration: החליפי your_table בשם הטבלה. רק לטבלאות חדשות ב-public.
-- =============================================================================

grant select, insert, update, delete
  on public.your_table
  to authenticated;

grant select, insert, update, delete
  on public.your_table
  to service_role;

alter table public.your_table
  enable row level security;

-- הוסיפי כאן policies ל-authenticated / anon לפי הצורך (או migration נפרד).
