-- Personal lending history for the physical copies in a member's own library.
begin;

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

commit;
