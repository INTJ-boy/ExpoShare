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

    updateNotificationBell();
  }

  /* -------------------------------------------------------- Notification bell */

  const NOTIF_TYPE_ICON = {
    approved: "check",
    rejected: "x",
    changes_requested: "edit",
    hidden: "eye-off"
  };

  function updateNotificationBell() {
    const anchor = document.getElementById("es-lang-switch");
    if (!anchor || !anchor.parentElement) return; // page has no header actions row

    let bell = document.getElementById("es-notif");
    if (!isLoggedIn()) {
      if (bell) bell.remove();
      return;
    }
    if (!bell) {
      bell = document.createElement("div");
      bell.className = "es-notif";
      bell.id = "es-notif";
      bell.innerHTML = `
        <button class="es-notif__toggle" id="es-notif-toggle" aria-label="Notifications">
          <span aria-hidden="true">&#128276;</span>
          <span class="es-notif__badge es-hidden" id="es-notif-badge">0</span>
        </button>
        <div class="es-notif__panel" id="es-notif-panel">
          <div class="es-notif__head">
            <span data-i18n="notifications.title">Notifications</span>
            <button class="es-notif__mark-all" id="es-notif-mark-all" data-i18n="buttons.mark_all_read">Mark all as read</button>
          </div>
          <div class="es-notif__list" id="es-notif-list"></div>
        </div>`;
      anchor.parentElement.insertBefore(bell, anchor);
      window.i18n && window.i18n.apply(bell);

      const toggle = bell.querySelector("#es-notif-toggle");
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const willOpen = !bell.classList.contains("es-notif--open");
        bell.classList.toggle("es-notif--open");
        if (willOpen) loadNotifications();
      });
      document.addEventListener("click", (e) => {
        if (!bell.contains(e.target)) bell.classList.remove("es-notif--open");
      });
      bell.querySelector("#es-notif-mark-all").addEventListener("click", async (e) => {
        e.stopPropagation();
        await markAllNotificationsRead();
      });
    }
    refreshUnreadCount();
  }

  async function refreshUnreadCount() {
    const sb = client();
    if (!sb || !currentUser) return;
    const { count } = await sb
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", currentUser.id)
      .eq("is_read", false);
    const badge = document.getElementById("es-notif-badge");
    if (!badge) return;
    if (count && count > 0) {
      badge.textContent = count > 9 ? "9+" : String(count);
      badge.classList.remove("es-hidden");
    } else {
      badge.classList.add("es-hidden");
    }
  }

  async function loadNotifications() {
    const listEl = document.getElementById("es-notif-list");
    if (!listEl) return;
    listEl.innerHTML = `<div class="es-skeleton" style="height:60px;margin:8px;"></div>`;
    const sb = client();
    const { data, error } = await sb
      .from("notifications")
      .select("id, type, payload, is_read, created_at")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error || !data || !data.length) {
      listEl.innerHTML = `<div class="es-notif__empty" data-i18n="notifications.empty">No notifications yet.</div>`;
      window.i18n && window.i18n.apply(listEl);
      return;
    }
    listEl.innerHTML = "";
    data.forEach((n) => {
      const textKey =
        n.type === "approved" ? "notifications.submission_approved" :
        n.type === "rejected" ? "notifications.submission_rejected" :
        n.type === "changes_requested" ? "notifications.changes_requested" :
        n.type === "hidden" ? "notifications.presentation_hidden" :
        "notifications.submission_received";
      const title = (n.payload && n.payload.title) || "";
      const text = window.i18n.t(textKey, { title });
      const item = document.createElement("div");
      item.className = "es-notif__item" + (n.is_read ? "" : " es-notif__item--unread");
      item.innerHTML = `<p>${text}</p><time>${new Date(n.created_at).toLocaleDateString()}</time>`;
      item.addEventListener("click", async () => {
        if (!n.is_read) {
          await client().from("notifications").update({ is_read: true }).eq("id", n.id);
          refreshUnreadCount();
        }
        if (n.payload && n.payload.presentation_id) {
          window.location.href = `presentation.html?id=${n.payload.presentation_id}`;
        }
      });
      listEl.appendChild(item);
    });
  }

  async function markAllNotificationsRead() {
    const sb = client();
    if (!sb || !currentUser) return;
    await sb.from("notifications").update({ is_read: true }).eq("user_id", currentUser.id).eq("is_read", false);
    refreshUnreadCount();
    loadNotifications();
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
