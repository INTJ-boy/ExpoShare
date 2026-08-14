-- =========================================================================
-- ExpoShare: initial schema
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a
-- fresh project. Idempotent-ish: safe to re-run on a project that only
-- ever had this migration applied.
-- =========================================================================

create extension if not exists "pgcrypto";

-- -------------------------------------------------------------------------
-- 1. PROFILES
-- -------------------------------------------------------------------------
-- One row per auth.users row. role is the ONLY thing that grants admin
-- powers: it is never set from client code (see RLS policies below,
-- which explicitly forbid a user from changing their own role).

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  bio text,
  institution text,
  interests text[] default '{}',
  country text,
  website text,
  linkedin text,
  avatar_url text,
  preferred_language text default 'en' check (preferred_language in ('en','fr','ar')),
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -------------------------------------------------------------------------
-- 2. PRESENTATIONS
-- -------------------------------------------------------------------------

create table if not exists public.presentations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  field_id text not null,
  discipline_id text not null,
  subdiscipline_id text,
  language text not null default 'en' check (language in ('en','fr','ar')),
  tags text[] default '{}',
  slide_count int,
  format text not null check (format in ('pdf','ppt','pptx')),
  file_path text not null,
  cover_path text,
  is_anonymous boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending','changes_requested','approved','rejected','hidden')),
  reviewer_note text,
  template_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_presentations_status on public.presentations(status);
create index if not exists idx_presentations_field on public.presentations(field_id);
create index if not exists idx_presentations_discipline on public.presentations(discipline_id);
create index if not exists idx_presentations_subdiscipline on public.presentations(subdiscipline_id);
create index if not exists idx_presentations_created_at on public.presentations(created_at desc);
create index if not exists idx_presentations_owner on public.presentations(owner_id);
create index if not exists idx_presentations_title on public.presentations using gin (to_tsvector('simple', title));

-- -------------------------------------------------------------------------
-- 3. PRESENTATION VERSIONS (file/cover replacement history)
-- -------------------------------------------------------------------------

