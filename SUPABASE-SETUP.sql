-- Run once in Supabase SQL Editor, as the project owner.
-- Requests are member-initiated and the email is copied from auth.users, never trusted from the browser.
create table if not exists public.password_reset_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 email text not null default '',
 status text not null default 'pending' check (status in ('pending','approved')),
 created_at timestamptz not null default now(),
 approved_at timestamptz
);
create or replace function public.set_password_reset_request_email()
returns trigger language plpgsql security definer set search_path = public,auth as $$
begin
 if new.user_id <> auth.uid() then raise exception 'Only own requests are allowed'; end if;
 select email into new.email from auth.users where id=new.user_id;
 if new.email is null then raise exception 'User email unavailable'; end if;
 new.status := 'pending';
 new.approved_at := null;
 return new;
end $$;
drop trigger if exists password_reset_request_email on public.password_reset_requests;
create trigger password_reset_request_email before insert on public.password_reset_requests
for each row execute function public.set_password_reset_request_email();
alter table public.password_reset_requests enable row level security;
revoke all on public.password_reset_requests from anon;
grant select,insert,update on public.password_reset_requests to authenticated;
drop policy if exists "Members request own reset" on public.password_reset_requests;
create policy "Members request own reset" on public.password_reset_requests for insert to authenticated
with check (user_id=auth.uid() and exists
 (select 1 from public.library_members m where m.user_id=auth.uid() and m.status='approved'));
drop policy if exists "Members see own reset requests" on public.password_reset_requests;
create policy "Members see own reset requests" on public.password_reset_requests for select to authenticated
using (user_id=auth.uid() or exists
 (select 1 from public.library_members m where m.user_id=auth.uid() and m.status='approved' and m.is_admin=true));
drop policy if exists "Admins approve reset requests" on public.password_reset_requests;
create policy "Admins approve reset requests" on public.password_reset_requests for update to authenticated
using (exists (select 1 from public.library_members m where m.user_id=auth.uid() and m.status='approved' and m.is_admin=true))
with check (exists (select 1 from public.library_members m where m.user_id=auth.uid() and m.status='approved' and m.is_admin=true));
-- Prevent changes to identity/email and approved status rollback even by an authenticated admin.
create or replace function public.guard_password_reset_approval()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.id<>old.id or new.user_id<>old.user_id or new.email<>old.email or new.created_at<>old.created_at
 or old.status<>'pending' or new.status<>'approved' or new.approved_at is null
 then raise exception 'Only pending-to-approved transitions are allowed'; end if;
 return new;
end $$;
drop trigger if exists guard_password_reset_approval on public.password_reset_requests;
create trigger guard_password_reset_approval before update on public.password_reset_requests
for each row execute function public.guard_password_reset_approval();
