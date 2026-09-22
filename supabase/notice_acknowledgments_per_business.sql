-- One Meta-pricing (etc.) acknowledgment per business, not per user.
-- user_id / user_name stay as audit of who clicked first.
-- Dedup keeps the earliest row if the same notice was acked twice for one business.

delete from public.notice_acknowledgments a
using public.notice_acknowledgments b
where a.notice_key = b.notice_key
  and a.business_id = b.business_id
  and (
    a.acknowledged_at > b.acknowledged_at
    or (a.acknowledged_at = b.acknowledged_at and a.id > b.id)
  );

alter table public.notice_acknowledgments
  drop constraint if exists notice_acknowledgments_unique;

alter table public.notice_acknowledgments
  drop constraint if exists notice_acknowledgments_notice_business_unique;

alter table public.notice_acknowledgments
  add constraint notice_acknowledgments_notice_business_unique
  unique (notice_key, business_id);

drop policy if exists notice_acknowledgments_select_own on public.notice_acknowledgments;
drop policy if exists notice_acknowledgments_select_business on public.notice_acknowledgments;

create policy notice_acknowledgments_select_business
  on public.notice_acknowledgments
  for select
  to authenticated
  using (public.notice_ack_can_access_business(business_id, auth.uid()));
