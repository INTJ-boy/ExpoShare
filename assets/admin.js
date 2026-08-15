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
  const tabMessages = document.getElementById("es-admin-tab-messages");
  const reportsEl = document.getElementById("es-admin-reports");
  const messagesEl = document.getElementById("es-admin-messages");

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
          // Best-effort email; requires RESEND_API_KEY set as an Edge
          // Function secret (see README). Never blocks the in-app
          // notification above, which is already saved regardless.
          sb.functions
            .invoke("send-email", {
              body: { type: "moderation", user_id: full.owner_id, title: full.title, status, note: noteEl.value.trim() || null }
            })
            .catch(() => {});
          window.ExpoShare.toast(window.i18n.t(`success.${actionLabel}`), { type: "success" });
          renderQueue();
          renderStats();
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

  function activateTab(tab) {
    [tabQueue, tabReports, tabMessages].forEach((t) => t.classList.remove("is-active"));
    [queueEl, reportsEl, messagesEl].forEach((el) => el.classList.add("es-hidden"));
    tab.el.classList.add("is-active");
    tab.panel.classList.remove("es-hidden");
    tab.render();
  }

  tabQueue.addEventListener("click", () => activateTab({ el: tabQueue, panel: queueEl, render: renderQueue }));
  tabReports.addEventListener("click", () => activateTab({ el: tabReports, panel: reportsEl, render: renderReports }));
  tabMessages.addEventListener("click", () => activateTab({ el: tabMessages, panel: messagesEl, render: renderMessages }));

  /* ----------------------------------------------------------------- Messages */

  async function renderMessages() {
    messagesEl.innerHTML = `<div class="es-skeleton" style="height:220px;"></div>`;
    const { data, error } = await sb
      .from("contact_messages")
      .select("id, name, email, category, message, admin_reply, status, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      messagesEl.innerHTML = "";
      window.ExpoShare.toast(error.message, { type: "error" });
      return;
    }
    if (!data.length) {
      messagesEl.innerHTML = `<div class="es-empty"><div class="es-empty__mascot">🦑</div><p data-i18n="admin.no_messages"></p></div>`;
      window.i18n.apply(messagesEl);
      return;
    }
    messagesEl.innerHTML = "";
    data.forEach((m) => {
      const item = document.createElement("div");
      item.className = "es-card";
      item.style.marginBottom = "14px";
      const statusLabel = m.status === "resolved" ? window.i18n.t("admin.message_resolved") : window.i18n.t("admin.message_open");
      item.innerHTML = `
        <div class="es-card__body">
          <div class="es-card__eyebrow">${escapeHtml(m.name)} &middot; ${escapeHtml(m.email)} &middot; ${window.i18n.t("contact.form_category_" + m.category)}</div>
          <p>${escapeHtml(m.message)}</p>
          <span class="es-badge es-badge--status-${m.status === "resolved" ? "approved" : "pending"}">${statusLabel}</span>
          ${
            m.admin_reply
              ? `<div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--candy-08);"><div class="es-card__eyebrow">${window.i18n.t("contact.reply_from_admin")}</div><p>${escapeHtml(m.admin_reply)}</p></div>`
              : `<div class="es-field" style="margin-top:14px;">
                   <textarea class="es-textarea" data-reply-for="${m.id}" placeholder="${window.i18n.t("admin.reply_placeholder")}"></textarea>
                 </div>
                 <div class="es-flex es-gap-8">
                   <button class="es-btn es-btn--primary es-btn--sm" data-send-reply="${m.id}">${window.i18n.t("admin.send_reply")}</button>
                   <button class="es-btn es-btn--ghost es-btn--sm" data-mark-resolved="${m.id}">${window.i18n.t("admin.mark_resolved")}</button>
                 </div>`
          }
        </div>`;
      messagesEl.appendChild(item);

      const sendBtn = item.querySelector(`[data-send-reply="${m.id}"]`);
      if (sendBtn) {
        sendBtn.addEventListener("click", async () => {
          const textarea = item.querySelector(`[data-reply-for="${m.id}"]`);
          const reply = textarea.value.trim();
          if (!reply) return;
          window.ExpoShare.setButtonLoading(sendBtn, true);
          try {
            const { error: updErr } = await sb
              .from("contact_messages")
              .update({
                admin_reply: reply,
                replied_at: new Date().toISOString(),
                replied_by: window.ExpoShareAuth.user().id,
                status: "resolved"
              })
              .eq("id", m.id);
            if (updErr) throw updErr;
            window.ExpoShare.toast(window.i18n.t("admin.reply_sent"), { type: "success" });
            // Best-effort email notification; requires RESEND_API_KEY to be
            // configured as an Edge Function secret (see README). Silently
            // no-ops if email sending isn't set up so this never blocks
            // the in-app reply, which is always saved above regardless.
            sb.functions
              .invoke("send-email", {
                body: { type: "contact_reply", to_email: m.email, name: m.name, original_message: m.message, reply }
              })
              .catch(() => {});
            renderMessages();
            renderStats();
          } catch (err) {
            window.ExpoShare.toast(err.message, { type: "error" });
          } finally {
            window.ExpoShare.setButtonLoading(sendBtn, false);
          }
        });
      }
      const resolveBtn = item.querySelector(`[data-mark-resolved="${m.id}"]`);
      if (resolveBtn) {
        resolveBtn.addEventListener("click", async () => {
          await sb.from("contact_messages").update({ status: "resolved" }).eq("id", m.id);
          renderMessages();
          renderStats();
        });
      }
    });
  }

  /* -------------------------------------------------------------------- Stats */

  async function renderStats() {
    const [pending, reports, messages, approved] = await Promise.all([
      sb.from("presentations").select("*", { count: "exact", head: true }).eq("status", "pending"),
      sb.from("reports").select("*", { count: "exact", head: true }).eq("status", "open"),
      sb.from("contact_messages").select("*", { count: "exact", head: true }).eq("status", "open"),
      sb.from("presentations").select("*", { count: "exact", head: true }).eq("status", "approved")
    ]);
    setStat("es-admin-stat-pending", pending.count);
    setStat("es-admin-stat-reports", reports.count);
    setStat("es-admin-stat-messages", messages.count);
    setStat("es-admin-stat-approved", approved.count);
  }

  function setStat(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value != null ? String(value) : "0";
  }

  renderQueue();
  renderStats();
});
