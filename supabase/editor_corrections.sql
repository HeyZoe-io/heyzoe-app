-- Shadow-mode editor log: original Claude free-text vs what the editor pass would send.
-- Written by the server (service_role) after Zoe generates a free-text reply to an open
-- question. Corrected text is logged only — never sent in shadow mode.
-- Admin review via service_role APIs (bypasses RLS). RLS enabled with no client
-- policies (= deny-all for anon/authenticated). No public access.

create table if not exists public.editor_corrections (
  id bigserial primary key,
  business_id bigint not null references public.businesses (id) on delete cascade,
  contact_id uuid null references public.contacts (id) on delete set null,
  original_text text not null,
  corrected_text text not null,
  changed boolean not null default false,
  model_used text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_editor_corrections_business_created
  on public.editor_corrections (business_id, created_at desc);

create index if not exists idx_editor_corrections_changed_created
  on public.editor_corrections (changed, created_at desc);

comment on table public.editor_corrections is
  'Shadow-mode editor pass: original vs corrected Claude free-text. Logged only, not sent.';

comment on column public.editor_corrections.changed is
  'True when corrected_text differs from original_text.';

comment on column public.editor_corrections.model_used is
  'Model that ran the editor pass (e.g. haiku).';

grant select, insert, update, delete
  on public.editor_corrections
  to authenticated;

grant select, insert, update, delete
  on public.editor_corrections
  to service_role;

alter table public.editor_corrections
  enable row level security;
