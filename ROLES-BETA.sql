-- Additive role foundation. Existing admin policies remain in force until
-- each affected feature has been migrated to the capability checks below.
begin;

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

commit;
