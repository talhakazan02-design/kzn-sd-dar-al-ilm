-- Execute once in Supabase SQL Editor. Existing books and categories are not deleted.
create table if not exists public.user_categories (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 scope text not null check(scope in ('personal','shared')),
 name text not null check(length(trim(name)) between 1 and 80),
 source_category text not null default '',
 image_data text not null default '',
 visible boolean not null default true,
 position integer not null default 0,
 created_at timestamptz not null default now()
);
create index if not exists user_categories_owner_scope on public.user_categories(owner_id,scope,position);
alter table public.user_categories enable row level security;
grant select,insert,update,delete on public.user_categories to authenticated;
-- Shared categories: admin-only write, read by approved members.
-- Assumes existing library_members(user_id,status,is_admin).
drop policy if exists "categories read" on public.user_categories;
create policy "categories read" on public.user_categories for select to authenticated using (
 (scope='personal' and owner_id=(select auth.uid())) or
 (scope='shared' and exists(select 1 from public.library_members m where m.user_id=(select auth.uid()) and m.status='approved'))
);
drop policy if exists "categories insert" on public.user_categories;
create policy "categories insert" on public.user_categories for insert to authenticated with check (
 owner_id=(select auth.uid()) and exists(select 1 from public.library_members m where m.user_id=(select auth.uid()) and m.status='approved')
 and (scope='personal' or (scope='shared' and exists(select 1 from public.library_members m where m.user_id=(select auth.uid()) and m.is_admin=true and m.status='approved')))
);
drop policy if exists "categories update" on public.user_categories;
create policy "categories update" on public.user_categories for update to authenticated using (
 (scope='personal' and owner_id=(select auth.uid())) or
 (scope='shared' and exists(select 1 from public.library_members m where m.user_id=(select auth.uid()) and m.is_admin=true and m.status='approved'))
) with check (
 (scope='personal' and owner_id=(select auth.uid())) or
 (scope='shared' and exists(select 1 from public.library_members m where m.user_id=(select auth.uid()) and m.is_admin=true and m.status='approved'))
);
drop policy if exists "categories delete" on public.user_categories;
create policy "categories delete" on public.user_categories for delete to authenticated using (
 (scope='personal' and owner_id=(select auth.uid())) or
 (scope='shared' and exists(select 1 from public.library_members m where m.user_id=(select auth.uid()) and m.is_admin=true and m.status='approved'))
);
-- Prevent owner/scope changes on update, including attempts to take over another user's row.
create or replace function public.prevent_category_ownership_change() returns trigger language plpgsql as $$
begin
 if new.owner_id is distinct from old.owner_id or new.scope is distinct from old.scope then raise exception 'Category ownership and scope cannot be changed';end if;
 return new;
end $$;
drop trigger if exists category_ownership_guard on public.user_categories;
create trigger category_ownership_guard before update on public.user_categories for each row execute function public.prevent_category_ownership_change();
