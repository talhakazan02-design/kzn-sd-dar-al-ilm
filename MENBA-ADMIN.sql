begin;

create table if not exists public.library_menba_hocas (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.library_menba_hocas enable row level security;
revoke all on public.library_menba_hocas from public, anon, authenticated;

create or replace function public.library_menba_access()
returns table (user_id uuid, is_owner boolean, is_hoca boolean)
language sql stable security definer set search_path = ''
as $$
  select member.user_id, public.library_beta_is_owner(),
    public.library_beta_is_owner() or exists (
      select 1 from public.library_menba_hocas hoca where hoca.user_id = member.user_id
    )
  from public.library_members member
  where member.user_id = (select auth.uid()) and member.status = 'approved';
$$;

create or replace function public.library_menba_get_hoca(target_user_id uuid)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
begin
  if public.library_beta_is_owner() is not true then
    raise exception 'Owner required' using errcode = '42501';
  end if;
  return exists (select 1 from public.library_menba_hocas hoca where hoca.user_id = target_user_id);
end;
$$;

create or replace function public.library_menba_set_hoca(target_user_id uuid, enabled boolean)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if public.library_beta_is_owner() is not true then
    raise exception 'Owner required' using errcode = '42501';
  end if;
  if enabled is null or target_user_id is null or target_user_id = (select auth.uid()) then
    raise exception 'Invalid member' using errcode = '22023';
  end if;
  if enabled then
    perform 1 from public.library_members member
      where member.user_id = target_user_id and member.status = 'approved' for share;
    if not found then
      raise exception 'Approved member required' using errcode = '22023';
    end if;
    insert into public.library_menba_hocas (user_id) values (target_user_id) on conflict do nothing;
  else
    delete from public.library_menba_hocas where user_id = target_user_id;
  end if;
  return enabled;
end;
$$;

create or replace function public.library_list_membership_requests()
returns table (user_id uuid, email text, confirmed boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if public.library_beta_is_owner() is not true then
    raise exception 'Owner required' using errcode = '42501';
  end if;
  return query
    select account.id, account.email::text, account.email_confirmed_at is not null
    from public.library_members member
    join auth.users account on account.id = member.user_id
    where member.status = 'pending' and member.is_admin is not true
    order by account.created_at, account.id
    limit 50;
end;
$$;

create or replace function public.library_review_membership(target_user_id uuid, approve boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  decision public.library_members.status%type;
begin
  if public.library_beta_is_owner() is not true then
    raise exception 'Owner required' using errcode = '42501';
  end if;
  if approve is null or (approve and not exists (
    select 1 from auth.users account where account.id = target_user_id and account.email_confirmed_at is not null
  )) then
    raise exception 'Verified email required' using errcode = '22023';
  end if;
  decision := case when approve then 'approved' else 'rejected' end;
  update public.library_members as member
    set status = decision
    where member.user_id = target_user_id and member.status = 'pending' and member.is_admin is not true;
  if not found then
    raise exception 'Request is no longer pending' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.library_list_pending_admin_loans()
returns table (id uuid, offer_title text, handover_note text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if public.library_beta_is_owner() is not true then
    raise exception 'Owner required' using errcode = '42501';
  end if;
  return query
    select request.id, offer.title, request.handover_note
    from public.library_lending_requests request
    join public.library_lending_offers offer on offer.id = request.offer_id
    where request.status = 'pending' and request.borrower_id <> (select auth.uid())
    order by request.created_at, request.id
    limit 50;
end;
$$;

revoke execute on function public.library_menba_access(),
  public.library_menba_get_hoca(uuid), public.library_menba_set_hoca(uuid,boolean),
  public.library_list_membership_requests(), public.library_review_membership(uuid,boolean),
  public.library_list_pending_admin_loans()
  from public, anon, authenticated;
grant execute on function public.library_menba_access(),
  public.library_menba_get_hoca(uuid), public.library_menba_set_hoca(uuid,boolean),
  public.library_list_membership_requests(), public.library_review_membership(uuid,boolean),
  public.library_list_pending_admin_loans()
  to authenticated;

commit;
