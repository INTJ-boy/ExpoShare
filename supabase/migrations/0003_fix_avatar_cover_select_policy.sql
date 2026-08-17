-- =========================================================================
-- ExpoShare -- migration 0003: fix "new row violates row-level security
-- policy" on avatar/cover uploads
-- =========================================================================
--
-- ROOT CAUSE: Supabase's Storage API reads an object's row back right
-- after inserting it (an implicit RETURNING-style read), and that read
-- needs its own SELECT policy to succeed -- entirely separate from the
-- INSERT policy that was already correct. Migration 0001 only added a
-- SELECT policy for the "presentations" bucket; "avatars" and "covers"
-- never got one. So every upload to those two buckets was failing on
-- that invisible read-back, not on the actual insert -- which is why
-- the INSERT policy alone looked right but uploads still failed.
--
-- Both buckets are public-read by design (avatars/covers are meant to
-- be displayed to any visitor), so a public SELECT policy is the
-- correct, permanent fix.

drop policy if exists "avatars_storage_select_public" on storage.objects;
create policy "avatars_storage_select_public" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "covers_storage_select_public" on storage.objects;
create policy "covers_storage_select_public" on storage.objects
  for select using (bucket_id = 'covers');

-- =========================================================================
-- End of migration 0003
-- =========================================================================
