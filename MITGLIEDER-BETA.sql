-- Apply the member tools to a test project before deploying the matching UI.
-- These table names are reserved for this migration. An existing table causes a
-- rollback so its structure and permissions can be reviewed before proceeding.
begin;

create table public.library_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) <= 160 and title ~ '[^[:space:]]'),
  body text not null check (char_length(body) <= 12000 and body ~ '[^[:space:]]'),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create table public.library_wishlist (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) <= 160 and title ~ '[^[:space:]]'),
  author text not null default '' check (char_length(author) <= 160),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create index library_notes_owner_updated_idx
  on public.library_notes (owner_id, updated_at desc, id);
create index library_wishlist_owner_updated_idx
  on public.library_wishlist (owner_id, updated_at desc, id);

create function public.set_library_member_item_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.statement_timestamp();
  return new;
end;
$$;

revoke all on function public.set_library_member_item_updated_at() from public, anon, authenticated;

create trigger library_notes_set_updated_at
  before update on public.library_notes
  for each row execute function public.set_library_member_item_updated_at();
create trigger library_wishlist_set_updated_at
  before update on public.library_wishlist
  for each row execute function public.set_library_member_item_updated_at();

alter table public.library_notes enable row level security;
alter table public.library_wishlist enable row level security;

revoke all on public.library_notes, public.library_wishlist from public, anon, authenticated;
grant select, delete on public.library_notes, public.library_wishlist to authenticated;
grant insert (owner_id, title, body), update (title, body) on public.library_notes to authenticated;
grant insert (owner_id, title, author), update (title, author) on public.library_wishlist to authenticated;

create policy library_notes_access_own
on public.library_notes for all to authenticated
using (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.library_members
    where user_id = (select auth.uid()) and status = 'approved'
  )
)
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.library_members
    where user_id = (select auth.uid()) and status = 'approved'
  )
);

create policy library_wishlist_access_own
on public.library_wishlist for all to authenticated
using (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.library_members
    where user_id = (select auth.uid()) and status = 'approved'
  )
)
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.library_members
    where user_id = (select auth.uid()) and status = 'approved'
  )
);

notify pgrst, 'reload schema';
commit;