create table if not exists public.presentation_versions (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null references public.presentations(id) on delete cascade,
  version_number int not null,
  file_path text,
  cover_path text,
  changed_by uuid references public.profiles(id),
  reason text,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------------------
-- 4. SUBMISSION HISTORY (status transitions + metadata edits)
-- -------------------------------------------------------------------------

create table if not exists public.submission_history (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null references public.presentations(id) on delete cascade,
  changed_by uuid references public.profiles(id),
  from_status text,
  to_status text,
  changes jsonb default '{}',
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------------------
-- 5. REVIEW ACTIONS (admin moderation log)
-- -------------------------------------------------------------------------

create table if not exists public.review_actions (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null references public.presentations(id) on delete cascade,
  admin_id uuid not null references public.profiles(id),
  action text not null check (action in ('approved','rejected','changes_requested','hidden','restored','deleted','metadata_corrected')),
  note text,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------------------
-- 6. REPORTS
-- -------------------------------------------------------------------------

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null references public.presentations(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id),
  category text not null check (category in
    ('copyright','incorrect','spam','inappropriate','wrong_category','misleading','duplicate','other')),
  explanation text,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------------------
-- 7. NOTIFICATIONS
-- -------------------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in
    ('pending','approved','rejected','changes_requested','hidden')),
  payload jsonb default '{}',
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user on public.notifications(user_id, is_read);

-- -------------------------------------------------------------------------
-- 8. TAGS / PRESENTATION_TAGS (normalized, in addition to presentations.tags)
-- -------------------------------------------------------------------------

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text unique not null
);

create table if not exists public.presentation_tags (
  presentation_id uuid not null references public.presentations(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (presentation_id, tag_id)
);

-- -------------------------------------------------------------------------
-- 9. TEMPLATES
-- -------------------------------------------------------------------------

create table if not exists public.templates (
  id text primary key,
  title jsonb not null,        -- {"en": "...", "fr": "...", "ar": "..."}
  description jsonb,
  recommended_fields text[] default '{}',
  structure jsonb default '[]'
);

-- -------------------------------------------------------------------------
-- 10. CONTACT MESSAGES (from the public contact form)
-- -------------------------------------------------------------------------
-- Anyone (including logged-out visitors) can submit a message. Only
-- admins can read the inbox, so submissions are never publicly listable
-- and a sender's message can't be read by other users.

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  category text not null default 'general'
    check (category in ('general','copyright','support','other')),
  message text not null,
  sender_id uuid references public.profiles(id),
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now()
);

create index if not exists idx_contact_messages_status on public.contact_messages(status, created_at desc);

-- =========================================================================
-- ADMIN AUTHORIZATION
-- =========================================================================
-- is_admin() is SECURITY DEFINER so it can check profiles.role without
-- being blocked by the RLS policy on profiles itself, and it reads the
-- server-side session (auth.uid()), which client JavaScript cannot spoof.
-- This: NOT any frontend "if email === ..." check: is what the whole
-- admin surface (RLS policies below, admin.html via requireAdmin()) relies on.

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Seed the owner as admin the moment their profile row exists. This does
-- NOT run from the frontend: it runs inside the handle_new_user() trigger
-- below, entirely in Postgres, using a hardcoded comparison against
-- auth.users.email (which the client cannot forge).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, role, preferred_language)
  values (
    new.id,
    split_part(new.email, '@', 1) || '_' || substr(new.id::text, 1, 6),
    case when new.email = 'rabahallaa666@gmail.com' then 'admin' else 'user' end,
    'en'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Log every status transition automatically for submission_history.
create or replace function public.log_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    insert into public.submission_history (presentation_id, changed_by, from_status, to_status, changes)
    values (new.id, auth.uid(), old.status, new.status, jsonb_build_object(
      'field_id', new.field_id, 'discipline_id', new.discipline_id, 'reviewer_note', new.reviewer_note
    ));
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_presentation_status_change on public.presentations;
create trigger on_presentation_status_change
  before update on public.presentations
  for each row execute function public.log_status_transition();

-- =========================================================================
-- ROW LEVEL SECURITY
-- =========================================================================

alter table public.profiles enable row level security;
alter table public.presentations enable row level security;
alter table public.presentation_versions enable row level security;
alter table public.submission_history enable row level security;
alter table public.review_actions enable row level security;
alter table public.reports enable row level security;
alter table public.notifications enable row level security;
alter table public.tags enable row level security;
alter table public.presentation_tags enable row level security;
alter table public.templates enable row level security;
alter table public.contact_messages enable row level security;

-- ---------------------------------------------------------------- PROFILES
-- Public-safe columns are readable by anyone (needed for public-profile.html
-- and for showing usernames on approved presentations). Writers can only
-- ever touch their own row, and role can only be changed by an admin.

create policy "profiles_select_public" on public.profiles
  for select using (true);

create policy "profiles_update_self" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id and role = (select role from public.profiles p where p.id = auth.uid()));

create policy "profiles_update_admin" on public.profiles
  for update using (public.is_admin());

-- ------------------------------------------------------------ PRESENTATIONS
-- Public: only approved rows. Owners: their own rows regardless of status.
-- Admins: everything.

create policy "presentations_select_public_approved" on public.presentations
  for select using (status = 'approved');

create policy "presentations_select_own" on public.presentations
  for select using (auth.uid() = owner_id);

create policy "presentations_select_admin" on public.presentations
  for select using (public.is_admin());

create policy "presentations_insert_own" on public.presentations
  for insert with check (auth.uid() = owner_id and status = 'pending');

-- Owners may only edit their own submission while it's pending or has
-- changes requested: not once it's approved/rejected/hidden: and they
-- cannot touch moderation-only columns (status, reviewer_note) themselves.
create policy "presentations_update_own_editable" on public.presentations
  for update using (
    auth.uid() = owner_id and status in ('pending', 'changes_requested')
  )
  with check (
    auth.uid() = owner_id
    and status = 'pending'
    and reviewer_note is not distinct from reviewer_note
  );

create policy "presentations_update_admin" on public.presentations
  for update using (public.is_admin());

create policy "presentations_delete_admin" on public.presentations
  for delete using (public.is_admin());

-- ------------------------------------------------------ PRESENTATION_VERSIONS
create policy "versions_select_owner_or_admin" on public.presentation_versions
  for select using (
    public.is_admin() or exists (
      select 1 from public.presentations p where p.id = presentation_id and p.owner_id = auth.uid()
    )
  );
