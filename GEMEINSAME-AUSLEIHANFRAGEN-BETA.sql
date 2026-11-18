-- Apply after ROLES-BETA.sql. Only explicitly offered physical books appear
-- in the member catalog. Private book records and files retain their own RLS.
begin;

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
commit;
