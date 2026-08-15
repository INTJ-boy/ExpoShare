# ExpoShare 🦑

![ExpoShare banner](assets/icons/og-image.png)

A community platform for uploading and discovering educational
presentations, built with vanilla HTML/CSS/JS on the frontend and
Supabase (Postgres + Auth + Storage + RLS) on the backend.

---

## 1. What's actually finished vs. what needs your input

**Built and ready to run, once you plug in a Supabase project:**
- All 14 pages (home, browse, upload, presentation detail, templates,
  login/signup/forgot/update-password, profile, public profile, admin,
  about, contact)
- Full trilingual i18n engine (EN/FR/AR, 273 keys each, verified 1:1
  parity: see `data/i18n/`), with RTL for Arabic
- Hierarchical taxonomy (`data/taxonomy.json`): 25 fields, including
  the required deep Science → Biology → Microbiology tree, the full
  35-sport Sports field kept independent of Science, and a 20-discipline
  Engineering tree
- Supabase Auth flows: sign up, log in, log out, forgot/reset password,
  session persistence
- Upload flow with drag-drop, client-side validation, storage upload,
  tag chips, anonymous-attribution toggle
- Admin panel: queue, status filter, search, taxonomy correction,
  reviewer notes, approve/reject/request-changes/delete, reports tab
- Full Postgres schema + **Row Level Security** in
  `supabase/migrations/0001_init.sql`: admin is enforced by a
  `profiles.role` column checked through a `SECURITY DEFINER`
  `is_admin()` function, **not** a frontend email check
- Toasts, modals, loading screen, button spinners, expanding
  Cmd/Ctrl+K search, skeleton loading, card hover/lift, ripple clicks,
  `prefers-reduced-motion` support
