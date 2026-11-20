begin;

create table if not exists public.library_menba_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  is_central boolean not null default false,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  category text not null check (char_length(btrim(category)) between 1 and 64),
  question text not null check (char_length(btrim(question)) between 1 and 500),
  description text not null default '' check (char_length(description) <= 300)
);

create index if not exists library_menba_templates_owner_idx
  on public.library_menba_templates(owner_id);

create table if not exists public.library_menba_template_favorites (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  template_id uuid not null references public.library_menba_templates(id) on delete cascade,
  primary key(user_id, template_id)
);

create index if not exists library_menba_template_favorites_template_idx
  on public.library_menba_template_favorites(template_id);

alter table public.library_menba_templates enable row level security;
alter table public.library_menba_template_favorites enable row level security;

revoke all on public.library_menba_templates, public.library_menba_template_favorites from public, anon, authenticated;
grant select (id, is_central, title, category, question, description) on public.library_menba_templates to authenticated;
grant insert (is_central, title, category, question, description) on public.library_menba_templates to authenticated;
grant update (title, category, question, description) on public.library_menba_templates to authenticated;
grant delete on public.library_menba_templates to authenticated;
grant select (template_id), insert (template_id), delete on public.library_menba_template_favorites to authenticated;

drop policy if exists menba_templates_read on public.library_menba_templates;
create policy menba_templates_read on public.library_menba_templates for select to authenticated
  using ((select exists (select 1 from public.library_menba_access())) and (is_central or owner_id = (select auth.uid())));

drop policy if exists menba_templates_insert on public.library_menba_templates;
create policy menba_templates_insert on public.library_menba_templates for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select exists (
    select 1 from public.library_menba_access() as access where not is_central or access.is_owner
  )));

drop policy if exists menba_templates_update on public.library_menba_templates;
create policy menba_templates_update on public.library_menba_templates for update to authenticated
  using (exists (select 1 from public.library_menba_access() as access
    where (is_central and access.is_owner) or (not is_central and owner_id = access.user_id)))
  with check (exists (select 1 from public.library_menba_access() as access
    where (is_central and access.is_owner) or (not is_central and owner_id = access.user_id)));

drop policy if exists menba_templates_delete on public.library_menba_templates;
create policy menba_templates_delete on public.library_menba_templates for delete to authenticated
  using (exists (select 1 from public.library_menba_access() as access
    where (is_central and access.is_owner) or (not is_central and owner_id = access.user_id)));

drop policy if exists menba_template_favorites_read on public.library_menba_template_favorites;
create policy menba_template_favorites_read on public.library_menba_template_favorites for select to authenticated
  using (user_id = (select auth.uid()) and exists (
    select 1 from public.library_menba_templates as template where template.id = template_id
  ));

drop policy if exists menba_template_favorites_insert on public.library_menba_template_favorites;
create policy menba_template_favorites_insert on public.library_menba_template_favorites for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.library_menba_templates as template where template.id = template_id
  ));

drop policy if exists menba_template_favorites_delete on public.library_menba_template_favorites;
create policy menba_template_favorites_delete on public.library_menba_template_favorites for delete to authenticated
  using (user_id = (select auth.uid()) and (select exists (select 1 from public.library_menba_access())));

commit;
