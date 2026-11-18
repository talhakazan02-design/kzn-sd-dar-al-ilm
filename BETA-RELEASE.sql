-- Run on an existing library schema as the PostgreSQL owner. Set
-- library.beta_owner_id locally in this transaction to the verified member UUID.
-- No account identifier is kept in this file.
begin;
set local lock_timeout = '4s';
set local statement_timeout = '45s';

-- MITGLIEDER-BETA.sql
-- Apply the member tools to a test project before deploying the matching UI.
-- These table names are reserved for this migration. An existing table causes a
-- rollback so its structure and permissions can be reviewed before proceeding.


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

-- ROLES-BETA.sql
-- Additive role foundation. Existing admin policies remain in force until
-- each affected feature has been migrated to the capability checks below.


create table if not exists public.library_beta_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete restrict
);

create table if not exists public.library_beta_delegations (
  user_id uuid not null references auth.users(id) on delete cascade,
  capability text not null check (capability in ('shared_category_manage', 'shared_loan_review')),
  granted_at timestamptz not null default now(),
  primary key (user_id, capability)
);

alter table public.library_beta_owner enable row level security;
alter table public.library_beta_delegations enable row level security;
revoke all on public.library_beta_owner, public.library_beta_delegations
  from public, anon, authenticated, service_role;

-- Run once as the SQL owner after separately confirming the account UUID
-- with the library owner. For example:
-- select public.library_beta_bootstrap_owner('<verified auth.users.id>'::uuid);
-- A second call cannot replace the owner. Recovery or transfer requires a
-- separate, explicitly authorized administrative migration.
create or replace function public.library_beta_bootstrap_owner(verified_owner_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.library_members member
    where member.user_id = verified_owner_user_id
      and member.status = 'approved' and member.is_admin is true
  ) then
    raise exception 'The verified owner must be an approved existing administrator'
      using errcode = '22023';
  end if;

  insert into public.library_beta_owner (user_id) values (verified_owner_user_id);
end;
$$;

create or replace function public.library_beta_is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.library_beta_owner owner
    join public.library_members member on member.user_id = owner.user_id
    where owner.user_id = (select auth.uid())
      and member.status = 'approved' and member.is_admin is true
  );
$$;