- Fallback cover generation (canvas) when no cover is uploaded
- Onyx (#020202) × Candy Blue (#B2D5E5) theme end-to-end via CSS
  variables: verified no stray colors in `style.css`

**You still need to do this: I have no network access to do it for you:**
1. Create a Supabase project.
2. Run `supabase/migrations/0001_init.sql` in the SQL editor (or via
   `supabase db push`). This creates every table, RLS policy, storage
   bucket, and the `is_admin()` / `handle_new_user()` functions.
3. Copy your project's **URL** and **anon/publishable key** into
   `assets/config.js` (never the `service_role` key: see the comment
   in that file).
4. Sign up once with `rabahallaa666@gmail.com`: the
   `handle_new_user()` trigger automatically grants that account
   `role = 'admin'` in the database. No other account can become admin,
   including through DevTools, because the check lives in Postgres.
5. Deploy the repo root to GitHub Pages (Settings → Pages → deploy from
   branch). No build step is required.

**Genuinely untestable without live infra (I can't verify these from
here, no browser/network in this environment):**
- End-to-end auth + email delivery (Supabase handles the emails, but
  you should send yourself a real signup/reset and confirm they land)
- Storage signed URLs / RLS behavior against live traffic
- Arabic RTL rendering in an actual browser (the CSS logical
  properties: `inset-inline-*`, `dir` attribute: are in place, but
  I'd want you to eyeball it)
- Mobile layout on a real device
- File size limits against your actual Supabase plan's storage quota

## 2. What I deliberately simplified

Given the scope, a few things are intentionally scaffolded rather than
fully productionized: flagged here so nothing is mistaken for
"finished and hardened":

- **PPT/PPTX live preview**: not implemented (the spec explicitly says
  not to fake this). The presentation page shows metadata + a download
  button via a signed URL; PDFs could be extended to use
  `<embed>`/`pdf.js` for in-browser preview.
- **Email notifications beyond Supabase Auth** (approval/rejection
  emails) are not wired to an Edge Function: the in-app `notifications`
  table + UI is fully functional, but outbound email would need an
  Edge Function with its own secret (kept out of this repo on purpose).
- **Reviewer note visibility on edit**: the RLS policy lets an owner
  update their own pending/changes-requested submission, but locks out
  changes to `status`/`reviewer_note` from the client: correct, but
  you may want an edit form UI on profile.html for resubmission (not
  built yet).
- **Templates** are hardcoded in `templates.html` rather than read from
  the `templates` table: the table exists and is RLS-protected for
  future admin-editable templates, but nothing currently writes to it.

## 3. Meta tags, favicons, and social previews

Every page now has a real favicon set, `theme-color`, Open Graph tags,
and Twitter Card tags, plus a `manifest.json` for "Add to Home Screen"
and a `robots.txt` that keeps `admin.html`, `profile.html`,
`update-password.html`, and `forgot-password.html` out of search
results.

**One thing you need to do after deploying**: search-and-replace
`https://YOUR-USERNAME.github.io/YOUR-REPO/` across all `.html` files
(and in `robots.txt`'s commented sitemap line, if you add one) with
your actual GitHub Pages URL. It's used in `canonical`, `og:url`, and
`og:image`/`twitter:image` tags. Until you replace it, link previews
on social apps will point at a URL that doesn't resolve.

```
grep -rl "YOUR-USERNAME.github.io/YOUR-REPO" *.html | \
  xargs sed -i 's#https://YOUR-USERNAME.github.io/YOUR-REPO/#https://your-actual-username.github.io/your-actual-repo/#g'
```

The favicon/OG image (`assets/icons/`) is a small geometric squid mark
generated to match the Onyx/Candy Blue theme. Swap it for your own
artwork any time by replacing the files in that folder (keep the same
filenames and it'll just work).

## 4. File structure

```
/
├── index.html, browse.html, upload.html, presentation.html,
│   templates.html, login.html, signup.html, forgot-password.html,
│   update-password.html, profile.html, public-profile.html,
│   admin.html, about.html, contact.html
├── manifest.json
├── robots.txt
├── assets/
│   ├── style.css       (Onyx × Candy Blue design system)
│   ├── config.js        (Supabase URL/anon key: fill this in)
│   ├── i18n.js           (translation engine)
│   ├── lang-switch.js    (header language dropdown)
│   ├── app.js            (toasts, modals, loading screen, search, mascot)
│   ├── auth.js            (Supabase Auth wrapper)
│   ├── browse.js
│   ├── upload.js
│   ├── admin.js
│   ├── profile.js
│   └── icons/             (favicons, apple-touch-icon, manifest icons, OG image)
├── data/
│   ├── taxonomy.json
│   ├── socials.json
│   └── i18n/{en,fr,ar}.json
└── supabase/
    └── migrations/0001_init.sql
```

## 5. Security notes

- No secret ever appears in this repo: `config.js` only holds the
  publishable anon key, which is safe to ship because every table has
  RLS enabled and every policy is scoped to `auth.uid()` or
  `is_admin()`.
- Storage buckets: `presentations` is private (owner/admin read only,
  or short-lived signed URL); `covers` and `avatars` are public-read
  buckets but writes are still restricted to the uploader's own
  `{user_id}/...` folder.
- The admin identity is **never** `if (email === "...")` in JavaScript.
  It's a `role` column set once by a Postgres trigger and checked by a
  `SECURITY DEFINER` function on every sensitive query.

## 6. Second migration: run this too

`supabase/migrations/0002_fixes_and_features.sql` must be run in your
Supabase SQL editor (after `0001_init.sql`) for the following to work:

- **Fixes the "new row violates row-level security policy" error on
  profile updates/avatars.** The original `profiles_update_self` policy
  used a self-referencing subquery to block role changes, which could
  evaluate to NULL and reject ordinary updates (like setting an
  avatar) that never touched `role` at all. Replaced with a plain
  own-row policy plus a `BEFORE UPDATE` trigger that's far more
  reliable.
- Adds `profile_ratings` (star-only ratings on a contributor's public
  profile) and the `profile_rating_summary` view the frontend reads
  from.
- Adds `admin_reply` / `replied_at` / `replied_by` to
  `contact_messages`, plus a policy letting a sender read their own
  submitted messages (visible on their Profile page under "Your
  messages").

## 7. Email notifications (optional)

Approval/rejection/changes-requested and contact-form replies always
show up **in-app** (notification bell in the header, and "Your
messages" on the Profile page) with no setup required. Actually
**emailing** people additionally requires a third-party email
provider, since Supabase Auth's built-in email only covers
sign-up/password-reset, not custom notifications.

`supabase/functions/send-email/index.ts` is a ready-to-deploy Edge
Function using [Resend](https://resend.com) (their free tier is enough
to start). To turn it on:

```
supabase secrets set RESEND_API_KEY=your_resend_key
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
supabase functions deploy send-email
```

The `SUPABASE_SERVICE_ROLE_KEY` is only ever read inside this
server-side function, never shipped to the browser: that's what Edge
Function secrets are for. Until these are configured, admin.js's calls
to it fail silently (caught with `.catch(() => {})`) so missing email
setup never blocks the in-app notification, which is always saved
regardless.

## 8. Donation section

A "Support ExpoShare" link is auto-injected into the footer of every
page (see `ExpoShare.insertDonationTrigger()` in `assets/app.js`).
Clicking it opens a modal with a Quran verse and your CCP/BaridiMob
details, click-to-copy on each field. Nothing here needs Supabase or
any external service: it's fully static content, translated into all
three languages.
