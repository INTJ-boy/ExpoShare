/**
 * Wires the header language selector present on every page.
 * Persists the choice via i18n.js (localStorage) and re-applies
 * translations + RTL direction across the whole document.
 */
(function () {
  document.addEventListener("DOMContentLoaded", wire);
  if (document.readyState !== "loading") wire();

  function wire() {
    const switchEl = document.getElementById("es-lang-switch");
    if (!switchEl || switchEl.dataset.wired) return;
    switchEl.dataset.wired = "1";

    const btn = document.getElementById("es-lang-btn");
    const current = document.getElementById("es-lang-current");
    const menuButtons = switchEl.querySelectorAll("[data-lang]");

    btn.addEventListener("click", () => switchEl.classList.toggle("es-lang-switch--open"));
    document.addEventListener("click", (e) => {
      if (!switchEl.contains(e.target)) switchEl.classList.remove("es-lang-switch--open");
    });

    menuButtons.forEach((b) => {
      b.addEventListener("click", async () => {
        await window.i18n.setLang(b.getAttribute("data-lang"));
        switchEl.classList.remove("es-lang-switch--open");
      });
    });

    function reflectCurrent() {
      const lang = window.i18n.currentLang();
      if (current) current.textContent = lang.toUpperCase();
      menuButtons.forEach((b) => b.classList.toggle("is-active", b.getAttribute("data-lang") === lang));
    }
    window.i18n.onChange(reflectCurrent);
    reflectCurrent();
  }
})();