create or replace function public.library_has_capability(required_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(required_capability in ('shared_category_manage', 'shared_loan_review'), false)
    and (
      public.library_beta_is_owner()
      or exists (
        select 1 from public.library_beta_delegations delegation
        join public.library_members member on member.user_id = delegation.user_id
        where delegation.user_id = (select auth.uid())
          and delegation.capability = required_capability
          and member.status = 'approved'
      )
    );
$$;

-- Members may read only their own effective access through this function.
create or replace function public.library_beta_get_access()
returns table (is_owner boolean, capabilities text[])
language sql
stable
security invoker
set search_path = ''
as $$
  select public.library_beta_is_owner(),
    array(
      select allowed.capability
      from (values ('shared_category_manage'), ('shared_loan_review')) allowed(capability)
      where public.library_has_capability(allowed.capability)
      order by allowed.capability
    );
$$;

create or replace function public.library_beta_list_delegate_candidates()
returns table (user_id uuid, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.library_beta_is_owner() then
    raise exception 'Only the library owner can list eligible delegates'
      using errcode = '42501';
  end if;

  return query
    select account.id, account.email::text
    from auth.users account
    where account.id <> (select auth.uid()) and exists (
      select 1 from public.library_members member
      where member.user_id = account.id and member.status = 'approved'
    )
    order by pg_catalog.lower(account.email), account.id;
end;
$$;

-- Only the verified owner may read or replace explicit grants for another user.
create or replace function public.library_beta_get_capabilities(target_user_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.library_beta_is_owner() then
    raise exception 'Only the library owner can view delegated capabilities'
      using errcode = '42501';
  end if;

  return array(
    select delegation.capability from public.library_beta_delegations delegation
    where delegation.user_id = target_user_id order by delegation.capability
  );
end;
$$;

create or replace function public.library_beta_set_capabilities(target_user_id uuid, capabilities text[])
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text[];
begin
  if not public.library_beta_is_owner() then
    raise exception 'Only the library owner can change delegated capabilities'
      using errcode = '42501';
  end if;

  if target_user_id is null or target_user_id = (select auth.uid()) or capabilities is null then
    raise exception 'An explicit set of capabilities for another user is required'
      using errcode = '22023';
  end if;

  if pg_catalog.array_ndims(capabilities) > 1 or exists (
    select 1 from pg_catalog.unnest(capabilities) requested(capability)
    where requested.capability is null
      or requested.capability not in ('shared_category_manage', 'shared_loan_review')
  ) then
    raise exception 'Unknown or invalid delegated capability'
      using errcode = '22023';
  end if;

  -- Serialize replacements for the same target so concurrent writes cannot
  -- accidentally retain the union of two requested capability sets.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('library beta delegation:' || target_user_id::text, 0)
  );

  normalized := array(
    select distinct requested.capability from pg_catalog.unnest(capabilities) requested(capability)
    order by requested.capability
  );
  if pg_catalog.cardinality(normalized) > 0 and not exists (
    select 1 from public.library_members member
    where member.user_id = target_user_id and member.status = 'approved'
  ) then
    raise exception 'Capabilities can only be granted to approved members'
      using errcode = '22023';
  end if;

  delete from public.library_beta_delegations delegation
  where delegation.user_id = target_user_id and delegation.capability <> all(normalized);

  insert into public.library_beta_delegations (user_id, capability)
  select target_user_id, requested.capability from pg_catalog.unnest(normalized) requested(capability)
  on conflict (user_id, capability) do nothing;

  return normalized;
end;
$$;

revoke all on function public.library_beta_bootstrap_owner(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.library_beta_is_owner(),
  public.library_has_capability(text), public.library_beta_get_access(),
  public.library_beta_list_delegate_candidates(), public.library_beta_get_capabilities(uuid),
  public.library_beta_set_capabilities(uuid, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.library_beta_is_owner(),
  public.library_has_capability(text), public.library_beta_get_access(),
  public.library_beta_list_delegate_candidates(), public.library_beta_get_capabilities(uuid),
  public.library_beta_set_capabilities(uuid, text[])
  to authenticated;
select public.library_beta_bootstrap_owner(current_setting('library.beta_owner_id')::uuid);

-- ADMIN-REGELN-BETA.sql
-- Apply after ROLES-BETA.sql and the verified owner bootstrap. The legacy
-- tables and rows remain in place; only their access rules change.


do $$
begin
  if not exists (
    select 1 from public.library_beta_owner o
    join public.library_members m on m.user_id = o.user_id
    where m.status = 'approved' and m.is_admin is true
  ) then
    raise exception 'Bootstrap the verified library owner before switching admin rules';
  end if;
end;
$$;

alter table public.user_categories enable row level security;
revoke all on public.user_categories from public, anon;

-- Restrictive bounds also cover custom or reinstalled permissive policies.
drop policy if exists "beta categories read boundary" on public.user_categories;
create policy "beta categories read boundary" on public.user_categories as restrictive
for select to authenticated using (
  (scope = 'personal' and owner_id = (select auth.uid()))
  or (scope = 'shared' and exists (
    select 1 from public.library_members m
    where m.user_id = (select auth.uid()) and m.status = 'approved'
  ))
);

drop policy if exists "beta categories insert boundary" on public.user_categories;
create policy "beta categories insert boundary" on public.user_categories as restrictive
for insert to authenticated with check (
  owner_id = (select auth.uid()) and exists (
    select 1 from public.library_members m
    where m.user_id = (select auth.uid()) and m.status = 'approved'
  ) and (
    scope = 'personal'
    or (scope = 'shared' and (select public.library_has_capability('shared_category_manage')))
  )
);

drop policy if exists "beta categories update boundary" on public.user_categories;
create policy "beta categories update boundary" on public.user_categories as restrictive
for update to authenticated using (
  (scope = 'personal' and owner_id = (select auth.uid()))
  or (scope = 'shared' and (select public.library_has_capability('shared_category_manage')))
) with check (
  (scope = 'personal' and owner_id = (select auth.uid()))
  or (scope = 'shared' and (select public.library_has_capability('shared_category_manage')))
);

drop policy if exists "beta categories delete boundary" on public.user_categories;
create policy "beta categories delete boundary" on public.user_categories as restrictive
for delete to authenticated using (
  (scope = 'personal' and owner_id = (select auth.uid()))
  or (scope = 'shared' and (select public.library_has_capability('shared_category_manage')))
);

-- The restrictive policies above define the bounds for all writes. These
-- permissive policies enable those bounded writes for newly delegated users.
drop policy if exists "categories insert" on public.user_categories;
create policy "categories insert" on public.user_categories
for insert to authenticated with check (true);

drop policy if exists "categories update" on public.user_categories;
create policy "categories update" on public.user_categories
for update to authenticated using (true) with check (true);

drop policy if exists "categories delete" on public.user_categories;
create policy "categories delete" on public.user_categories
for delete to authenticated using (true);

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
      where m.user_id = (select auth.uid()) and m.status = 'approved'
    )
    or (category_scope = 'shared' and not public.library_has_capability('shared_category_manage'))
  then
    raise exception 'Category access denied' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'library categories:' || category_scope ||
    case when category_scope = 'personal' then ':' || auth.uid()::text else '' end
  ));

  select count(*) into expected from public.user_categories c
  where c.scope = category_scope
    and (category_scope = 'shared' or c.owner_id = (select auth.uid()));

  if expected <> coalesce(cardinality(category_ids), 0) then
    raise exception 'Category list changed. Reload and retry.';
  end if;

  update public.user_categories c set position = items.ordinality - 1
  from unnest(category_ids) with ordinality as items(id, ordinality)
  where c.id = items.id and c.scope = category_scope
    and (category_scope = 'shared' or c.owner_id = (select auth.uid()));
  get diagnostics affected = row_count;
  if affected <> expected then
    raise exception 'Category list changed. Reload and retry.';
  end if;
end;
$$;

revoke execute on function public.reorder_library_categories(text, uuid[]) from public, anon;
grant execute on function public.reorder_library_categories(text, uuid[]) to authenticated;

-- This add-on is optional. Standard Supabase Auth reset is independent of it.
do $policies$
begin
  if to_regclass('public.password_reset_requests') is null then
    raise notice 'Optional password help table absent; standard Auth reset is unchanged';
    return;
  end if;

  alter table public.password_reset_requests enable row level security;
  revoke all on public.password_reset_requests from public, anon;

  drop policy if exists "beta reset requests read boundary" on public.password_reset_requests;
  create policy "beta reset requests read boundary" on public.password_reset_requests as restrictive
  for select to authenticated using (
    user_id = (select auth.uid()) or (select public.library_beta_is_owner())
  );

  drop policy if exists "beta reset requests insert boundary" on public.password_reset_requests;
  create policy "beta reset requests insert boundary" on public.password_reset_requests as restrictive
  for insert to authenticated with check (
    user_id = (select auth.uid()) and exists (
      select 1 from public.library_members m
      where m.user_id = (select auth.uid()) and m.status = 'approved'
    )
  );

  drop policy if exists "beta reset requests update boundary" on public.password_reset_requests;
  create policy "beta reset requests update boundary" on public.password_reset_requests as restrictive
  for update to authenticated using ((select public.library_beta_is_owner()))
  with check ((select public.library_beta_is_owner()));

  drop policy if exists "beta reset requests delete boundary" on public.password_reset_requests;
  create policy "beta reset requests delete boundary" on public.password_reset_requests as restrictive
  for delete to authenticated using (false);

  drop policy if exists "Members see own reset requests" on public.password_reset_requests;
  create policy "Members see own reset requests" on public.password_reset_requests
  for select to authenticated using (
    user_id = (select auth.uid()) or (select public.library_beta_is_owner())
  );

  drop policy if exists "Admins approve reset requests" on public.password_reset_requests;
  create policy "Admins approve reset requests" on public.password_reset_requests
  for update to authenticated using ((select public.library_beta_is_owner()))
  with check ((select public.library_beta_is_owner()));
end;
$policies$;

notify pgrst, 'reload schema';

-- PERSOENLICHE-AUSLEIHEN-BETA.sql
-- Personal lending history for the physical copies in a member's own library.


create table if not exists public.personal_book_loans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  borrower_label text not null check (char_length(borrower_label) between 1 and 120),
  due_date date,
  lent_at timestamptz not null default now(),
  returned_at timestamptz check (returned_at >= lent_at)
);

