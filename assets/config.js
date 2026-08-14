/**
 * ExpoShare: public configuration.
 *
 * SECURITY NOTE:
 * Only the Supabase URL and the PUBLISHABLE/ANON key belong here.
 * Never put the service_role key, DB password, or SMTP credentials
 * in this file or anywhere in this repository: the anon key is
 * safe to ship to the browser because every table is protected by
 * Row Level Security (see /supabase/migrations).
 *
 * Fill these two values in after creating your Supabase project
 * (Project Settings → API).
 */
window.EXPOSHARE_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-PUBLISHABLE-ANON-KEY",

  // Storage buckets (must match supabase/migrations)
  BUCKETS: {
    presentations: "presentations",
    covers: "covers",
    avatars: "avatars"
  },

  // Upload limits
  MAX_FILE_SIZE_MB: 50,
  MAX_COVER_SIZE_MB: 5,
  ALLOWED_FILE_TYPES: [
    "application/pdf",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ],
  ALLOWED_COVER_TYPES: ["image/jpeg", "image/jpg", "image/png", "image/webp"],

  DEFAULT_LANGUAGE: "en",
  SUPPORTED_LANGUAGES: ["en", "fr", "ar"],

  // Admin identity is enforced in the database (profiles.role = 'admin'
  // guarded by RLS + a SECURITY DEFINER check function). This constant
  // is display-only convenience metadata and grants NO access by itself.
  OWNER_EMAIL: "rabahallaa666@gmail.com",
  OWNER_LINKEDIN: "https://www.linkedin.com/in/zekraouirabahallaaeddine"
};

/**
 * Lazily-created singleton Supabase client.
 * Requires the Supabase JS library to be loaded on the page:
 * <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
 */
window.getSupabaseClient = function () {
  if (window.__exposhareClient) return window.__exposhareClient;
  if (!window.supabase || !window.supabase.createClient) {
    console.error("Supabase JS library not loaded. Include the supabase-js <script> tag before config.js consumers run.");
    return null;
  }
  window.__exposhareClient = window.supabase.createClient(
    window.EXPOSHARE_CONFIG.SUPABASE_URL,
    window.EXPOSHARE_CONFIG.SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );
  return window.__exposhareClient;
};
