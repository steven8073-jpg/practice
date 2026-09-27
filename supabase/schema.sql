-- Run once in the Supabase SQL Editor for this project's database.
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  sku text not null check (char_length(trim(sku)) between 1 and 50),
  category text not null check (char_length(trim(category)) between 1 and 50),
  price bigint not null check (price between 0 and 999999999),
  stock bigint not null check (stock between 0 and 999999999),
  status text not null default 'inactive' check (status in ('active', 'inactive')),
  description text not null default '' check (char_length(description) <= 2000),
  created_at timestamptz not null default now()
);

create unique index if not exists products_user_sku_unique
  on public.products (user_id, lower(sku));

create index if not exists products_user_created_at_idx
  on public.products (user_id, created_at desc);

alter table public.products enable row level security;

create policy "Owners can read products" on public.products
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Owners can add products" on public.products
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Owners can update products" on public.products
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Owners can delete products" on public.products
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.products from anon;
grant select, insert, update, delete on public.products to authenticated;

-- A JSON backup replaces the signed-in user's products in one transaction.
-- Any failed insert rolls the entire restore back, including the delete.
create or replace function public.replace_my_products(items jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  inserted_count integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in required';
  end if;
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) > 10000 then
    raise exception 'Expected an array of up to 10000 products';
  end if;

  delete from public.products where user_id = (select auth.uid());
  for item in select value from jsonb_array_elements(items) loop
    insert into public.products
      (user_id, name, sku, category, price, stock, status, description)
    values
      ((select auth.uid()), item->>'name', item->>'sku', item->>'category',
       (item->>'price')::bigint, (item->>'stock')::bigint,
       item->>'status', coalesce(item->>'description', ''));
    inserted_count := inserted_count + 1;
  end loop;
  return inserted_count;
end;
$$;

revoke all on function public.replace_my_products(jsonb) from public, anon;
grant execute on function public.replace_my_products(jsonb) to authenticated;
