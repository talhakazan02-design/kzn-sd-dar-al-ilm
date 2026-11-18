-- Apply after KATEGORIEN-SUPABASE.sql in a staging Supabase project first.
begin;

alter table public.books enable row level security;
alter table public.books add column if not exists location text;

-- Restrictive policies also constrain any existing permissive policies.
drop policy if exists "library books no anonymous access" on public.books;
create policy "library books no anonymous access" on public.books as restrictive
for all to anon using (false) with check (false);

drop policy if exists "library books read boundary" on public.books;
create policy "library books read boundary" on public.books as restrictive
for select to authenticated using (
  (owner_id = (select auth.uid()) or (visibility = 'shared' and deleted_at is null))
  and exists (
    select 1 from public.library_members m
    where m.user_id = (select auth.uid()) and m.status = 'approved'
  )
);

drop policy if exists "library books insert boundary" on public.books;
create policy "library books insert boundary" on public.books as restrictive
for insert to authenticated with check (
  owner_id = (select auth.uid()) and visibility = 'private'
  and exists (
    select 1 from public.library_members m
    where m.user_id = (select auth.uid()) and m.status = 'approved'
  )
);

drop policy if exists "library books update boundary" on public.books;
create policy "library books update boundary" on public.books as restrictive
for update to authenticated using (
  owner_id = (select auth.uid()) and visibility = 'private'
  and exists (
    select 1 from public.library_members m
    where m.user_id = (select auth.uid()) and m.status = 'approved'
  )
) with check (owner_id = (select auth.uid()) and visibility = 'private');

drop policy if exists "library books delete boundary" on public.books;
create policy "library books delete boundary" on public.books as restrictive
for delete to authenticated using (
  owner_id = (select auth.uid()) and visibility = 'private'
  and exists (
    select 1 from public.library_members m
    where m.user_id = (select auth.uid()) and m.status = 'approved'
  )
);

-- The application already uses a private bucket. Check Storage configuration without
-- writing directly to the Storage metadata tables.
do $bucket_check$
begin
  if not exists (select 1 from storage.buckets where id = 'library-files' and not public) then
    raise exception 'Expected an existing private storage bucket library-files';
  end if;
end
$bucket_check$;

-- A separate rule for anonymous requests avoids referencing library_members
-- for a role that cannot read it.
drop policy if exists "library files no anonymous access" on storage.objects;
create policy "library files no anonymous access" on storage.objects as restrictive
for all to anon using (bucket_id <> 'library-files')
with check (bucket_id <> 'library-files');

drop policy if exists "library file owner boundary" on storage.objects;
create policy "library file owner boundary" on storage.objects as restrictive
for all to authenticated using (
  bucket_id <> 'library-files' or (
    (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.library_members m
      where m.user_id = (select auth.uid()) and m.status = 'approved'
    )
  )
) with check (
  bucket_id <> 'library-files' or (
    (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.library_members m
      where m.user_id = (select auth.uid()) and m.status = 'approved'
    )
  )
);

create or replace function public.reorder_library_categories(category_scope text, category_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
  expected integer;
begin
  if category_scope is null or category_scope not in ('personal', 'shared')
    or not exists (
      select 1 from public.library_members m
      where m.user_id = auth.uid() and m.status = 'approved'
        and (category_scope = 'personal' or m.is_admin)
    )
  then raise exception 'Category access denied'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'library categories:' || category_scope ||
    case when category_scope = 'personal' then ':' || auth.uid()::text else '' end
  ));

  select count(*) into expected from public.user_categories c
  where c.scope = category_scope
    and (category_scope = 'shared' or c.owner_id = auth.uid());

  if expected <> coalesce(cardinality(category_ids), 0) then
    raise exception 'Category list changed. Reload and retry.';
  end if;

  update public.user_categories c set position = items.ordinality - 1
  from unnest(category_ids) with ordinality as items(id, ordinality)
  where c.id = items.id and c.scope = category_scope
    and (category_scope = 'shared' or c.owner_id = auth.uid());
  get diagnostics affected = row_count;
  if affected <> expected then raise exception 'Category list changed. Reload and retry.'; end if;
end;
$$;

revoke execute on function public.reorder_library_categories(text, uuid[]) from public, anon;
grant execute on function public.reorder_library_categories(text, uuid[]) to authenticated;

commit;
