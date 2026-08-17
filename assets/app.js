/**
 * ExpoShare shared app shell.
 * Loading screen, toast notifications, custom modals/confirms, the
 * expanding command-style search, mobile nav, taxonomy + socials
 * loaders, and small render helpers reused across pages.
 */
window.ExpoShare = (function () {
  const LOADING_STEPS = ["init", "session", "library", "catalogue", "ready"];

  /* ---------------------------------------------------------- Loading screen */

  function buildLoadingScreen() {
    if (document.getElementById("es-loading")) return;
    const el = document.createElement("div");
    el.id = "es-loading";
    el.className = "es-loading";
    el.innerHTML = `
      <div class="es-loading__ring" aria-hidden="true"></div>
      <div class="es-loading__mascot" aria-hidden="true">🦑</div>
      <div class="es-loading__brand">ExpoShare</div>
      <div class="es-loading__status" data-i18n="loading.init">INITIALIZING EXPOSHARE...</div>
    `;
    document.body.appendChild(el);
  }

  async function runLoadingSequence(minMs = 650) {
    buildLoadingScreen();
    const el = document.getElementById("es-loading");
    const status = el.querySelector(".es-loading__status");
    const start = Date.now();
    for (const step of LOADING_STEPS) {
      const key = `loading.${step}`;
      status.setAttribute("data-i18n", key);
      status.textContent = (window.i18n && window.i18n.t(key)) || key;
      await sleep(90);
    }
    const elapsed = Date.now() - start;
    if (elapsed < minMs) await sleep(minMs - elapsed);
    el.classList.add("es-loading--done");
    setTimeout(() => el.remove(), 420);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /* ---------------------------------------------------------------- Toasts */

  function ensureToastHost() {
    let host = document.getElementById("es-toasts");
    if (!host) {
      host = document.createElement("div");
      host.id = "es-toasts";
      host.className = "es-toasts";
      host.setAttribute("role", "status");
      host.setAttribute("aria-live", "polite");
      document.body.appendChild(host);
    }
    return host;
  }

  function toast(message, { type = "info", duration = 4200 } = {}) {
    const host = ensureToastHost();
    const el = document.createElement("div");
    el.className = `es-toast es-toast--${type}`;
    el.innerHTML = `<span class="es-toast__dot" aria-hidden="true"></span><span class="es-toast__msg"></span>`;
    el.querySelector(".es-toast__msg").textContent = message;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("es-toast--in"));
    const remove = () => {
      el.classList.remove("es-toast--in");
      el.classList.add("es-toast--out");
      setTimeout(() => el.remove(), 240);
    };
    const timer = setTimeout(remove, duration);
    el.addEventListener("click", () => {
      clearTimeout(timer);
      remove();
    });
    return el;
  }

  /* -------------------------------------------------------- Modal / confirm */

  function openModal({ title, bodyHtml, actions = [] }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "es-modal-overlay";
      overlay.innerHTML = `
        <div class="es-modal" role="dialog" aria-modal="true" aria-label="${title || ""}">
          <button class="es-modal__close" data-i18n-aria-label="a11y.close_dialog" aria-label="Close">&times;</button>
          ${title ? `<h3 class="es-modal__title">${title}</h3>` : ""}
          <div class="es-modal__body">${bodyHtml || ""}</div>
          <div class="es-modal__actions"></div>
        </div>`;
      document.body.appendChild(overlay);
      const actionsEl = overlay.querySelector(".es-modal__actions");

      function close(result) {
        overlay.classList.add("es-modal-overlay--out");
        setTimeout(() => overlay.remove(), 200);
        resolve(result);
      }

      actions.forEach((a) => {
        const btn = document.createElement("button");
        btn.className = `es-btn ${a.variant === "danger" ? "es-btn--danger" : a.variant === "ghost" ? "es-btn--ghost" : "es-btn--primary"}`;
        btn.textContent = a.label;
        btn.addEventListener("click", () => close(a.value));
        actionsEl.appendChild(btn);
      });

      overlay.querySelector(".es-modal__close").addEventListener("click", () => close(null));
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close(null);
      });
      document.addEventListener(
        "keydown",
        function onEsc(e) {
          if (e.key === "Escape") {
            document.removeEventListener("keydown", onEsc);
            close(null);
          }
        },
        { once: true }
      );

      requestAnimationFrame(() => overlay.classList.add("es-modal-overlay--in"));
      window.i18n && window.i18n.apply(overlay);
    });
  }

  function confirmDialog({ title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false }) {
    return openModal({
      title,
      bodyHtml: `<p>${body}</p>`,
      actions: [
        { label: cancelLabel, value: false, variant: "ghost" },
        { label: confirmLabel, value: true, variant: danger ? "danger" : "primary" }
      ]
    });
  }

  /* --------------------------------------------------------- Button loading */

  function setButtonLoading(btn, isLoading, loadingText) {
    if (!btn) return;
    if (isLoading) {
      btn.dataset.originalText = btn.dataset.originalText || btn.innerHTML;
      btn.disabled = true;
      btn.classList.add("es-btn--loading");
      btn.innerHTML = `<span class="es-spinner" aria-hidden="true"></span><span>${loadingText || btn.dataset.originalText}</span>`;
    } else {
      btn.disabled = false;
      btn.classList.remove("es-btn--loading");
      if (btn.dataset.originalText) btn.innerHTML = btn.dataset.originalText;
    }
  }

  /* -------------------------------------------------------- Expanding search */

  function initExpandingSearch({ inputId = "es-search-input", toggleId = "es-search-toggle", onSearch, suggest = false } = {}) {
    const input = document.getElementById(inputId);
    const toggle = document.getElementById(toggleId);
    const wrap = input ? input.closest(".es-search") : null;
    if (!wrap) return;

    let suggestPanel = null;
    if (suggest) {
      suggestPanel = document.createElement("div");
      suggestPanel.className = "es-search__suggest";
      wrap.appendChild(suggestPanel);
    }

    function expand() {
      wrap.classList.add("es-search--expanded");
      setTimeout(() => input.focus(), 180);
    }
    function collapse() {
      if (document.activeElement === input && input.value) return;
      wrap.classList.remove("es-search--expanded");
      if (suggestPanel) suggestPanel.classList.remove("es-search__suggest--open");
    }

    toggle && toggle.addEventListener("click", () => {
      wrap.classList.contains("es-search--expanded") ? collapse() : expand();
    });
    input && input.addEventListener("blur", () => setTimeout(collapse, 120));

    document.addEventListener("keydown", (e) => {
      const isK = e.key === "k" || e.key === "K";
      if ((e.metaKey || e.ctrlKey) && isK) {
        e.preventDefault();
        expand();
      }
      if (e.key === "Escape" && document.activeElement === input) {
        input.blur();
      }
    });

    async function runSuggestions(q) {
      if (!suggestPanel) return;
      if (!q) {
        suggestPanel.classList.remove("es-search__suggest--open");
        return;
      }
      const sb = window.getSupabaseClient && window.getSupabaseClient();
      if (!sb) return;
      const { data } = await sb
        .from("presentations")
        .select("id, title, format")
        .eq("status", "approved")
        .ilike("title", `%${q}%`)
        .limit(5);
      if (!data || !data.length) {
        suggestPanel.classList.remove("es-search__suggest--open");
        return;
      }
      suggestPanel.innerHTML = data
        .map(
          (r) =>
            `<a href="presentation.html?id=${r.id}" class="es-search__suggest-item">
               <span>${escapeSuggestHtml(r.title)}</span>
               <span class="es-search__suggest-format">${(r.format || "").toUpperCase()}</span>
             </a>`
        )
        .join("");
      suggestPanel.classList.add("es-search__suggest--open");
    }

    function escapeSuggestHtml(s) {
      const div = document.createElement("div");
      div.textContent = s || "";
      return div.innerHTML;
    }

    if (onSearch || suggest) {
      let debounceTimer;
      input.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const val = input.value.trim();
          if (onSearch) onSearch(val);
          if (suggest) runSuggestions(val);
        }, 220);
      });
    }
  }

  /* --------------------------------------------------------------- Mobile nav */

  function initMobileNav({ toggleId = "es-nav-toggle", menuId = "es-nav-menu" } = {}) {
    const toggle = document.getElementById(toggleId);
    const menu = document.getElementById(menuId);
    if (!toggle || !menu) return;
    toggle.addEventListener("click", () => {
      const open = menu.classList.toggle("es-nav-menu--open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    relocateAuthActions(menu);
  }

  /**
   * Moves the login/signup/logout header actions into the collapsible
   * nav menu itself. On desktop the nav menu is an inline flex row, so
   * they still render as normal header buttons at the end of the row;
   * on narrow screens the same menu becomes the fullscreen overlay, so
   * these buttons never overflow the fixed-height header bar. Keeps
   * search + language + hamburger as the only always-visible actions.
   */
  function relocateAuthActions(menu) {
    if (!menu) return;
    ["es-nav-login", "es-nav-signup", "es-nav-logout"].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.parentElement !== menu) menu.appendChild(el);
    });
  }

  /* --------------------------------------------------------- Alphabetical sort */

  /**
   * Sorts a taxonomy list (fields/disciplines/subdisciplines) by their
   * label in the given language, using locale-aware comparison so
   * Arabic and French diacritics/ordering behave correctly.
   */
  function sortByLabel(list, lang) {
    return list.slice().sort((a, b) => taxonomyLabel(a, lang).localeCompare(taxonomyLabel(b, lang), lang));
  }

  /* ------------------------------------------------------------- Data loaders */

  let taxonomyCache = null;
  async function loadTaxonomy() {
    if (taxonomyCache) return taxonomyCache;
    const res = await fetch("data/taxonomy.json", { cache: "force-cache" });
    taxonomyCache = await res.json();
    return taxonomyCache;
  }

  let socialsCache = null;
  async function loadSocials() {
    if (socialsCache) return socialsCache;
    const res = await fetch("data/socials.json", { cache: "force-cache" });
    socialsCache = await res.json();
    return socialsCache;
  }

  function taxonomyLabel(node, lang) {
    return node[lang] || node.en || node.id;
  }

  /* -------------------------------------------------------------- Cover fallback */

  /**
   * Renders a generated fallback cover (canvas → data URL) using the
   * title/field/discipline/format when the uploader didn't supply one.
   */
  function generateFallbackCover({ title, field, format }) {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 400;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#020202";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, "#0b0b0b");
    grad.addColorStop(1, "#020202");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "rgba(178,213,229,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);

    ctx.fillStyle = "#B2D5E5";
    ctx.font = "600 30px 'Space Grotesk', 'Segoe UI', sans-serif";
    wrapText(ctx, title || "Untitled presentation", 40, 90, canvas.width - 80, 36);

    ctx.fillStyle = "rgba(178,213,229,0.65)";
    ctx.font = "500 16px 'Space Grotesk', 'Segoe UI', sans-serif";
    ctx.fillText((field || "").toUpperCase(), 40, canvas.height - 70);

    ctx.fillStyle = "rgba(178,213,229,0.4)";
    ctx.font = "500 13px 'Space Grotesk', 'Segoe UI', sans-serif";
    ctx.fillText((format || "").toUpperCase(), 40, canvas.height - 46);

    ctx.font = "28px sans-serif";
    ctx.fillText("🦑", canvas.width - 70, canvas.height - 40);

    return canvas.toDataURL("image/png");
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(" ");
    let line = "";
    let lineY = y;
    let lines = 0;
    for (const word of words) {
      const test = line + word + " ";
      if (ctx.measureText(test).width > maxWidth && line !== "" && lines < 3) {
        ctx.fillText(line, x, lineY);
        line = word + " ";
        lineY += lineHeight;
        lines++;
      } else {
        line = test;
      }
    }
    ctx.fillText(line, x, lineY);
  }

  /* --------------------------------------------------------------- Public API */

  /* ---------------------------------------------------------- Readiness gate */

  /**
   * Page-specific modules (browse.js, upload.js, admin.js, profile.js)
   * touch i18n and auth state on load. Each page's bootstrap script
   * marks the app ready (after i18n.init() + ExpoShareAuth.init()
   * resolve) by calling ExpoShare.markReady(). whenReady() lets those
   * modules defer their work until that has happened, regardless of
   * <script> tag order.
   */
  let isReady = false;
  const readyQueue = [];

  function markReady() {
    isReady = true;
    insertDonationTrigger();
    insertOtherWebsitesSection();
    readyQueue.splice(0).forEach((fn) => {
      try { fn(); } catch (e) { console.error(e); }
    });
  }

  /* ------------------------------------------------------------- Donation */

  /**
   * Injects a small "Support ExpoShare" link into the footer (if the
   * page has one) that opens a modal with a Quran verse and the
   * donor's CCP/BaridiMob details. Click-to-copy on each field. Works
   * for logged-in and logged-out visitors alike -- this is intentionally
   * not gated behind auth.
   */
  function insertDonationTrigger() {
    const footerBottom = document.querySelector(".es-footer__bottom");
    if (!footerBottom || document.getElementById("es-donation-trigger")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "es-donation-trigger";
    btn.className = "es-donation-trigger";
    btn.setAttribute("data-i18n", "donation.cta");
    btn.textContent = (window.i18n && window.i18n.t("donation.cta")) || "Support ExpoShare";
    footerBottom.insertBefore(btn, footerBottom.firstChild);

    btn.addEventListener("click", () => openDonationModal());
  }

  /* -------------------------------------------------------- Other websites */

  /**
   * Injects a "Visit our other websites" block into the footer, above
   * the bottom credit bar. Placeholder entries until the real links are
   * ready -- shown as disabled "Coming soon" chips.
   */
  /* -------------------------------------------------------- Other websites */

  /**
   * EDIT THIS LIST when you have real links ready. Leave `url` empty
   * to keep showing "Coming soon" for that slot; fill it in (must
   * start with http:// or https://) and it automatically becomes a
   * real clickable link, no other code changes needed.
   */
  const OTHER_WEBSITES = [
    { name: "Website 1", url: "" },
    { name: "Website 2", url: "" },
    { name: "Website 3", url: "" },
    { name: "Website 4", url: "" },
    { name: "Website 5", url: "" },
    { name: "Website 6", url: "" },
    { name: "Website 7", url: "" }
  ];

  /**
   * Injects a "Visit our other websites" block into the footer, above
   * the bottom credit bar. Placeholder entries until the real links are
   * ready -- shown as disabled "Coming soon" chips (see OTHER_WEBSITES
   * above).
   */
  function insertOtherWebsitesSection() {
    const footerBottom = document.querySelector(".es-footer__bottom");
    if (!footerBottom || !footerBottom.parentElement || document.getElementById("es-other-sites")) return;

    const t = (k) => (window.i18n ? window.i18n.t(k) : k);
    const section = document.createElement("div");
    section.id = "es-other-sites";
    section.className = "es-other-sites";
    section.innerHTML = `
      <h4 data-i18n="footer.other_websites_title">${t("footer.other_websites_title")}</h4>
      <div class="es-other-sites__grid">
        ${OTHER_WEBSITES.map((site) => {
          const hasUrl = /^https?:\/\//i.test(site.url || "");
          if (hasUrl) {
            return `
          <a class="es-other-sites__item es-other-sites__item--live" href="${site.url}" target="_blank" rel="noopener noreferrer">
            <span class="es-other-sites__name">${site.name}</span>
          </a>`;
          }
          return `
          <span class="es-other-sites__item" aria-disabled="true">
            <span class="es-other-sites__name">${site.name}</span>
            <span class="es-other-sites__badge" data-i18n="footer.coming_soon">${t("footer.coming_soon")}</span>
          </span>`;
        }).join("")}
      </div>
    `;
    footerBottom.parentElement.insertBefore(section, footerBottom);
  }

  function openDonationModal() {
    const t = (k, v) => (window.i18n ? window.i18n.t(k, v) : k);
    const fields = [
      { label: t("donation.name_label"), value: "Zekraoui, Rabah Allaa Eddine" },
      { label: t("donation.ccp_label"), value: "0040145075 (Key 84)" },
      { label: t("donation.baridimob_label"), value: "00799999004014507584" }
    ];
    const bodyHtml = `
      <p>${t("donation.intro")}</p>
      <div class="es-donation-quote">
        <div class="es-donation-quote__arabic">${t("donation.quote_arabic")}</div>
        <div class="es-donation-quote__translation">${t("donation.quote_translation")}</div>
        <div class="es-donation-quote__ref">${t("donation.quote_reference")}</div>
      </div>
      <div>
        ${fields
          .map(
            (f) => `
          <div class="es-donation-field">
            <span class="es-donation-field__label">${f.label}</span>
            <span class="es-donation-field__value" data-copy="${f.value}">${f.value}</span>
          </div>`
          )
          .join("")}
      </div>
    `;
    openModal({
      title: t("donation.title"),
      bodyHtml,
      actions: [{ label: t("buttons.close"), value: null, variant: "ghost" }]
    }).then(() => {});

    // Wire click-to-copy after the modal is in the DOM.
    setTimeout(() => {
      document.querySelectorAll("[data-copy]").forEach((el) => {
        el.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(el.getAttribute("data-copy"));
            toast(t("donation.copied"), { type: "success" });
          } catch (e) {
            /* clipboard API unavailable; silently ignore */
          }
        });
      });
    }, 0);
  }

  function whenReady(fn) {
    if (isReady) fn();
    else readyQueue.push(fn);
  }

  /* ------------------------------------------------------------ Social icons */

  const SOCIAL_ICONS = {
    linkedin: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.03-1.85-3.03-1.85 0-2.14 1.45-2.14 2.94v5.66H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.97.24 2.43.4a4.9 4.9 0 0 1 1.77 1.15 4.9 4.9 0 0 1 1.15 1.77c.16.46.35 1.26.4 2.43.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.24 1.97-.4 2.43a4.9 4.9 0 0 1-1.15 1.77 4.9 4.9 0 0 1-1.77 1.15c-.46.16-1.26.35-2.43.4-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.97-.24-2.43-.4a4.9 4.9 0 0 1-1.77-1.15 4.9 4.9 0 0 1-1.15-1.77c-.16-.46-.35-1.26-.4-2.43-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.24-1.97.4-2.43A4.9 4.9 0 0 1 4.9 3.78 4.9 4.9 0 0 1 6.67 2.63c.46-.16 1.26-.35 2.43-.4C10.37 2.17 10.75 2.16 12 2.16zm0 1.62c-3.15 0-3.5.01-4.73.07-.96.04-1.48.2-1.83.34-.46.18-.79.39-1.13.73-.34.34-.55.67-.73 1.13-.14.35-.3.87-.34 1.83-.06 1.23-.07 1.58-.07 4.73s.01 3.5.07 4.73c.04.96.2 1.48.34 1.83.18.46.39.79.73 1.13.34.34.67.55 1.13.73.35.14.87.3 1.83.34 1.23.06 1.58.07 4.73.07s3.5-.01 4.73-.07c.96-.04 1.48-.2 1.83-.34.46-.18.79-.39 1.13-.73.34-.34.55-.67.73-1.13.14-.35.3-.87.34-1.83.06-1.23.07-1.58.07-4.73s-.01-3.5-.07-4.73c-.04-.96-.2-1.48-.34-1.83a3.28 3.28 0 0 0-.73-1.13 3.28 3.28 0 0 0-1.13-.73c-.35-.14-.87-.3-1.83-.34-1.23-.06-1.58-.07-4.73-.07zm0 4.13a4.09 4.09 0 1 1 0 8.18 4.09 4.09 0 0 1 0-8.18zm0 6.75a2.66 2.66 0 1 0 0-5.32 2.66 2.66 0 0 0 0 5.32zm5.2-6.91a.96.96 0 1 1-1.92 0 .96.96 0 0 1 1.92 0z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M13.5 21v-8.06h2.7l.4-3.14h-3.1V7.79c0-.91.25-1.53 1.56-1.53h1.66V3.46A22.3 22.3 0 0 0 14.3 3.3c-2.4 0-4.04 1.46-4.04 4.15v2.36H7.55v3.14h2.71V21h3.24z"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M18.9 3H21.6L15.66 9.8L22.66 21H17.18L12.9 14.7L8.02 21H5.3L11.66 13.72L4.94 3H10.56L14.42 8.8L18.9 3ZM17.94 19.34H19.46L9.74 4.56H8.12L17.94 19.34Z"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M21.58 7.2a2.75 2.75 0 0 0-1.94-1.95C17.9 4.75 12 4.75 12 4.75s-5.9 0-7.64.5A2.75 2.75 0 0 0 2.42 7.2 28.7 28.7 0 0 0 1.9 12a28.7 28.7 0 0 0 .52 4.8 2.75 2.75 0 0 0 1.94 1.95c1.74.5 7.64.5 7.64.5s5.9 0 7.64-.5a2.75 2.75 0 0 0 1.94-1.95c.35-1.58.53-3.19.52-4.8a28.7 28.7 0 0 0-.52-4.8zM9.9 15.02V8.98L15.4 12l-5.5 3.02z"/></svg>',
    github: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.1.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.15-1.11-1.46-1.11-1.46-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.3 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.35 4.68-4.58 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></svg>'
  };
  const SOCIAL_ICON_FALLBACK =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.5"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.36-1.36"/></svg>';

  function socialIcon(key) {
    return SOCIAL_ICONS[key] || SOCIAL_ICON_FALLBACK;
  }

  /* --------------------------------------------------------------- Public API */

  return {
    runLoadingSequence,
    toast,
    openModal,
    confirmDialog,
    setButtonLoading,
    initExpandingSearch,
    initMobileNav,
    loadTaxonomy,
    loadSocials,
    taxonomyLabel,
    sortByLabel,
    generateFallbackCover,
    socialIcon,
    sleep,
    markReady,
    whenReady
  };
})();
