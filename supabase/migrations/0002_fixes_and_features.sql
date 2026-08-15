-- =========================================================================
-- ExpoShare -- migration 0002: fixes + new features
-- Safe to run on top of 0001_init.sql. Uses IF NOT EXISTS / OR REPLACE
-- everywhere so it can also be re-run without side effects.
-- =========================================================================

-- -------------------------------------------------------------------------
-- FIX: "new row violates row-level security policy" on profile updates
-- (including setting an avatar).
-- -------------------------------------------------------------------------
-- The original profiles_update_self policy tried to block role changes
-- with an inline correlated subquery in WITH CHECK:
--   role = (select role from public.profiles p where p.id = auth.uid())
-- That pattern is fragile: RLS re-evaluates the SELECT policy on
-- profiles for that subquery on every UPDATE, and in some project
-- configurations the subquery can return no row / NULL, which makes the
-- whole WITH CHECK evaluate to NULL (rejected) rather than TRUE -- so
-- ordinary updates like changing your avatar or bio get blocked even
-- though you're not touching role at all.
--
-- Fix: keep RLS simple (own row only) and enforce "you can't promote
-- yourself" with a BEFORE UPDATE trigger instead, which is far more
-- predictable than a self-referencing policy subquery.

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Silently keep the old role unless an admin is making the change.
  -- (Admins update other rows via the admin-only policy below, which
  -- doesn't go through this "self" path at all, but the guard is kept
  -- here too in case an admin ever edits their own row.)
  if new.role is distinct from old.role and not public.is_admin() then
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists on_profiles_before_update on public.profiles;
create trigger on_profiles_before_update
  before update on public.profiles
  for each row execute function public.prevent_self_role_change();


-- -------------------------------------------------------------------------
-- CONTACT MESSAGES: replies + letting a sender read their own thread
-- -------------------------------------------------------------------------

alter table public.contact_messages add column if not exists admin_reply text;
alter table public.contact_messages add column if not exists replied_at timestamptz;
alter table public.contact_messages add column if not exists replied_by uuid references public.profiles(id);

drop policy if exists "contact_messages_select_own" on public.contact_messages;
create policy "contact_messages_select_own" on public.contact_messages
  for select using (auth.uid() = sender_id);


-- -------------------------------------------------------------------------
-- PROFILE RATINGS (stars only, no text -- "how good is this publisher")
-- -------------------------------------------------------------------------

create table if not exists public.profile_ratings (
  id uuid primary key default gen_random_uuid(),
  rater_id uuid not null references public.profiles(id) on delete cascade,
  ratee_id uuid not null references public.profiles(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rater_id, ratee_id),
  check (rater_id <> ratee_id)
);

create index if not exists idx_profile_ratings_ratee on public.profile_ratings(ratee_id);

alter table public.profile_ratings enable row level security;

-- Ratings are just numbers (no free text), so they're safe to expose
-- publicly for averaging on a contributor's profile page.
drop policy if exists "profile_ratings_select_all" on public.profile_ratings;
create policy "profile_ratings_select_all" on public.profile_ratings
  for select using (true);

drop policy if exists "profile_ratings_insert_own" on public.profile_ratings;
create policy "profile_ratings_insert_own" on public.profile_ratings
  for insert with check (auth.uid() = rater_id);

drop policy if exists "profile_ratings_update_own" on public.profile_ratings;
create policy "profile_ratings_update_own" on public.profile_ratings
  for update using (auth.uid() = rater_id)
  with check (auth.uid() = rater_id);

drop policy if exists "profile_ratings_delete_own_or_admin" on public.profile_ratings;
create policy "profile_ratings_delete_own_or_admin" on public.profile_ratings
  for delete using (auth.uid() = rater_id or public.is_admin());

-- Convenience view: average rating + count per profile, so the frontend
-- does one cheap read instead of aggregating client-side.
create or replace view public.profile_rating_summary as
select
  ratee_id as profile_id,
  round(avg(rating)::numeric, 2) as average_rating,
  count(*) as rating_count
from public.profile_ratings
group by ratee_id;

-- =========================================================================
-- End of migration 0002
-- =========================================================================