create unique index if not exists personal_book_loans_one_open
  on public.personal_book_loans (book_id)
  where returned_at is null;

create index if not exists personal_book_loans_owner_history
  on public.personal_book_loans (owner_id, lent_at desc);

alter table public.personal_book_loans enable row level security;
revoke all on public.personal_book_loans from public, anon, authenticated;
grant select on public.personal_book_loans to authenticated;
grant insert (owner_id, book_id, borrower_label, due_date) on public.personal_book_loans to authenticated;
grant update (returned_at) on public.personal_book_loans to authenticated;

drop policy if exists "members read own loan history" on public.personal_book_loans;
create policy "members read own loan history" on public.personal_book_loans
for select to authenticated using (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.library_members m
    where m.user_id = (select auth.uid()) and m.status = 'approved'
  )
);

drop policy if exists "members lend own active private books" on public.personal_book_loans;
create policy "members lend own active private books" on public.personal_book_loans
for insert to authenticated with check (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.library_members m
    where m.user_id = (select auth.uid()) and m.status = 'approved'
  )
  and exists (
    select 1 from public.books b
    where b.id = book_id and b.owner_id = (select auth.uid())
      and b.visibility = 'private' and b.deleted_at is null
  )
);

drop policy if exists "members return own open loans" on public.personal_book_loans;
create policy "members return own open loans" on public.personal_book_loans
for update to authenticated using (
  owner_id = (select auth.uid()) and returned_at is null
  and exists (
    select 1 from public.library_members m
    where m.user_id = (select auth.uid()) and m.status = 'approved'
  )
) with check (
  owner_id = (select auth.uid()) and returned_at is not null
  and exists (
    select 1 from public.library_members m
    where m.user_id = (select auth.uid()) and m.status = 'approved'
  )
);

create or replace function public.guard_personal_book_loan()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Serialize the active-book check with a concurrent soft deletion.
    perform 1 from public.books b
    where b.id = new.book_id and b.owner_id = new.owner_id
      and b.visibility = 'private' and b.deleted_at is null
    for share;
    if not found then raise exception 'An active private book is required'; end if;
    new.borrower_label := btrim(new.borrower_label);
    return new;
  end if;

  if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id
    or new.book_id is distinct from old.book_id or new.lent_at is distinct from old.lent_at
    or new.borrower_label is distinct from old.borrower_label or new.due_date is distinct from old.due_date
  then raise exception 'Loan details cannot be changed'; end if;
  if old.returned_at is not null or new.returned_at is null then
    raise exception 'Only an open loan can be marked as returned';
  end if;
  new.returned_at := clock_timestamp();
  return new;
end;
$$;

revoke execute on function public.guard_personal_book_loan() from public, anon, authenticated;

drop trigger if exists personal_book_loan_guard on public.personal_book_loans;
create trigger personal_book_loan_guard before insert or update on public.personal_book_loans
for each row execute function public.guard_personal_book_loan();

-- GEMEINSAME-AUSLEIHANFRAGEN-BETA.sql
-- Apply after ROLES-BETA.sql. Only explicitly offered physical books appear
-- in the member catalog. Private book records and files retain their own RLS.


