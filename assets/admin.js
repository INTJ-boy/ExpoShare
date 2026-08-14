/**
 * ExpoShare: Admin panel.
 * Every action here (approve/reject/hide/delete/taxonomy correction)
 * is re-checked by RLS + the is_admin() function in Postgres: this
 * file only exists to make moderation convenient. A non-admin session
 * hitting these same Supabase calls gets rejected at the database.
 */
window.ExpoShare.whenReady(async function () {
  const root = document.getElementById("es-admin-root");
  if (!root) return;

  const ok = await window.ExpoShareAuth.requireAdmin("index.html");
  if (!ok) return;

  const sb = window.getSupabaseClient();
  const taxonomy = await window.ExpoShare.loadTaxonomy();

  const queueEl = document.getElementById("es-admin-queue");
  const statusFilter = document.getElementById("es-admin-status-filter");
  const searchInput = document.getElementById("es-admin-search");
  const tabQueue = document.getElementById("es-admin-tab-queue");
  const tabReports = document.getElementById("es-admin-tab-reports");
  const reportsEl = document.getElementById("es-admin-reports");

  function lang() { return window.i18n.currentLang(); }
  function fieldLabel(id) {
    const f = taxonomy.fields.find((x) => x.id === id);
    return f ? window.ExpoShare.taxonomyLabel(f, lang()) : id;
  }

  async function fetchQueue() {
    let query = sb
      .from("presentations")
      .select("id, title, field_id, discipline_id, status, format, created_at, owner:profiles(username, display_name)")
      .order("created_at", { ascending: false });
    if (statusFilter.value) query = query.eq("status", statusFilter.value);
    if (searchInput.value.trim()) query = query.ilike("title", `%${searchInput.value.trim()}%`);
    const { data, error } = await query.limit(100);
    if (error) {
      window.ExpoShare.toast(error.message, { type: "error" });
      return [];
    }
    return data;
  }

  function statusBadge(status) {
    return `<span class="es-badge es-badge--status-${status}">${window.i18n.t("admin.status_" + status)}</span>`;
  }

  async function renderQueue() {
    queueEl.innerHTML = `<div class="es-skeleton" style="height:220px;"></div>`;
    const rows = await fetchQueue();
    if (!rows.length) {
      queueEl.innerHTML = `<div class="es-empty"><div class="es-empty__mascot">🦑</div><p data-i18n="empty.admin_queue"></p></div>`;
      window.i18n.apply(queueEl);
      return;
    }
    queueEl.innerHTML = "";
    rows.forEach((row) => {
      const item = document.createElement("div");
      item.className = "es-card";
      item.style.marginBottom = "14px";
      item.innerHTML = `
        <div class="es-card__body es-flex es-gap-12" style="align-items:center; justify-content:space-between; flex-wrap:wrap;">
          <div>
            <div class="es-card__eyebrow">${escapeHtml(fieldLabel(row.field_id))} · ${(row.format || "").toUpperCase()}</div>
            <div class="es-card__title">${escapeHtml(row.title)}</div>
            <div class="es-card__meta">${statusBadge(row.status)} <span>${(row.owner && (row.owner.display_name || row.owner.username)) || ""}</span></div>
          </div>
          <div class="es-flex es-gap-8">
            <button class="es-btn es-btn--ghost es-btn--sm" data-action="open">${window.i18n.t("buttons.view_details")}</button>
          </div>
        </div>`;
      item.querySelector('[data-action="open"]').addEventListener("click", () => openReviewModal(row));
      queueEl.appendChild(item);
    });
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s || "";
    return div.innerHTML;
  }

  function fieldOptionsHtml(selectedId) {
    return window.ExpoShare.sortByLabel(taxonomy.fields, lang())
      .map((f) => `<option value="${f.id}" ${f.id === selectedId ? "selected" : ""}>${escapeHtml(window.ExpoShare.taxonomyLabel(f, lang()))}</option>`)
      .join("");
  }
  function disciplineOptionsHtml(fieldId, selectedId) {
    const field = taxonomy.fields.find((f) => f.id === fieldId);
    if (!field) return "";
    return window.ExpoShare.sortByLabel(field.disciplines, lang())
      .map((d) => `<option value="${d.id}" ${d.id === selectedId ? "selected" : ""}>${escapeHtml(window.ExpoShare.taxonomyLabel(d, lang()))}</option>`)
      .join("");
  }

  async function openReviewModal(row) {
    const { data: full } = await sb.from("presentations").select("*").eq("id", row.id).single();
    const bodyHtml = `
      <div class="es-field">
        <label>${window.i18n.t("upload.field_field")}</label>
        <select class="es-select" id="admin-field-select">${fieldOptionsHtml(full.field_id)}</select>
      </div>
      <div class="es-field">
        <label>${window.i18n.t("upload.field_discipline")}</label>
        <select class="es-select" id="admin-discipline-select">${disciplineOptionsHtml(full.field_id, full.discipline_id)}</select>
      </div>
      <div class="es-field">
        <label>${window.i18n.t("admin.reviewer_note")}</label>
        <textarea class="es-textarea" id="admin-reviewer-note" placeholder="${window.i18n.t("admin.reviewer_note_placeholder")}">${escapeHtml(full.reviewer_note || "")}</textarea>
      </div>
      <div class="es-flex es-gap-8 es-flex-wrap">
        <button class="es-btn es-btn--primary es-btn--sm" id="admin-approve">${window.i18n.t("buttons.approve")}</button>
        <button class="es-btn es-btn--ghost es-btn--sm" id="admin-request-changes">${window.i18n.t("buttons.request_changes")}</button>
        <button class="es-btn es-btn--danger es-btn--sm" id="admin-reject">${window.i18n.t("buttons.reject")}</button>
        <button class="es-btn es-btn--danger es-btn--sm" id="admin-delete">${window.i18n.t("buttons.delete")}</button>
      </div>
    `;
    const overlayPromise = window.ExpoShare.openModal({ title: full.title, bodyHtml, actions: [{ label: window.i18n.t("buttons.close"), value: null, variant: "ghost" }] });

    // Wire buttons right after modal is in the DOM.
    setTimeout(() => {
      const fieldSel = document.getElementById("admin-field-select");
      const discSel = document.getElementById("admin-discipline-select");
      fieldSel &&
        fieldSel.addEventListener("change", () => {
          discSel.innerHTML = disciplineOptionsHtml(fieldSel.value, null);
        });

      const noteEl = document.getElementById("admin-reviewer-note");

      const act = async (status, actionLabel) => {
        try {
          const updates = {
            status,
            field_id: fieldSel.value,
            discipline_id: discSel.value,
            reviewer_note: noteEl.value.trim() || null,
            updated_at: new Date().toISOString()
          };
          const { error } = await sb.from("presentations").update(updates).eq("id", full.id);
          if (error) throw error;
          await sb.from("review_actions").insert({
            presentation_id: full.id,
            admin_id: window.ExpoShareAuth.user().id,
            action: status,
            note: noteEl.value.trim() || null
          });
          await sb.from("notifications").insert({
            user_id: full.owner_id,
            type: status,
            payload: { title: full.title, presentation_id: full.id }
          });
          window.ExpoShare.toast(window.i18n.t(`success.${actionLabel}`), { type: "success" });
          renderQueue();
        } catch (err) {
          window.ExpoShare.toast(err.message, { type: "error" });
        }
      };

      const approveBtn = document.getElementById("admin-approve");
      approveBtn && approveBtn.addEventListener("click", () => act("approved", "approved"));
      const rcBtn = document.getElementById("admin-request-changes");
      rcBtn && rcBtn.addEventListener("click", () => act("changes_requested", "changes_requested"));
      const rejectBtn = document.getElementById("admin-reject");
      rejectBtn &&
        rejectBtn.addEventListener("click", async () => {
          const sure = await window.ExpoShare.confirmDialog({
            title: window.i18n.t("admin.confirm_reject"),
            body: "",
            confirmLabel: window.i18n.t("buttons.reject"),
            cancelLabel: window.i18n.t("buttons.cancel"),
            danger: true
          });
          if (sure) act("rejected", "rejected");
        });
      const deleteBtn = document.getElementById("admin-delete");
      deleteBtn &&
        deleteBtn.addEventListener("click", async () => {
          const sure = await window.ExpoShare.confirmDialog({
            title: window.i18n.t("confirm.delete_title"),
            body: window.i18n.t("admin.confirm_delete"),
            confirmLabel: window.i18n.t("buttons.delete"),
            cancelLabel: window.i18n.t("buttons.cancel"),
            danger: true
          });
          if (!sure) return;
          try {
            const { error } = await sb.from("presentations").delete().eq("id", full.id);
            if (error) throw error;
            window.ExpoShare.toast(window.i18n.t("success.deleted"), { type: "success" });
            renderQueue();
          } catch (err) {
            window.ExpoShare.toast(err.message, { type: "error" });
          }
        });
    }, 0);

    await overlayPromise;
  }

  async function renderReports() {
    reportsEl.innerHTML = `<div class="es-skeleton" style="height:160px;"></div>`;
    const { data, error } = await sb
      .from("reports")
      .select("id, category, explanation, status, created_at, presentation:presentations(id, title)")
      .eq("status", "open")
      .order("created_at", { ascending: false });
    if (error) {
      reportsEl.innerHTML = "";
      window.ExpoShare.toast(error.message, { type: "error" });
      return;
    }
    if (!data.length) {
      reportsEl.innerHTML = `<div class="es-empty"><div class="es-empty__mascot">🦑</div><p data-i18n="admin.no_reports"></p></div>`;
      window.i18n.apply(reportsEl);
      return;
    }
    reportsEl.innerHTML = "";
    data.forEach((r) => {
      const item = document.createElement("div");
      item.className = "es-card";
      item.style.marginBottom = "14px";
      item.innerHTML = `
        <div class="es-card__body">
          <div class="es-card__eyebrow">${window.i18n.t("reports.category_" + r.category)}</div>
          <div class="es-card__title">${escapeHtml((r.presentation && r.presentation.title) || "")}</div>
          <p class="es-muted">${escapeHtml(r.explanation || "")}</p>
          <div class="es-flex es-gap-8">
            <button class="es-btn es-btn--ghost es-btn--sm" data-a="dismiss">${window.i18n.t("buttons.dismiss")}</button>
            <button class="es-btn es-btn--danger es-btn--sm" data-a="hide">${window.i18n.t("buttons.hide")}</button>
          </div>
        </div>`;
      item.querySelector('[data-a="dismiss"]').addEventListener("click", async () => {
        await sb.from("reports").update({ status: "dismissed" }).eq("id", r.id);
        renderReports();
      });
      item.querySelector('[data-a="hide"]').addEventListener("click", async () => {
        if (r.presentation) await sb.from("presentations").update({ status: "hidden" }).eq("id", r.presentation.id);
        await sb.from("reports").update({ status: "resolved" }).eq("id", r.id);
        renderReports();
      });
      reportsEl.appendChild(item);
    });
  }

  statusFilter.addEventListener("change", renderQueue);
  let searchTimer;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderQueue, 250);
  });
  tabQueue.addEventListener("click", () => {
    tabQueue.classList.add("is-active");
    tabReports.classList.remove("is-active");
    queueEl.classList.remove("es-hidden");
    reportsEl.classList.add("es-hidden");
  });
  tabReports.addEventListener("click", () => {
    tabReports.classList.add("is-active");
    tabQueue.classList.remove("is-active");
    reportsEl.classList.remove("es-hidden");
    queueEl.classList.add("es-hidden");
    renderReports();
  });

  renderQueue();
});
