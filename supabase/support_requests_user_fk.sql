-- Ensure support_requests rows are deleted when auth user is deleted.
-- Fixes: "Database error deleting user" due to FK constraint.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'support_requests_user_id_fkey'
  ) then
    alter table public.support_requests
      add constraint support_requests_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

