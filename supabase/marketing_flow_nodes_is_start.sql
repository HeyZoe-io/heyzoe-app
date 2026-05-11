alter table public.marketing_flow_nodes
  add column if not exists is_start boolean not null default false;

create index if not exists idx_marketing_flow_nodes_is_start on public.marketing_flow_nodes (is_start) where is_start = true;
