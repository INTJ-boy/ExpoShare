/**
 * ExpoShare: Upload / submission flow.
 * Validates file type/size client-side (RLS + storage policies still
 * enforce this server-side: client checks are UX only), uploads the
 * presentation file to a private bucket and the optional cover to a
 * public bucket, then inserts the presentation row as status=pending.
 */
window.ExpoShare.whenReady(async function () {
  const form = document.getElementById("es-upload-form");
  if (!form) return;

  await window.ExpoShareAuth.requireAuth("login.html");

  const cfg = window.EXPOSHARE_CONFIG;
  const sb = window.getSupabaseClient();
  let taxonomy = await window.ExpoShare.loadTaxonomy();

  const fieldSelect = document.getElementById("es-up-field");
  const disciplineSelect = document.getElementById("es-up-discipline");
  const subdisciplineSelect = document.getElementById("es-up-subdiscipline");
  const fileInput = document.getElementById("es-up-file");
  const fileDrop = document.getElementById("es-up-file-drop");
  const coverInput = document.getElementById("es-up-cover");
  const coverDrop = document.getElementById("es-up-cover-drop");
  const coverPreview = document.getElementById("es-up-cover-preview");
  const tagsInput = document.getElementById("es-up-tags-input");
  const tagsList = document.getElementById("es-up-tags-list");
  const submitBtn = document.getElementById("es-up-submit");
  const progress = document.getElementById("es-up-progress");
  const progressBar = progress ? progress.querySelector(".es-progress__bar") : null;

  let selectedFile = null;
  let selectedCover = null;
  let tags = [];

  function lang() { return window.i18n.currentLang(); }

  function populateFields() {
    fieldSelect.innerHTML = `<option value="">${window.i18n.t("upload.field_field")}</option>`;
    window.ExpoShare.sortByLabel(taxonomy.fields, lang()).forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = window.ExpoShare.taxonomyLabel(f, lang());
      fieldSelect.appendChild(opt);
    });
  }

  function populateDisciplines() {
    const field = taxonomy.fields.find((f) => f.id === fieldSelect.value);
    disciplineSelect.innerHTML = `<option value="">${window.i18n.t("upload.field_discipline")}</option>`;
    subdisciplineSelect.innerHTML = `<option value="">${window.i18n.t("upload.field_subdiscipline")}</option>`;
    disciplineSelect.disabled = !field;
    subdisciplineSelect.disabled = true;
    if (!field) return;
    window.ExpoShare.sortByLabel(field.disciplines, lang()).forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = window.ExpoShare.taxonomyLabel(d, lang());
      disciplineSelect.appendChild(opt);
    });
  }

  function populateSubdisciplines() {
    const field = taxonomy.fields.find((f) => f.id === fieldSelect.value);
    const discipline = field && field.disciplines.find((d) => d.id === disciplineSelect.value);
    subdisciplineSelect.innerHTML = `<option value="">${window.i18n.t("upload.field_subdiscipline")}</option>`;
    const has = discipline && discipline.subdisciplines && discipline.subdisciplines.length;
    subdisciplineSelect.disabled = !has;
    if (!has) return;
    window.ExpoShare.sortByLabel(discipline.subdisciplines, lang()).forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = window.ExpoShare.taxonomyLabel(s, lang());
      subdisciplineSelect.appendChild(opt);
    });
  }

  fieldSelect.addEventListener("change", populateDisciplines);
  disciplineSelect.addEventListener("change", populateSubdisciplines);

  populateFields();
  populateDisciplines();

  /* ------------------------------------------------------------- Dropzones */

  function wireDropzone(dropEl, inputEl, onFile) {
    dropEl.addEventListener("click", () => inputEl.click());
    dropEl.addEventListener("dragover", (e) => { e.preventDefault(); dropEl.classList.add("es-dropzone--drag"); });
    dropEl.addEventListener("dragleave", () => dropEl.classList.remove("es-dropzone--drag"));
    dropEl.addEventListener("drop", (e) => {
      e.preventDefault();
      dropEl.classList.remove("es-dropzone--drag");
      if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
    });
    inputEl.addEventListener("change", () => {
      if (inputEl.files[0]) onFile(inputEl.files[0]);
    });
  }

  wireDropzone(fileDrop, fileInput, (file) => {
    if (!cfg.ALLOWED_FILE_TYPES.includes(file.type)) {
      window.ExpoShare.toast(window.i18n.t("errors.invalid_file"), { type: "error" });
      return;
    }
    if (file.size > cfg.MAX_FILE_SIZE_MB * 1024 * 1024) {
      window.ExpoShare.toast(window.i18n.t("errors.file_too_large"), { type: "error" });
      return;
    }
    selectedFile = file;
    fileDrop.querySelector(".es-dropzone__label").textContent = file.name;
  });

  wireDropzone(coverDrop, coverInput, (file) => {
    if (!cfg.ALLOWED_COVER_TYPES.includes(file.type)) {
      window.ExpoShare.toast(window.i18n.t("errors.invalid_image"), { type: "error" });
      return;
    }
    if (file.size > cfg.MAX_COVER_SIZE_MB * 1024 * 1024) {
      window.ExpoShare.toast(window.i18n.t("errors.file_too_large"), { type: "error" });
      return;
    }
    selectedCover = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      coverPreview.src = e.target.result;
      coverPreview.classList.remove("es-hidden");
    };
    reader.readAsDataURL(file);
  });

  /* ------------------------------------------------------------------ Tags */

  function renderTags() {
    tagsList.innerHTML = "";
    tags.forEach((tag, i) => {
      const chip = document.createElement("span");
      chip.className = "es-badge";
      chip.style.cursor = "pointer";
      chip.textContent = `${tag} ×`;
      chip.addEventListener("click", () => {
        tags.splice(i, 1);
        renderTags();
      });
      tagsList.appendChild(chip);
    });
  }

  tagsInput &&
    tagsInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const val = tagsInput.value.trim().toLowerCase();
        if (val && !tags.includes(val) && tags.length < 10) {
          tags.push(val);
          renderTags();
        }
        tagsInput.value = "";
      }
    });

  /* ---------------------------------------------------------------- Submit */

  function formatFromMime(mime) {
    if (mime === "application/pdf") return "pdf";
    if (mime === "application/vnd.ms-powerpoint") return "ppt";
    return "pptx";
  }

  async function ensureTagRows(tagNames) {
    if (!tagNames.length) return [];
    const { data, error } = await sb.from("tags").upsert(
      tagNames.map((name) => ({ name })),
      { onConflict: "name", ignoreDuplicates: false }
    ).select("id, name");
    if (error) {
      console.warn("Tag upsert failed (non-fatal):", error.message);
      return [];
    }
    return data;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("es-up-title").value.trim();
    const description = document.getElementById("es-up-description").value.trim();
    const language = document.getElementById("es-up-language").value;
    const slideCount = parseInt(document.getElementById("es-up-slides").value, 10) || null;
    const anonymous = document.getElementById("es-up-anonymous").checked;

    if (!title || !fieldSelect.value || !disciplineSelect.value || !selectedFile) {
      window.ExpoShare.toast(window.i18n.t("errors.required_field"), { type: "error" });
      return;
    }

    window.ExpoShare.setButtonLoading(submitBtn, true, window.i18n.t("upload.uploading"));
    if (progress) progress.classList.remove("es-hidden");

    try {
      const user = window.ExpoShareAuth.user();
      const stamp = Date.now();
      const safeName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = `${user.id}/${stamp}_${safeName}`;

      const { error: fileErr } = await sb.storage
        .from(cfg.BUCKETS.presentations)
        .upload(filePath, selectedFile, { upsert: false, contentType: selectedFile.type });
      if (fileErr) throw fileErr;
      if (progressBar) progressBar.style.width = "55%";

      let coverPath = null;
      if (selectedCover) {
        const safeCoverName = selectedCover.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        coverPath = `${user.id}/${stamp}_${safeCoverName}`;
        const { error: coverErr } = await sb.storage
          .from(cfg.BUCKETS.covers)
          .upload(coverPath, selectedCover, { upsert: false, contentType: selectedCover.type });
        if (coverErr) throw coverErr;
      }
      if (progressBar) progressBar.style.width = "80%";

      const { data: inserted, error: insertErr } = await sb
        .from("presentations")
        .insert({
          owner_id: user.id,
          title,
          description,
          field_id: fieldSelect.value,
          discipline_id: disciplineSelect.value,
          subdiscipline_id: subdisciplineSelect.value || null,
          language,
          tags,
          slide_count: slideCount,
          format: formatFromMime(selectedFile.type),
          file_path: filePath,
          cover_path: coverPath,
          is_anonymous: anonymous,
          status: "pending"
        })
        .select("id")
        .single();
      if (insertErr) throw insertErr;

      const tagRows = await ensureTagRows(tags);
      if (tagRows.length) {
        await sb.from("presentation_tags").insert(
          tagRows.map((t) => ({ presentation_id: inserted.id, tag_id: t.id }))
        );
      }

      if (progressBar) progressBar.style.width = "100%";
      window.ExpoShare.toast(window.i18n.t("upload.success"), { type: "success" });
      setTimeout(() => (window.location.href = `presentation.html?id=${inserted.id}`), 700);
    } catch (err) {
      console.error(err);
      window.ExpoShare.toast(err.message || window.i18n.t("errors.upload_failed"), { type: "error" });
    } finally {
      window.ExpoShare.setButtonLoading(submitBtn, false);
    }
  });
});
