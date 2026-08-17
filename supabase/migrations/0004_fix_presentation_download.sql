-- =========================================================================
-- ExpoShare -- migration 0004: fix "object not found" when downloading
-- an approved presentation
-- =========================================================================
--
-- ROOT CAUSE: the only SELECT policy on the presentations storage
-- bucket allowed the file's owner or an admin to read it -- nobody
-- else, ever, even once the presentation was approved and listed in
-- the public library. From RLS's perspective a blocked row and a
-- nonexistent row are indistinguishable, which is exactly why the
-- Storage API surfaces this as "Object not found" instead of a
-- permissions error, and it affected every visitor who wasn't the
-- uploader (including the uploader themself on a session where
-- auth.uid() didn't resolve as expected).
--
-- Fix: add a policy that also allows read access whenever the file's
-- corresponding presentations row is approved, regardless of who is
-- asking. This is additive (OR'd with the existing owner/admin
-- policy from 0001), so owners still see their own pending/rejected/
-- hidden files too.

drop policy if exists "presentations_storage_select_approved_public" on storage.objects;
create policy "presentations_storage_select_approved_public" on storage.objects
  for select using (
    bucket_id = 'presentations' and exists (
      select 1 from public.presentations p
      where p.file_path = storage.objects.name and p.status = 'approved'
    )
  );

-- =========================================================================
-- End of migration 0004
-- =========================================================================
