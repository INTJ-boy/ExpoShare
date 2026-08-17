-- =========================================================================
-- ExpoShare -- migration 0005: view/download counters + bookmarks
-- =========================================================================

-- -------------------------------------------------------------------------
-- View / download counters
-- -------------------------------------------------------------------------
-- Incremented only via these SECURITY DEFINER RPCs, never via a direct
-- client .update() call -- so nobody can inflate their own
-- presentation's numbers by calling the update endpoint directly.
-- Each function only touches approved rows and only ever adds 1.

alter table public.presentations add column if not exists view_count integer not null default 0;
alter table public.presentations add column if not exists download_count integer not null default 0;

create or replace function public.increment_view_count(presentation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.presentations
  set view_count = view_count + 1
  where id = presentation_id and status = 'approved';
end;
$$;

create or replace function public.increment_download_count(presentation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.presentations
  set download_count = download_count + 1
  where id = presentation_id and status = 'approved';
end;
$$;

grant execute on function public.increment_view_count(uuid) to anon, authenticated;
grant execute on function public.increment_download_count(uuid) to anon, authenticated;

-- -------------------------------------------------------------------------
-- Bookmarks ("save for later")
-- -------------------------------------------------------------------------

create table if not exists public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  presentation_id uuid not null references public.presentations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, presentation_id)
);

alter table public.bookmarks enable row level security;

drop policy if exists "bookmarks_select_own" on public.bookmarks;
create policy "bookmarks_select_own" on public.bookmarks
  for select using (auth.uid() = user_id);

drop policy if exists "bookmarks_insert_own" on public.bookmarks;
create policy "bookmarks_insert_own" on public.bookmarks
  for insert with check (auth.uid() = user_id);

drop policy if exists "bookmarks_delete_own" on public.bookmarks;
create policy "bookmarks_delete_own" on public.bookmarks
  for delete using (auth.uid() = user_id);

create index if not exists idx_bookmarks_user on public.bookmarks(user_id);

-- =========================================================================
-- End of migration 0005
-- =========================================================================
