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

    let hobbies = Array.isArray(profile.interests) ? profile.interests.slice() : [];
    const hobbiesInput = document.getElementById("es-profile-hobbies-input");
    const hobbiesList = document.getElementById("es-profile-hobbies-list");
    function renderHobbies() {
      if (!hobbiesList) return;
      hobbiesList.innerHTML = "";
      hobbies.forEach((h, i) => {
        const chip = document.createElement("span");
        chip.className = "es-badge";
        chip.style.cursor = "pointer";
        chip.textContent = `${h} ×`;
        chip.addEventListener("click", () => {
          hobbies.splice(i, 1);
          renderHobbies();
        });
        hobbiesList.appendChild(chip);
      });
    }
    renderHobbies();
    hobbiesInput &&
      hobbiesInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const val = hobbiesInput.value.trim();
          if (val && !hobbies.includes(val) && hobbies.length < 15) {
            hobbies.push(val);
            renderHobbies();
          }
          hobbiesInput.value = "";
        }
      });

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
        const updates = { avatar_url: avatarPath, interests: hobbies, updated_at: new Date().toISOString() };
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
    renderOwnMessages(sb, window.ExpoShareAuth.user().id);
    renderOwnBookmarks(sb, window.ExpoShareAuth.user().id);
  }

  /* ------------------------------------------------------------ Public view */
  const publicRoot = document.getElementById("es-public-profile");
  if (publicRoot) {
    const params = new URLSearchParams(window.location.search);
    const username = params.get("username");
    if (!username) return;
    const { data: prof, error } = await sb
      .from("profiles")
      .select("id, username, display_name, bio, institution, avatar_url, country, website, linkedin, interests")
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

    const institutionParts = [prof.institution, prof.country].filter(Boolean).join(" · ");
    document.getElementById("es-pp-institution").textContent = institutionParts;

    const hobbiesEl = document.getElementById("es-pp-hobbies");
    if (hobbiesEl && Array.isArray(prof.interests) && prof.interests.length) {
      hobbiesEl.innerHTML = prof.interests.map((h) => `<span class="es-badge">${escapeHtml(h)}</span>`).join("");
    }

    const avatarEl = document.getElementById("es-pp-avatar");
    if (avatarEl && prof.avatar_url) {
      const { data } = sb.storage.from(window.EXPOSHARE_CONFIG.BUCKETS.avatars).getPublicUrl(prof.avatar_url);
      avatarEl.src = data.publicUrl;
    }

    const linksEl = document.getElementById("es-pp-links");
    if (linksEl) {
      const links = [];
      if (prof.website) links.push({ href: normalizeUrl(prof.website), label: window.i18n.t("profile.website") });
      if (prof.linkedin) links.push({ href: normalizeUrl(prof.linkedin), label: window.i18n.t("profile.linkedin") });
      linksEl.innerHTML = links
        .map((l) => `<a class="es-btn es-btn--ghost es-btn--sm" href="${escapeHtml(l.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label)}</a>`)
        .join("");
    }

    await renderRating(sb, prof.id);

    const { data: rows } = await sb
      .from("presentations")
      .select("id, title, field_id, cover_path, format")
      .eq("status", "approved")
      .eq("is_anonymous", false)
      .eq("owner_id", prof.id)
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

  function normalizeUrl(url) {
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
  }

  /* -------------------------------------------------------------- Ratings */

  function renderStars(container, value, { interactive = false, onRate = null } = {}) {
    container.innerHTML = "";
    container.classList.toggle("es-stars--interactive", interactive);
    for (let i = 1; i <= 5; i++) {
      const star = document.createElement("span");
      star.className = "es-stars__star" + (i <= Math.round(value) ? " is-filled" : "");
      star.textContent = "★";
      star.dataset.value = i;
      if (interactive) {
        star.addEventListener("mouseenter", () => highlightStars(container, i));
        star.addEventListener("mouseleave", () => highlightStars(container, Math.round(value)));
        star.addEventListener("click", () => onRate && onRate(i));
      }
      container.appendChild(star);
    }
  }

  function highlightStars(container, upTo) {
    container.querySelectorAll(".es-stars__star").forEach((el) => {
      el.classList.toggle("is-hover", Number(el.dataset.value) <= upTo);
    });
  }

  async function renderRating(sb, profileId) {
    const starsEl = document.getElementById("es-pp-rating-stars");
    const countEl = document.getElementById("es-pp-rating-count");
    const widgetEl = document.getElementById("es-pp-rate-widget");
    if (!starsEl) return;

    const { data: summary } = await sb
      .from("profile_rating_summary")
      .select("average_rating, rating_count")
      .eq("profile_id", profileId)
      .maybeSingle();

    const avg = summary ? Number(summary.average_rating) : 0;
    const count = summary ? summary.rating_count : 0;

    renderStars(starsEl, avg);
    countEl.textContent = count
      ? window.i18n.t(count === 1 ? "profile.rating_count_one" : "profile.rating_count_other", { count })
      : window.i18n.t("profile.no_ratings_yet");

    if (!widgetEl) return;
    const currentUser = window.ExpoShareAuth.user();
    if (!currentUser) {
      widgetEl.innerHTML = `<p class="es-field__hint">${window.i18n.t("profile.sign_in_to_rate")}</p>`;
      return;
    }
    if (currentUser.id === profileId) {
      return; // can't rate your own profile; leave widget empty
    }

    const { data: existing } = await sb
      .from("profile_ratings")
      .select("rating")
      .eq("rater_id", currentUser.id)
      .eq("ratee_id", profileId)
      .maybeSingle();

    widgetEl.innerHTML = `
      <p class="es-field__hint">${window.i18n.t("profile.rate_contributor")}</p>
      <span class="es-stars" id="es-pp-rate-stars"></span>
    `;
    const rateStars = document.getElementById("es-pp-rate-stars");
    renderStars(rateStars, existing ? existing.rating : 0, {
      interactive: true,
      onRate: async (value) => {
        try {
          const { error } = await sb
            .from("profile_ratings")
            .upsert({ rater_id: currentUser.id, ratee_id: profileId, rating: value, updated_at: new Date().toISOString() }, { onConflict: "rater_id,ratee_id" });
          if (error) throw error;
          window.ExpoShare.toast(window.i18n.t("profile.rating_saved"), { type: "success" });
          await renderRating(sb, profileId);
        } catch (err) {
          window.ExpoShare.toast(err.message || window.i18n.t("errors.generic"), { type: "error" });
        }
      }
    });
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

  async function renderOwnMessages(sb, userId) {
    const listEl = document.getElementById("es-profile-messages");
    if (!listEl) return;
    const { data, error } = await sb
      .from("contact_messages")
      .select("id, category, message, admin_reply, status, created_at, replied_at")
      .eq("sender_id", userId)
      .order("created_at", { ascending: false });
    if (error || !data || !data.length) {
      listEl.innerHTML = `<div class="es-empty"><div class="es-empty__mascot">🦑</div><p data-i18n="contact.no_messages_yet"></p></div>`;
      window.i18n.apply(listEl);
      return;
    }
    listEl.innerHTML = "";
    data.forEach((m) => {
      const card = document.createElement("div");
      card.className = "es-card";
      card.style.marginBottom = "12px";
      const statusKey = m.status === "resolved" ? "contact.status_resolved" : "contact.status_open";
      card.innerHTML = `
        <div class="es-card__body">
          <div class="es-card__eyebrow">${window.i18n.t("contact.form_category_" + m.category)} &middot; ${new Date(m.created_at).toLocaleDateString()}</div>
          <p>${escapeHtml(m.message)}</p>
          <span class="es-badge es-badge--status-${m.status === "resolved" ? "approved" : "pending"}">${window.i18n.t(statusKey)}</span>
          ${
            m.admin_reply
              ? `<div style="margin-top:12px; padding-top:12px; border-top:1px solid var(--candy-08);">
                   <div class="es-card__eyebrow">${window.i18n.t("contact.reply_from_admin")}</div>
                   <p>${escapeHtml(m.admin_reply)}</p>
                 </div>`
              : ""
          }
        </div>`;
      listEl.appendChild(card);
    });
  }

  async function renderOwnBookmarks(sb, userId) {
    const gridEl = document.getElementById("es-profile-bookmarks");
    if (!gridEl) return;
    const { data, error } = await sb
      .from("bookmarks")
      .select("presentation:presentations(id, title, field_id, format, cover_path)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error || !data || !data.length) {
      gridEl.innerHTML = `<div class="es-empty"><div class="es-empty__mascot">🦑</div><p data-i18n="profile.no_bookmarks"></p></div>`;
      window.i18n.apply(gridEl);
      return;
    }
    gridEl.innerHTML = "";
    data.forEach((b) => {
      const p = b.presentation;
      if (!p) return;
      const cover = p.cover_path
        ? sb.storage.from(window.EXPOSHARE_CONFIG.BUCKETS.covers).getPublicUrl(p.cover_path).data.publicUrl
        : window.ExpoShare.generateFallbackCover({ title: p.title, field: p.field_id, format: p.format });
      const a = document.createElement("a");
      a.href = `presentation.html?id=${p.id}`;
      a.className = "es-card";
      a.innerHTML = `<div class="es-card__cover"><img src="${cover}" alt="${escapeHtml(p.title)}" loading="lazy"/></div><div class="es-card__body"><div class="es-card__title">${escapeHtml(p.title)}</div></div>`;
      gridEl.appendChild(a);
    });
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s || "";
    return div.innerHTML;
  }
});
