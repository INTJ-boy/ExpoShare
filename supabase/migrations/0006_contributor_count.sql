-- =========================================================================
-- ExpoShare -- migration 0006: contributor count function
-- =========================================================================
--
-- Backs the homepage "Contributors" stat, which previously had no
-- code behind it at all (the HTML element existed, but nothing ever
-- updated it, so it was permanently stuck at 0). Counts distinct
-- people with at least one *approved* presentation, not every
-- registered account -- an account that never had anything approved
-- doesn't count as a contributor for this number.

create or replace function public.get_contributor_count()
returns integer
language sql
security invoker
stable
set search_path = public
as $$
  select count(distinct owner_id)::integer from public.presentations where status = 'approved';
$$;

grant execute on function public.get_contributor_count() to anon, authenticated;

-- =========================================================================
-- End of migration 0006
-- =========================================================================
