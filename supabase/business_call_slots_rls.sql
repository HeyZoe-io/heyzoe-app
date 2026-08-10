-- =============================================================================
-- MIGRATION TO RUN (not yet applied if policies missing): RLS for business_call_slots
-- Pattern: enable RLS + grants; members/owners can CRUD their business rows.
-- Dashboard APIs use service_role (bypasses RLS); policies cover authenticated clients.
-- =============================================================================

grant select, insert, update, delete
  on public.business_call_slots
  to authenticated;

grant select, insert, update, delete
  on public.business_call_slots
  to service_role;

alter table public.business_call_slots
  enable row level security;

drop policy if exists "business_call_slots_select_member" on public.business_call_slots;
create policy "business_call_slots_select_member"
on public.business_call_slots for select
using (
  exists (
    select 1 from public.businesses b
    where b.id = business_call_slots.business_id
      and b.user_id = auth.uid()
  )
  or exists (
    select 1 from public.business_users bu
    where bu.business_id = business_call_slots.business_id
      and bu.user_id = auth.uid()
  )
);

drop policy if exists "business_call_slots_write_member" on public.business_call_slots;
create policy "business_call_slots_write_member"
on public.business_call_slots for all
using (
  exists (
    select 1 from public.businesses b
    where b.id = business_call_slots.business_id
      and b.user_id = auth.uid()
  )
  or exists (
    select 1 from public.business_users bu
    where bu.business_id = business_call_slots.business_id
      and bu.user_id = auth.uid()
      and bu.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.businesses b
    where b.id = business_call_slots.business_id
      and b.user_id = auth.uid()
  )
  or exists (
    select 1 from public.business_users bu
    where bu.business_id = business_call_slots.business_id
      and bu.user_id = auth.uid()
      and bu.role = 'admin'
  )
);