create table public.library_lending_offers (
  id uuid primary key default gen_random_uuid(),
  book_id uuid unique references public.books(id) on delete set null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) > 0),
  author text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.library_lending_requests (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.library_lending_offers(id) on delete cascade,
  borrower_id uuid not null references auth.users(id) on delete cascade,
  handover_note text not null default '' check (char_length(handover_note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled', 'returned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index library_lending_one_pending_per_borrower
  on public.library_lending_requests (offer_id, borrower_id)
  where status in ('pending', 'approved');
create unique index library_lending_one_approved_per_offer
  on public.library_lending_requests (offer_id)
  where status = 'approved';
create index library_lending_requests_borrower
  on public.library_lending_requests (borrower_id, created_at desc);

alter table public.library_lending_offers enable row level security;
alter table public.library_lending_requests enable row level security;
revoke all on public.library_lending_offers, public.library_lending_requests from public, anon, authenticated;

create function public.library_lending_actor()
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or not exists (
    select 1 from public.library_members m
    where m.user_id = actor and m.status = 'approved'
  ) then
    raise exception 'Approved membership required' using errcode = '42501';
  end if;
  return actor;
end;
$$;

create function public.library_set_lending_offer(target_book uuid, available boolean)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := public.library_lending_actor();
  book_title text;
  book_author text;
  result uuid;
begin
  if available is null then
    raise exception 'Availability is required' using errcode = '22023';
  end if;
  -- Only the owner elects to expose these two bibliographic fields.
  select b.title, b.author into book_title, book_author
  from public.books b
  where b.id = target_book and b.owner_id = actor
    and (not available or b.deleted_at is null);
  if not found then
    raise exception 'Book not available for this account' using errcode = '42501';
  end if;
  if not available then
    update public.library_lending_offers set enabled = false
    where book_id = target_book and owner_id = actor returning id into result;
    return result;
  end if;
  insert into public.library_lending_offers as o (book_id, owner_id, title, author, enabled)
  values (target_book, actor, btrim(book_title), coalesce(book_author, ''), true)
  on conflict (book_id) do update
    set title = excluded.title, author = excluded.author, enabled = true
    where o.owner_id = actor
  returning id into result;
  return result;
end;
$$;

create function public.library_list_lending_offers(start_at integer default 0)
returns table (id uuid, title text, author text, mine boolean, available boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor uuid := public.library_lending_actor();
begin
  return query
  select o.id, o.title, o.author, o.owner_id = actor,
    not exists (
      select 1 from public.library_lending_requests r
      where r.offer_id = o.id and r.status = 'approved'
    )
  from public.library_lending_offers o
  join public.books b on b.id = o.book_id and b.owner_id = o.owner_id
  join public.library_members m on m.user_id = o.owner_id and m.status = 'approved'
  where o.enabled and b.deleted_at is null
  order by o.created_at desc, o.id
  limit 50 offset greatest(coalesce(start_at, 0), 0);
end;
$$;

create function public.library_request_loan(target_offer uuid, note text default '')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := public.library_lending_actor();
  result uuid;
begin
  perform 1
  from public.library_lending_offers o
  join public.books b on b.id = o.book_id and b.owner_id = o.owner_id
  join public.library_members m on m.user_id = o.owner_id and m.status = 'approved'
  where o.id = target_offer and o.owner_id <> actor and o.enabled and b.deleted_at is null
  for update of o;
  if not found or exists (
    select 1 from public.library_lending_requests r
    where r.offer_id = target_offer and r.status = 'approved'
  ) then
    raise exception 'Offer not available' using errcode = '22023';
  end if;
  insert into public.library_lending_requests (offer_id, borrower_id, handover_note)
  values (target_offer, actor, btrim(coalesce(note, '')))
  returning id into result;
  return result;
end;
$$;

create function public.library_list_loan_requests(start_at integer default 0)
returns table (
  id uuid, offer_title text, status text, handover_note text, requested_by_me boolean,
  can_review boolean, created_at timestamptz, updated_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor uuid := public.library_lending_actor();
  delegated boolean := public.library_has_capability('shared_loan_review');
begin
  return query
  select r.id, o.title, r.status, r.handover_note, r.borrower_id = actor,
    (o.owner_id = actor or delegated) and r.borrower_id <> actor,
    r.created_at, r.updated_at
  from public.library_lending_requests r
  join public.library_lending_offers o on o.id = r.offer_id
  where r.borrower_id = actor or o.owner_id = actor or delegated
  order by r.created_at desc, r.id
  limit 50 offset greatest(coalesce(start_at, 0), 0);
end;
$$;

create function public.library_update_loan_request(target_request uuid, target_status text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := public.library_lending_actor();
  request_row public.library_lending_requests%rowtype;
  offer_row public.library_lending_offers%rowtype;
  review boolean;
begin
  select o.* into offer_row
  from public.library_lending_offers o
  join public.library_lending_requests r on r.offer_id = o.id
  where r.id = target_request
  for update of o;
  if not found then raise exception 'Request not available' using errcode = '42501'; end if;
  select r.* into strict request_row from public.library_lending_requests r where r.id = target_request for update;
  review := request_row.borrower_id <> actor
    and (offer_row.owner_id = actor or public.library_has_capability('shared_loan_review'));

  if request_row.status = 'pending' and target_status = 'cancelled' and request_row.borrower_id = actor then
    null;
  elsif request_row.status = 'pending' and target_status = 'declined' and review then
    null;
  elsif request_row.status = 'pending' and target_status = 'approved' and review then
    if not offer_row.enabled or not exists (
      select 1 from public.books b
      join public.library_members m on m.user_id = b.owner_id and m.status = 'approved'
      where b.id = offer_row.book_id and b.owner_id = offer_row.owner_id and b.deleted_at is null
    ) or not exists (
      select 1 from public.library_members m where m.user_id = request_row.borrower_id and m.status = 'approved'
    ) then
      raise exception 'Offer or borrower is no longer available' using errcode = '22023';
    end if;
  elsif request_row.status = 'approved' and target_status = 'returned' and review then
    null;
  else
    raise exception 'Requested status change is not allowed' using errcode = '42501';
  end if;

  update public.library_lending_requests
  set status = target_status, updated_at = statement_timestamp() where id = target_request;
end;
$$;

revoke execute on function public.library_lending_actor() from public, anon, authenticated;
revoke execute on function public.library_set_lending_offer(uuid, boolean),
  public.library_list_lending_offers(integer), public.library_request_loan(uuid, text),
  public.library_list_loan_requests(integer), public.library_update_loan_request(uuid, text)
  from public, anon, authenticated;
grant execute on function public.library_set_lending_offer(uuid, boolean),
  public.library_list_lending_offers(integer), public.library_request_loan(uuid, text),
  public.library_list_loan_requests(integer), public.library_update_loan_request(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';

-- AUSLEIH-KONSISTENZ-BETA.sql
-- Apply after both lending migrations. One physical book has one active loan
-- across both workflows. Existing loans are preserved, including history.


lock table public.personal_book_loans, public.library_lending_offers,
  public.library_lending_requests in share row exclusive mode;

create table public.library_lending_occupancy (
  book_id uuid primary key references public.books(id) on delete cascade,
  active_kind text check (active_kind in ('personal', 'shared')),
  active_id uuid,
  check ((active_kind is null) = (active_id is null)),
  unique (active_kind, active_id)
);

alter table public.library_lending_occupancy enable row level security;
revoke all on public.library_lending_occupancy from public, anon, authenticated, service_role;

do $$
begin
  if exists (
    select 1 from public.personal_book_loans p
    join public.library_lending_offers o on o.book_id = p.book_id
    join public.library_lending_requests r on r.offer_id = o.id
    where p.returned_at is null and r.status = 'approved'
  ) then
    raise exception 'Resolve books with simultaneous personal and shared active loans before applying this migration';
  end if;
end;
$$;

insert into public.library_lending_occupancy (book_id, active_kind, active_id)
select book_id, 'personal', id from public.personal_book_loans where returned_at is null
union all
select o.book_id, 'shared', r.id
from public.library_lending_offers o
join public.library_lending_requests r on r.offer_id = o.id
where o.book_id is not null and r.status = 'approved';

-- Even an availability check for a new pending request writes this guard
-- row. A concurrent transition therefore either sees the preceding write
-- or fails with a serialization error at stricter isolation levels.
create function public.library_claim_available_book(target_book uuid, kind text, loan_id uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  insert into public.library_lending_occupancy as o (book_id, active_kind, active_id)
  values (target_book, kind, loan_id)
  on conflict (book_id) do update
    set active_kind = excluded.active_kind, active_id = excluded.active_id
    where o.active_kind is null;
  if not found then
    raise exception 'This book already has an active loan' using errcode = '22023';
  end if;
end;
$$;

create function public.library_sync_personal_lending_occupancy()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.returned_at is null then
      perform public.library_claim_available_book(new.book_id, 'personal', new.id);
    end if;
  elsif tg_op = 'DELETE' or (old.returned_at is null and new.returned_at is not null) then
    update public.library_lending_occupancy set active_kind = null, active_id = null
    where active_kind = 'personal' and active_id = old.id;
  end if;
  -- AFTER triggers return no row. This runs after existing validation and RLS.
  return null;
end;
$$;

create function public.library_sync_shared_lending_occupancy()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  target_book uuid;
begin
  if tg_op = 'DELETE' then
    if old.status = 'approved' then
      update public.library_lending_occupancy set active_kind = null, active_id = null
      where active_kind = 'shared' and active_id = old.id;
    end if;
    return null;
  end if;

  if tg_op = 'UPDATE' and old.status = 'approved' and new.status <> 'approved' then
    update public.library_lending_occupancy set active_kind = null, active_id = null
    where active_kind = 'shared' and active_id = old.id;
  elsif (tg_op = 'INSERT' and new.status = 'pending')
     or (new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved')) then
    select o.book_id into target_book
    from public.library_lending_offers o
    join public.books b on b.id = o.book_id and b.owner_id = o.owner_id
    join public.library_members m on m.user_id = o.owner_id and m.status = 'approved'
    where o.id = new.offer_id and o.enabled and b.deleted_at is null;
    if not found then
      raise exception 'Offer not available' using errcode = '22023';
    end if;
    if new.status = 'approved' then
      perform public.library_claim_available_book(target_book, 'shared', new.id);
    else
      perform public.library_claim_available_book(target_book, null, null);
    end if;
  end if;
  return null;
end;
$$;

revoke all on function public.library_claim_available_book(uuid, text, uuid),
  public.library_sync_personal_lending_occupancy(),
  public.library_sync_shared_lending_occupancy()
  from public, anon, authenticated, service_role;

create trigger personal_lending_occupancy
after insert or update or delete on public.personal_book_loans
for each row execute function public.library_sync_personal_lending_occupancy();

create trigger shared_lending_occupancy
after insert or update or delete on public.library_lending_requests
for each row execute function public.library_sync_shared_lending_occupancy();

-- Other members see available offers. Owners can still see and withdraw
-- their own offer while it has a personal or shared active loan.
create or replace function public.library_list_lending_offers(start_at integer default 0)
returns table (id uuid, title text, author text, mine boolean, available boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor uuid := public.library_lending_actor();
begin
  return query
  select o.id, o.title, o.author, o.owner_id = actor, occupancy.active_kind is null
  from public.library_lending_offers o
  join public.books b on b.id = o.book_id and b.owner_id = o.owner_id
  join public.library_members m on m.user_id = o.owner_id and m.status = 'approved'
  left join public.library_lending_occupancy occupancy on occupancy.book_id = b.id
  where o.enabled and b.deleted_at is null
    and (o.owner_id = actor or occupancy.active_kind is null)
  order by o.created_at desc, o.id
  limit 50 offset greatest(coalesce(start_at, 0), 0);
end;
$$;

revoke execute on function public.library_list_lending_offers(integer) from public, anon;
grant execute on function public.library_list_lending_offers(integer) to authenticated;

notify pgrst, 'reload schema';

-- GEMEINSAME-BIBLIOTHEK-BETA.sql
-- Run after ROLES-BETA.sql and the shared lending migration. Books remain
-- private. An approval releases only the submitted title, author, category
-- and, when requested, the exact submitted PDF version.


do $$
begin
  if not exists (select 1 from storage.buckets where id = 'library-files' and not public) then
    raise exception 'Expected the private library-files bucket';
  end if;
end;
$$;

create table public.library_book_shares (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) > 0),
  author text not null,
  category text not null,
  pdf_path text,
  pdf_object_id uuid,
  pdf_updated_at timestamptz,
  status text not null default 'pending' check (status in ('pending','approved','declined','withdrawn')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  check (
    (pdf_path is null and pdf_object_id is null and pdf_updated_at is null)
    or (pdf_path is not null and pdf_object_id is not null and pdf_updated_at is not null)
  )
);

create unique index library_book_shares_one_active
  on public.library_book_shares (book_id) where status in ('pending','approved');
create index library_book_shares_owner
  on public.library_book_shares (owner_id, created_at desc, id);
create index library_book_shares_approved_pdf
  on public.library_book_shares (pdf_path) where status = 'approved' and pdf_path is not null;

alter table public.library_book_shares enable row level security;
revoke all on public.library_book_shares from public, anon, authenticated, service_role;

create function public.library_share_pdf_path_matches(path text, owner_id uuid, book_id uuid)
returns boolean language sql immutable security invoker set search_path = ''
as $$
  select coalesce(
    path = owner_id::text || '/' || book_id::text || '/document.pdf'
    or path ~ (
      '^' || owner_id::text || '/' || book_id::text ||
      '/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/document[.]pdf$'
    ), false
  );
$$;

-- Pass Storage row identity into the SELECT policy helper. Looking up an
-- object from its own Storage row policy is unnecessary.
create function public.library_can_read_shared_pdf(object_name text, object_id uuid, object_changed_at timestamptz)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.library_members m
    where m.user_id = (select auth.uid()) and m.status = 'approved'
  ) and exists (
    select 1 from public.library_book_shares s
    join public.books b on b.id = s.book_id and b.owner_id = s.owner_id
    join public.library_members m on m.user_id = s.owner_id and m.status = 'approved'
    where s.status = 'approved'
      and b.visibility = 'private' and b.deleted_at is null
      and s.pdf_path = object_name and b.file_path = object_name
      and s.pdf_object_id = object_id and s.pdf_updated_at = object_changed_at
      and public.library_share_pdf_path_matches(object_name, s.owner_id, s.book_id)
  );
$$;

create function public.library_submit_book_share(target_book uuid, include_pdf boolean default false)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := public.library_lending_actor();
  book_row public.books%rowtype;
  object_id uuid;
  object_changed_at timestamptz;
  submission_id uuid;
begin
  if include_pdf is null then
    raise exception 'Choose whether to include the PDF' using errcode = '22023';
  end if;
  select b.* into book_row from public.books b
  where b.id = target_book and b.owner_id = actor
    and b.visibility = 'private' and b.deleted_at is null
  for share;
  if not found then
    raise exception 'Book not available for this account' using errcode = '42501';
  end if;

  if include_pdf then
    if not public.library_share_pdf_path_matches(book_row.file_path, actor, target_book) then
      raise exception 'No suitable PDF is attached to this book' using errcode = '22023';
    end if;
    select o.id, o.updated_at into object_id, object_changed_at
    from storage.objects o
    where o.bucket_id = 'library-files' and o.name = book_row.file_path;
    if not found or object_changed_at is null then
      raise exception 'The PDF is unavailable' using errcode = '22023';
    end if;
  end if;

  insert into public.library_book_shares (
    book_id, owner_id, title, author, category, pdf_path, pdf_object_id, pdf_updated_at
  ) values (
    target_book, actor, btrim(book_row.title), coalesce(book_row.author, ''),
    coalesce(book_row.category, ''), case when include_pdf then book_row.file_path end,
    object_id, object_changed_at
  ) returning id into submission_id;
  return submission_id;
end;
$$;

create function public.library_review_book_share(target_submission uuid, approve boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  submission public.library_book_shares%rowtype;
  current_path text;
begin
  if not public.library_beta_is_owner() then
    raise exception 'Only the library owner can review submissions' using errcode = '42501';
  end if;
  if approve is null then
    raise exception 'Choose whether to approve the submission' using errcode = '22023';
  end if;
  select s.* into submission from public.library_book_shares s
  where s.id = target_submission and s.status = 'pending'
  for update;
  if not found then
    raise exception 'Submission no longer pending' using errcode = '22023';
  end if;

  if approve then
    select b.file_path into current_path from public.books b
    join public.library_members m on m.user_id = b.owner_id and m.status = 'approved'
    where b.id = submission.book_id and b.owner_id = submission.owner_id
      and b.visibility = 'private' and b.deleted_at is null
    for share of b;
    if not found then
      raise exception 'The owner or book is no longer available' using errcode = '22023';
    end if;
    if submission.pdf_path is not null and (
      current_path is distinct from submission.pdf_path
      or not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'library-files' and o.name = submission.pdf_path
          and o.id = submission.pdf_object_id and o.updated_at = submission.pdf_updated_at
      )
    ) then
      raise exception 'PDF changed; ask the book owner to withdraw and submit again' using errcode = '22023';
    end if;
  end if;

  update public.library_book_shares
  set status = case when approve then 'approved' else 'declined' end, reviewed_at = statement_timestamp()
  where id = target_submission;
end;
$$;

create function public.library_withdraw_book_share(target_submission uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := public.library_lending_actor();
begin
  update public.library_book_shares s set status = 'withdrawn'
  where s.id = target_submission and s.status in ('pending','approved')
    and (s.owner_id = actor or public.library_beta_is_owner());
  if not found then
    raise exception 'Submission not available for withdrawal' using errcode = '42501';
  end if;
end;
$$;

create function public.library_list_shared_books(start_at integer default 0)
returns table (id uuid,title text,author text,category text,has_pdf boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.library_lending_actor();
  return query
  select s.id, s.title, s.author, s.category,
    s.pdf_path is not null and b.file_path is not distinct from s.pdf_path and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'library-files' and o.name = s.pdf_path
        and o.id = s.pdf_object_id and o.updated_at = s.pdf_updated_at
    )
  from public.library_book_shares s
  join public.books b on b.id = s.book_id and b.owner_id = s.owner_id
  join public.library_members m on m.user_id = s.owner_id and m.status = 'approved'
  where s.status = 'approved' and b.visibility = 'private' and b.deleted_at is null
  order by s.reviewed_at desc, s.id
  limit 50 offset greatest(coalesce(start_at,0),0);
end;
$$;

create function public.library_list_my_book_shares(start_at integer default 0)
returns table (id uuid,book_id uuid,title text,author text,category text,status text,include_pdf boolean,has_pdf boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor uuid := public.library_lending_actor();
begin
  return query
  select s.id, s.book_id, s.title, s.author, s.category, s.status, s.pdf_path is not null,
    s.status = 'approved' and b.visibility = 'private' and b.deleted_at is null
    and s.pdf_path is not null and b.file_path is not distinct from s.pdf_path and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'library-files' and o.name = s.pdf_path
        and o.id = s.pdf_object_id and o.updated_at = s.pdf_updated_at
    )
  from public.library_book_shares s
  join public.books b on b.id = s.book_id and b.owner_id = s.owner_id
  where s.owner_id = actor
  order by s.created_at desc, s.id
  limit 50 offset greatest(coalesce(start_at,0),0);
end;
$$;

create function public.library_list_book_shares_for_review(start_at integer default 0)
returns table (id uuid,book_id uuid,title text,author text,category text,status text,include_pdf boolean,has_pdf boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.library_beta_is_owner() then
    raise exception 'Only the library owner can view submissions for review' using errcode = '42501';
  end if;
  return query
  select s.id, s.book_id, s.title, s.author, s.category, s.status, s.pdf_path is not null, false
  from public.library_book_shares s
  where s.status = 'pending'
  order by s.created_at, s.id
  limit 50 offset greatest(coalesce(start_at,0),0);
end;
$$;

create function public.library_shared_book_pdf_path(target_submission uuid)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare
  released_path text;
begin
  perform public.library_lending_actor();
  select s.pdf_path into released_path
  from public.library_book_shares s
  join storage.objects o on o.bucket_id = 'library-files' and o.name = s.pdf_path
  where s.id = target_submission and s.status = 'approved'
    and public.library_can_read_shared_pdf(o.name, o.id, o.updated_at);
  if not found then
    raise exception 'An approved PDF is no longer available' using errcode = '42501';
  end if;
  return released_path;
end;
$$;

revoke all on function public.library_share_pdf_path_matches(text,uuid,uuid),
  public.library_can_read_shared_pdf(text,uuid,timestamptz),
  public.library_submit_book_share(uuid,boolean),
  public.library_review_book_share(uuid,boolean),
  public.library_withdraw_book_share(uuid),
  public.library_list_shared_books(integer),
  public.library_list_my_book_shares(integer),
  public.library_list_book_shares_for_review(integer),
  public.library_shared_book_pdf_path(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.library_can_read_shared_pdf(text,uuid,timestamptz),
  public.library_submit_book_share(uuid,boolean),
  public.library_review_book_share(uuid,boolean),
  public.library_withdraw_book_share(uuid),
  public.library_list_shared_books(integer),
  public.library_list_my_book_shares(integer),
  public.library_list_book_shares_for_review(integer),
  public.library_shared_book_pdf_path(uuid)
  to authenticated;

-- Keep existing owner permissions and the separate anonymous boundary.
-- The former ALL boundary cannot allow shared reads without also weakening
-- UPDATE/DELETE. Split it per operation so sharing releases only SELECT.
drop policy if exists "library file owner boundary" on storage.objects;
create policy "library file select boundary" on storage.objects as restrictive
for select to authenticated using (
  bucket_id <> 'library-files' or (
    (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.library_members m
      where m.user_id = (select auth.uid()) and m.status = 'approved'
    )
  ) or public.library_can_read_shared_pdf(name,id,updated_at)
);

create policy "library file insert boundary" on storage.objects as restrictive
for insert to authenticated with check (
  bucket_id <> 'library-files' or (
    (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.library_members m
      where m.user_id = (select auth.uid()) and m.status = 'approved'
    )
  )
);

create policy "library file update boundary" on storage.objects as restrictive
for update to authenticated using (
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

create policy "library file delete boundary" on storage.objects as restrictive
for delete to authenticated using (
  bucket_id <> 'library-files' or (
    (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.library_members m
      where m.user_id = (select auth.uid()) and m.status = 'approved'
    )
  )
);

create policy "library approved shared pdf read" on storage.objects
for select to authenticated using (
  bucket_id = 'library-files' and public.library_can_read_shared_pdf(name,id,updated_at)
);

notify pgrst, 'reload schema';

savepoint beta_release_audit;
-- Run inside a savepoint and roll it back before committing the release.
do $beta_audit$
declare
  owner_id_for_test uuid := current_setting('library.beta_owner_id')::uuid;
  other_id uuid;
  sample_book uuid;
  private_loan uuid;
  offered_book uuid;
  request_id uuid;
  shared_book uuid;
  test_pdf boolean;
  note_id uuid;
  wish_id uuid;
  effective_owner boolean;
begin
  if (select count(*) from public.library_beta_owner where user_id = owner_id_for_test) <> 1 then
    raise exception 'Owner bootstrap did not match the verified account';
  end if;
  select m.user_id into other_id from public.library_members m
  where m.status = 'approved' and m.user_id <> owner_id_for_test
  order by m.user_id limit 1;
  select b.id, exists (
    select 1 from storage.objects s where s.bucket_id = 'library-files' and s.name = b.file_path
  ) into sample_book, test_pdf from public.books b
  where b.owner_id = owner_id_for_test and b.visibility = 'private'
    and b.deleted_at is null and nullif(btrim(b.title), '') is not null
  order by b.id limit 1;

  perform set_config('request.jwt.claim.sub', owner_id_for_test::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id_for_test, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select access.is_owner into effective_owner from public.library_beta_get_access() access;
  if not coalesce(effective_owner, false) then raise exception 'Owner role missing'; end if;

  insert into public.library_notes(title, body)
  values ('Beta release check', 'Temporary note') returning id into note_id;
  update public.library_notes set body = 'Temporary updated note' where id = note_id;
  if not found then raise exception 'Note update failed'; end if;
  insert into public.library_wishlist(title, author)
  values ('Beta release check', 'Temporary author') returning id into wish_id;

  if sample_book is not null then
    insert into public.personal_book_loans(owner_id, book_id, borrower_label)
    values (owner_id_for_test, sample_book, 'Beta release check') returning id into private_loan;
    update public.personal_book_loans set returned_at = now() where id = private_loan;
    if not found then raise exception 'Personal return failed'; end if;
    offered_book := public.library_set_lending_offer(sample_book, true);
    if not exists (select 1 from public.library_list_lending_offers() o where o.id = offered_book and o.mine) then
      raise exception 'Owner lending offer missing';
    end if;
    shared_book := public.library_submit_book_share(sample_book, coalesce(test_pdf, false));
    perform public.library_review_book_share(shared_book, true);
  end if;

  if other_id is not null then
    perform public.library_beta_set_capabilities(other_id, array['shared_loan_review']);
    perform set_config('request.jwt.claim.sub', other_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
    if public.library_beta_is_owner() or public.library_has_capability('shared_category_manage')
      or not public.library_has_capability('shared_loan_review') then
      raise exception 'Co-admin role was granted too much or too little';
    end if;
    if exists (select 1 from public.library_notes where id = note_id)
      or exists (select 1 from public.library_wishlist where id = wish_id) then
      raise exception 'Private member item was visible to another account';
    end if;
    if offered_book is not null then
      request_id := public.library_request_loan(offered_book, 'Beta release check');
    end if;
    if shared_book is not null then
      if not exists (select 1 from public.library_list_shared_books() b where b.id = shared_book) then
        raise exception 'Approved shared book is not visible';
      end if;
      if test_pdf and public.library_shared_book_pdf_path(shared_book) is null then
        raise exception 'Approved shared PDF cannot be resolved';
      end if;
    end if;

    perform set_config('request.jwt.claim.sub', owner_id_for_test::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id_for_test, 'role', 'authenticated')::text, true);
    perform public.library_beta_set_capabilities(other_id, array[]::text[]);
    if request_id is not null then
      perform public.library_update_loan_request(request_id, 'approved');
      perform public.library_update_loan_request(request_id, 'returned');
    end if;
  end if;
  if shared_book is not null then
    perform public.library_withdraw_book_share(shared_book);
    if exists (select 1 from public.library_list_shared_books() b where b.id = shared_book) then
      raise exception 'Withdrawn shared book is still visible';
    end if;
  end if;
  reset role;
end;
$beta_audit$;
rollback to savepoint beta_release_audit;

commit;
