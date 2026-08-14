/**
 * ExpoShare authentication.
 * Thin wrapper around Supabase Auth: sign up, sign in, sign out,
 * password recovery, session state, and the shared header wiring
 * (login/logout button, avatar, admin link visibility).
 *
 * IMPORTANT: the "Admin" link/page is a UI convenience only. Real
 * authorization is enforced by RLS in Postgres via the profiles.role
 * column and the is_admin() SECURITY DEFINER function: see
 * /supabase/migrations/0001_init.sql. Nothing here grants access.
 */
window.ExpoShareAuth = (function () {
  let currentUser = null;
  let currentProfile = null;

  function client() {
    return window.getSupabaseClient();
  }

  async function signUp(email, password) {
    const sb = client();
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const sb = client();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const sb = client();
    const { error } = await sb.auth.signOut();
    if (error) throw error;
    currentUser = null;
    currentProfile = null;
  }

  async function sendPasswordReset(email, redirectTo) {
    const sb = client();
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo || `${window.location.origin}${window.location.pathname.replace(/[^/]+$/, "")}update-password.html`
    });
    if (error) throw error;
  }

  async function updatePassword(newPassword) {
    const sb = client();
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  async function getSession() {
    const sb = client();
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  /**
   * Fetches the caller's own profile row. RLS guarantees a user can
   * only ever read their own row through this path unless they are
   * flagged admin server-side.
   */
  async function loadProfile(userId) {
    const sb = client();
    const { data, error } = await sb
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (error) {
      console.warn("Could not load profile:", error.message);
      return null;
    }
    return data;
  }

  async function init() {
    const sb = client();
    if (!sb) return null;
    const session = await getSession();
    if (session && session.user) {
      currentUser = session.user;
      currentProfile = await loadProfile(session.user.id);
    }
    sb.auth.onAuthStateChange(async (_event, session) => {
      currentUser = session ? session.user : null;
      currentProfile = currentUser ? await loadProfile(currentUser.id) : null;
      wireHeader();
    });
    wireHeader();
    return currentUser;
  }

  function isLoggedIn() {
    return !!currentUser;
  }

  function isAdmin() {
    return !!currentProfile && currentProfile.role === "admin";
  }

  function user() {
    return currentUser;
  }

  function profile() {
    return currentProfile;
  }

  /* --------------------------------------------------------- Header wiring */

  function wireHeader() {
    const loginBtn = document.getElementById("es-nav-login");
    const signupBtn = document.getElementById("es-nav-signup");
    const logoutBtn = document.getElementById("es-nav-logout");
    const profileLink = document.getElementById("es-nav-profile");
    const adminLink = document.getElementById("es-nav-admin");
    const uploadLink = document.getElementById("es-nav-upload");

    const loggedIn = isLoggedIn();
    [loginBtn, signupBtn].forEach((el) => el && el.classList.toggle("es-hidden", loggedIn));
    [logoutBtn, profileLink].forEach((el) => el && el.classList.toggle("es-hidden", !loggedIn));
    if (uploadLink) uploadLink.classList.toggle("es-hidden", !loggedIn);
    if (adminLink) adminLink.classList.toggle("es-hidden", !isAdmin());

    if (logoutBtn && !logoutBtn.dataset.wired) {
      logoutBtn.dataset.wired = "1";
      logoutBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          await signOut();
          window.ExpoShare.toast(window.i18n.t("nav.logout"), { type: "success" });
          setTimeout(() => (window.location.href = "index.html"), 400);
        } catch (err) {
          window.ExpoShare.toast(err.message || window.i18n.t("errors.generic"), { type: "error" });
        }
      });
    }
  }

  /**
   * Guards a page behind login. Call at top of protected pages.
   * Redirects to login.html if there's no session after init resolves.
   */
  async function requireAuth(redirectTo = "login.html") {
    await init();
    if (!isLoggedIn()) {
      window.location.href = redirectTo;
      return false;
    }
    return true;
  }

  /**
   * Guards a page behind the admin role. UI-level convenience only ,
   * every admin data operation is still checked by RLS server-side.
   */
  async function requireAdmin(redirectTo = "index.html") {
    await init();
    if (!isLoggedIn() || !isAdmin()) {
      window.ExpoShare.toast(window.i18n.t("admin.unauthorized"), { type: "error" });
      window.location.href = redirectTo;
      return false;
    }
    return true;
  }

  return {
    signUp,
    signIn,
    signOut,
    sendPasswordReset,
    updatePassword,
    init,
    isLoggedIn,
    isAdmin,
    user,
    profile,
    loadProfile,
    requireAuth,
    requireAdmin
  };
})();