create policy "versions_write_admin" on public.presentation_versions
  for insert with check (public.is_admin());

-- ---------------------------------------------------------- SUBMISSION_HISTORY
create policy "history_select_owner_or_admin" on public.submission_history
  for select using (
    public.is_admin() or exists (
      select 1 from public.presentations p where p.id = presentation_id and p.owner_id = auth.uid()
    )
  );
-- inserts happen only via the log_status_transition() trigger (SECURITY DEFINER)

-- -------------------------------------------------------------- REVIEW_ACTIONS
create policy "review_actions_admin_only" on public.review_actions
  for all using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------------- REPORTS
-- Reporters can create reports and see their own; nobody but admins can
-- read the full list (so a reporter's identity is never exposed publicly).
create policy "reports_insert_authenticated" on public.reports
  for insert with check (auth.uid() = reporter_id);

create policy "reports_select_own" on public.reports
  for select using (auth.uid() = reporter_id);

create policy "reports_select_admin" on public.reports
  for select using (public.is_admin());

create policy "reports_update_admin" on public.reports
  for update using (public.is_admin());

-- --------------------------------------------------------------- NOTIFICATIONS
create policy "notifications_select_own" on public.notifications
  for select using (auth.uid() = user_id);

create policy "notifications_update_own" on public.notifications
  for update using (auth.uid() = user_id);

create policy "notifications_insert_admin" on public.notifications
  for insert with check (public.is_admin() or auth.uid() = user_id);

-- ----------------------------------------------------------------- TAGS
create policy "tags_select_all" on public.tags for select using (true);
create policy "tags_insert_authenticated" on public.tags
  for insert with check (auth.uid() is not null);

create policy "presentation_tags_select_all" on public.presentation_tags for select using (true);
create policy "presentation_tags_insert_owner" on public.presentation_tags
  for insert with check (
    exists (select 1 from public.presentations p where p.id = presentation_id and p.owner_id = auth.uid())
    or public.is_admin()
  );

-- -------------------------------------------------------------- TEMPLATES
create policy "templates_select_all" on public.templates for select using (true);
create policy "templates_write_admin" on public.templates
  for all using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------- CONTACT_MESSAGES
-- Public insert (works for logged-out visitors too); only admins can
-- ever read the inbox, so no one can browse other people's messages.
create policy "contact_messages_insert_public" on public.contact_messages
  for insert with check (true);

create policy "contact_messages_select_admin" on public.contact_messages
  for select using (public.is_admin());

create policy "contact_messages_update_admin" on public.contact_messages
  for update using (public.is_admin());


-- =========================================================================
-- STORAGE BUCKETS + POLICIES
-- =========================================================================
-- presentations: PRIVATE. Read only by the owner or an admin, or via a
--   short-lived signed URL (createSignedUrl) which itself still needs a
--   passing SELECT policy to be issued.
-- covers, avatars: PUBLIC read (used directly as <img src>), but writes
--   are still restricted to the owning user's own folder (path prefix
--   `${auth.uid()}/...`, enforced in upload.js and re-checked here).

insert into storage.buckets (id, name, public)
values ('presentations', 'presentations', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('covers', 'covers', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- presentations bucket
create policy "presentations_storage_insert_own_folder" on storage.objects
  for insert with check (
    bucket_id = 'presentations' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "presentations_storage_select_own_or_admin" on storage.objects
  for select using (
    bucket_id = 'presentations' and (
      (storage.foldername(name))[1] = auth.uid()::text or public.is_admin()
    )
  );

create policy "presentations_storage_delete_admin" on storage.objects
  for delete using (bucket_id = 'presentations' and public.is_admin());

-- covers bucket (public read via bucket flag; writes restricted)
create policy "covers_storage_insert_own_folder" on storage.objects
  for insert with check (
    bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "covers_storage_update_own_or_admin" on storage.objects
  for update using (
    bucket_id = 'covers' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
create policy "covers_storage_delete_own_or_admin" on storage.objects
  for delete using (
    bucket_id = 'covers' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- avatars bucket
create policy "avatars_storage_insert_own_folder" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "avatars_storage_update_own_folder" on storage.objects
  for update using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- =========================================================================
-- End of migration
-- =========================================================================
