/**
 * ExpoShare: Browse / Library page logic.
 * Reads only PUBLIC, APPROVED presentations (enforced by RLS regardless
 * of what filters are sent from the client). Combines full-text-ish
 * search across title/description/tags with taxonomy + format + language
 * filters.
 */
window.ExpoShare.whenReady(async function () {
  const grid = document.getElementById("es-browse-grid");
  if (!grid) return; // not on this page

  const emptyState = document.getElementById("es-browse-empty");
  const countEl = document.getElementById("es-browse-count");
  const fieldSelect = document.getElementById("es-filter-field");
  const disciplineSelect = document.getElementById("es-filter-discipline");
  const subdisciplineSelect = document.getElementById("es-filter-subdiscipline");
  const languageSelect = document.getElementById("es-filter-language");
  const formatSelect = document.getElementById("es-filter-format");
  const sortSelect = document.getElementById("es-filter-sort");
  const clearBtn = document.getElementById("es-filter-clear");

  const state = { q: "", field: "", discipline: "", subdiscipline: "", language: "", format: "", sort: "newest" };
  let taxonomy = null;

  function lang() {
    return (window.i18n && window.i18n.currentLang()) || "en";
  }

  function populateFieldOptions() {
    fieldSelect.innerHTML = `<option value="">${window.i18n.t("filters.all_fields")}</option>`;
    window.ExpoShare.sortByLabel(taxonomy.fields, lang()).forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = window.ExpoShare.taxonomyLabel(f, lang());
      fieldSelect.appendChild(opt);
    });
  }

  function populateDisciplineOptions() {
    disciplineSelect.innerHTML = `<option value="">${window.i18n.t("filters.all_disciplines")}</option>`;
    subdisciplineSelect.innerHTML = `<option value="">${window.i18n.t("filters.all_disciplines")}</option>`;
    subdisciplineSelect.disabled = true;
    const field = taxonomy.fields.find((f) => f.id === state.field);
    if (!field) {
      disciplineSelect.disabled = true;
      return;
    }
    disciplineSelect.disabled = false;
    window.ExpoShare.sortByLabel(field.disciplines, lang()).forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = window.ExpoShare.taxonomyLabel(d, lang());
      disciplineSelect.appendChild(opt);
    });
  }

  function populateSubdisciplineOptions() {
    const field = taxonomy.fields.find((f) => f.id === state.field);
    const discipline = field && field.disciplines.find((d) => d.id === state.discipline);
    subdisciplineSelect.innerHTML = `<option value="">${window.i18n.t("filters.all_disciplines")}</option>`;
    if (!discipline || !discipline.subdisciplines || !discipline.subdisciplines.length) {
      subdisciplineSelect.disabled = true;
      return;
    }
    subdisciplineSelect.disabled = false;
    window.ExpoShare.sortByLabel(discipline.subdisciplines, lang()).forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = window.ExpoShare.taxonomyLabel(s, lang());
      subdisciplineSelect.appendChild(opt);
    });
  }

  function skeletonCards(n = 6) {
    grid.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const card = document.createElement("div");
      card.className = "es-card";
      card.innerHTML = `
        <div class="es-skeleton" style="aspect-ratio:16/10;"></div>
        <div class="es-card__body">
          <div class="es-skeleton" style="height:12px;width:40%;margin-bottom:10px;"></div>
          <div class="es-skeleton" style="height:16px;width:80%;margin-bottom:8px;"></div>
          <div class="es-skeleton" style="height:12px;width:60%;"></div>
        </div>`;
      grid.appendChild(card);
    }
  }

  function coverUrl(row) {
    if (row.cover_path) {
      const sb = window.getSupabaseClient();
      const { data } = sb.storage.from(window.EXPOSHARE_CONFIG.BUCKETS.covers).getPublicUrl(row.cover_path);
      return data.publicUrl;
    }
    return window.ExpoShare.generateFallbackCover({
      title: row.title,
      field: fieldLabel(row.field_id),
      format: row.format
    });
  }

  function fieldLabel(id) {
    const f = taxonomy.fields.find((x) => x.id === id);
    return f ? window.ExpoShare.taxonomyLabel(f, lang()) : id;
  }
  function disciplineLabel(fieldId, id) {
    const f = taxonomy.fields.find((x) => x.id === fieldId);
    const d = f && f.disciplines.find((x) => x.id === id);
    return d ? window.ExpoShare.taxonomyLabel(d, lang()) : id;
  }

  function renderCards(rows) {
    grid.innerHTML = "";
    if (!rows.length) {
      emptyState.classList.remove("es-hidden");
      return;
    }
    emptyState.classList.add("es-hidden");
    rows.forEach((row) => {
      const authorHtml = row.is_anonymous
        ? escapeHtml(window.i18n.t("presentation.anonymous"))
        : row.owner && row.owner.username
        ? `<a href="public-profile.html?username=${encodeURIComponent(row.owner.username)}" class="es-author-link" data-nav-stop>${escapeHtml(window.i18n.t("presentation.by", { author: row.owner.display_name || row.owner.username }))}</a>`
        : escapeHtml(window.i18n.t("presentation.by", { author: "" }));

      // A <div> (not <a>) because the author name inside needs to be
      // its own real link -- an <a> can't contain another <a>. Clicking
      // anywhere else on the card still navigates to the presentation.
      const card = document.createElement("div");
      card.className = "es-card";
      card.style.cursor = "pointer";
      card.innerHTML = `
        <div class="es-card__cover">
          <img src="${coverUrl(row)}" alt="${escapeHtml(row.title)}" loading="lazy" />
        </div>
        <div class="es-card__body">
          <div class="es-card__eyebrow">${escapeHtml(fieldLabel(row.field_id))} · ${escapeHtml(disciplineLabel(row.field_id, row.discipline_id))}</div>
          <h3 class="es-card__title">${escapeHtml(row.title)}</h3>
          <div class="es-card__meta">
            <span>${authorHtml}</span>
            <span>·</span>
            <span>${(row.format || "").toUpperCase()}</span>
            <span>·</span>
            <span>${row.language ? row.language.toUpperCase() : ""}</span>
          </div>
        </div>`;
      card.addEventListener("click", (e) => {
        if (e.target.closest("[data-nav-stop]")) return;
        window.location.href = `presentation.html?id=${row.id}`;
      });
      grid.appendChild(card);
    });
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s || "";
    return div.innerHTML;
  }

  async function runQuery() {
    skeletonCards();
    const sb = window.getSupabaseClient();
    if (!sb) {
      grid.innerHTML = "";
      emptyState.classList.remove("es-hidden");
      return;
    }

    let query = sb
      .from("presentations")
      .select("id, title, description, field_id, discipline_id, subdiscipline_id, language, tags, format, slide_count, cover_path, is_anonymous, created_at, owner:profiles(username, display_name)")
      .eq("status", "approved");

    if (state.field) query = query.eq("field_id", state.field);
    if (state.discipline) query = query.eq("discipline_id", state.discipline);
    if (state.subdiscipline) query = query.eq("subdiscipline_id", state.subdiscipline);
    if (state.language) query = query.eq("language", state.language);
    if (state.format) query = query.eq("format", state.format);
    if (state.q) {
      const like = `%${state.q}%`;
      query = query.or(
        `title.ilike.${like},description.ilike.${like},field_id.ilike.${like},discipline_id.ilike.${like},subdiscipline_id.ilike.${like}`
      );
    }
    query = query.order("created_at", { ascending: state.sort === "oldest" });
    if (state.sort === "title") query = query.order("title", { ascending: true });

    const { data, error } = await query.limit(60);
    if (error) {
      window.ExpoShare.toast(error.message || window.i18n.t("errors.database_error"), { type: "error" });
      grid.innerHTML = "";
      emptyState.classList.remove("es-hidden");
      return;
    }
    countEl.textContent = window.i18n.t("search.results_count", { count: data.length });
    renderCards(data);
  }

  fieldSelect &&
    fieldSelect.addEventListener("change", () => {
      state.field = fieldSelect.value;
      state.discipline = "";
      state.subdiscipline = "";
      populateDisciplineOptions();
      runQuery();
    });
  disciplineSelect &&
    disciplineSelect.addEventListener("change", () => {
      state.discipline = disciplineSelect.value;
      state.subdiscipline = "";
      populateSubdisciplineOptions();
      runQuery();
    });
  subdisciplineSelect &&
    subdisciplineSelect.addEventListener("change", () => {
      state.subdiscipline = subdisciplineSelect.value;
      runQuery();
    });
  languageSelect && languageSelect.addEventListener("change", () => { state.language = languageSelect.value; runQuery(); });
  formatSelect && formatSelect.addEventListener("change", () => { state.format = formatSelect.value; runQuery(); });
  sortSelect && sortSelect.addEventListener("change", () => { state.sort = sortSelect.value; runQuery(); });
  clearBtn &&
    clearBtn.addEventListener("click", () => {
      state.field = state.discipline = state.subdiscipline = state.language = state.format = state.q = "";
      state.sort = "newest";
      [fieldSelect, languageSelect, formatSelect].forEach((el) => el && (el.value = ""));
      populateDisciplineOptions();
      const input = document.getElementById("es-search-input");
      if (input) input.value = "";
      runQuery();
    });

  window.ExpoShare.initExpandingSearch({
    onSearch: (val) => {
      state.q = val;
      runQuery();
    }
  });

  // Same defensive pattern as presentation.html: without this, a failed
  // taxonomy.json fetch (dropped mobile connection, etc.) would throw
  // an uncaught exception here, silently leaving the filters and grid
  // stuck on their loading skeletons with no visible error.
  try {
    taxonomy = await window.ExpoShare.loadTaxonomy();
    populateFieldOptions();
    populateDisciplineOptions();
    window.i18n.onChange(() => {
      populateFieldOptions();
      populateDisciplineOptions();
      runQuery();
    });
  } catch (err) {
    console.error(err);
    window.ExpoShare.toast(window.i18n.t("errors.generic"), { type: "error" });
  }
  runQuery();
});
