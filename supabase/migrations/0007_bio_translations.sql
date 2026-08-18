-- =========================================================================
-- ExpoShare -- migration 0007: bio auto-translation
-- =========================================================================
--
-- Cached auto-translations of a profile's bio, keyed by language:
-- {"en": "...", "fr": "...", "ar": "..."}. The original `bio` column
-- stays untouched (it's what the owner edits); bio_i18n is populated
-- by the translate-bio Edge Function whenever they save their profile,
-- and the frontend reads from it when displaying a bio in a language
-- other than the one it was written in.

alter table public.profiles add column if not exists bio_i18n jsonb;

-- =========================================================================
-- End of migration 0007
-- =========================================================================
