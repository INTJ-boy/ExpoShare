/**
 * ExpoShare: Profile page logic.
 * Handles both the private "edit my profile" view (profile.html) and
 * the read-only public profile view (public-profile.html?username=).
 * RLS ensures a public visitor can only ever read approved
 * presentations and the public-safe profile columns.
 */
window.ExpoShare.whenReady(async function () {
  const sb = window.getSupabaseClient();

  /* ------------------------------------------------------- Own profile edit */
  const editForm = document.getElementById("es-profile-form");
  if (editForm) {
    await window.ExpoShareAuth.requireAuth("login.html");
    const profile = window.ExpoShareAuth.profile() || {};

    const fields = ["username", "display_name", "bio", "institution", "country", "website", "linkedin", "preferred_language"];
    fields.forEach((f) => {
      const el = document.getElementById(`es-profile-${f}`);
      if (el && profile[f] != null) el.value = profile[f];
    });

    const avatarPreview = document.getElementById("es-profile-avatar-preview");
    if (avatarPreview && profile.avatar_url) {
      const { data } = sb.storage.from(window.EXPOSHARE_CONFIG.BUCKETS.avatars).getPublicUrl(profile.avatar_url);
      avatarPreview.src = data.publicUrl;
    }

    let newAvatarFile = null;
    const avatarInput = document.getElementById("es-profile-avatar-input");
    avatarInput &&
      avatarInput.addEventListener("change", () => {
        const file = avatarInput.files[0];
        if (!file) return;
        newAvatarFile = file;
        const reader = new FileReader();
        reader.onload = (e) => (avatarPreview.src = e.target.result);
        reader.readAsDataURL(file);
      });

    editForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById("es-profile-save");
      window.ExpoShare.setButtonLoading(submitBtn, true);
      try {
        const user = window.ExpoShareAuth.user();
        let avatarPath = profile.avatar_url || null;
        if (newAvatarFile) {
          const path = `${user.id}/${Date.now()}_${newAvatarFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
          const { error: upErr } = await sb.storage
            .from(window.EXPOSHARE_CONFIG.BUCKETS.avatars)
            .upload(path, newAvatarFile, { upsert: true, contentType: newAvatarFile.type });
          if (upErr) throw upErr;
          avatarPath = path;
        }
        const updates = { avatar_url: avatarPath, updated_at: new Date().toISOString() };
        fields.forEach((f) => {
          const el = document.getElementById(`es-profile-${f}`);
          if (el) updates[f] = el.value.trim() || null;
        });
        const { error } = await sb.from("profiles").update(updates).eq("id", user.id);
        if (error) throw error;
        window.ExpoShare.toast(window.i18n.t("profile.update_success"), { type: "success" });
      } catch (err) {
        window.ExpoShare.toast(err.message || window.i18n.t("errors.generic"), { type: "error" });
      } finally {
        window.ExpoShare.setButtonLoading(submitBtn, false);
      }
    });

    renderOwnPresentations(sb, window.ExpoShareAuth.user().id);
  }

  /* ------------------------------------------------------------ Public view */
  const publicRoot = document.getElementById("es-public-profile");
  if (publicRoot) {
    const params = new URLSearchParams(window.location.search);
    const username = params.get("username");
    if (!username) return;
    const { data: prof, error } = await sb
      .from("profiles")
      .select("username, display_name, bio, institution, avatar_url, country, website, linkedin")
      .eq("username", username)
      .single();
    if (error || !prof) {
      publicRoot.innerHTML = `<div class="es-empty"><div class="es-empty__mascot">🦑</div><p>${window.i18n.t("errors.generic")}</p></div>`;
      return;
    }
    document.getElementById("es-pp-display-name").textContent = prof.display_name || prof.username;
    document.getElementById("es-pp-username").textContent = `@${prof.username}`;
    const publicName = prof.display_name || prof.username;
    document.title = `${publicName} | ExpoShare`;
    const ogTitleEl = document.querySelector('meta[property="og:title"]');
    const twTitleEl = document.querySelector('meta[name="twitter:title"]');
    if (ogTitleEl) ogTitleEl.setAttribute("content", `${publicName} | ExpoShare`);
    if (twTitleEl) twTitleEl.setAttribute("content", `${publicName} | ExpoShare`);
    document.getElementById("es-pp-bio").textContent = prof.bio || "";
    document.getElementById("es-pp-institution").textContent = prof.institution || "";
    const avatarEl = document.getElementById("es-pp-avatar");
    if (avatarEl && prof.avatar_url) {
      const { data } = sb.storage.from(window.EXPOSHARE_CONFIG.BUCKETS.avatars).getPublicUrl(prof.avatar_url);
      avatarEl.src = data.publicUrl;
    }

    const { data: rows } = await sb
      .from("presentations")
      .select("id, title, field_id, cover_path, format")
      .eq("status", "approved")
      .eq("is_anonymous", false)
      .eq("owner_id", await ownerIdFromUsername(sb, username))
      .order("created_at", { ascending: false });

    const listEl = document.getElementById("es-pp-presentations");
    if (!rows || !rows.length) {
      listEl.innerHTML = `<div class="es-empty"><div class="es-empty__mascot">🦑</div><p data-i18n="profile.no_presentations"></p></div>`;
      window.i18n.apply(listEl);
    } else {
      listEl.innerHTML = "";
      rows.forEach((r) => {
        const a = document.createElement("a");
        a.href = `presentation.html?id=${r.id}`;
        a.className = "es-card";
        a.innerHTML = `<div class="es-card__body"><div class="es-card__title">${escapeHtml(r.title)}</div></div>`;
        listEl.appendChild(a);
      });
    }
  }

  async function ownerIdFromUsername(sb, username) {
    const { data } = await sb.from("profiles").select("id").eq("username", username).single();
    return data ? data.id : null;
  }

  async function renderOwnPresentations(sb, userId) {
    const listEl = document.getElementById("es-profile-presentations");
    if (!listEl) return;
    const { data, error } = await sb
      .from("presentations")
      .select("id, title, status, format, created_at")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false });
    if (error || !data.length) {
      listEl.innerHTML = `<div class="es-empty"><div class="es-empty__mascot">🦑</div><p data-i18n="empty.profile_presentations"></p></div>`;
      window.i18n.apply(listEl);
      return;
    }
    listEl.innerHTML = "";
    data.forEach((r) => {
      const row = document.createElement("div");
      row.className = "es-card";
      row.style.marginBottom = "10px";
      row.innerHTML = `
        <div class="es-card__body es-flex" style="justify-content:space-between; align-items:center;">
          <span>${escapeHtml(r.title)}</span>
          <span class="es-badge es-badge--status-${r.status}">${window.i18n.t("admin.status_" + r.status)}</span>
        </div>`;
      listEl.appendChild(row);
    });
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s || "";
    return div.innerHTML;
  }
});
