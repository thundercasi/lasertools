-- Grupos de clientes (ex.: rede/franquia com várias unidades).
create table if not exists public.customer_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  notes text,
  created_at timestamptz not null default now()
);
create unique index if not exists customer_groups_name_key on public.customer_groups (lower(name));

alter table public.customer_groups enable row level security;
create policy customer_groups_staff_select on public.customer_groups for select to authenticated using (is_staff());
create policy customer_groups_staff_insert on public.customer_groups for insert to authenticated with check (is_staff());
create policy customer_groups_staff_update on public.customer_groups for update to authenticated using (is_staff()) with check (is_staff());
create policy customer_groups_staff_delete on public.customer_groups for delete to authenticated using (is_staff());

alter table public.customers
  add column if not exists group_id uuid references public.customer_groups(id) on delete set null;
create index if not exists customers_group_id_idx on public.customers (group_id);
