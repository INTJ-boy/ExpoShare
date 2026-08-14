/**
 * ExpoShare i18n engine.
 * Loads /data/i18n/{lang}.json and resolves every [data-i18n] element.
 * Supports nested keys ("nav.home"), attribute targets, and {placeholder}
 * interpolation, plus RTL switching for Arabic.
 */
(function () {
  const STORAGE_KEY = "exposhare_lang";
  const SUPPORTED = (window.EXPOSHARE_CONFIG && window.EXPOSHARE_CONFIG.SUPPORTED_LANGUAGES) || ["en", "fr", "ar"];
  const DEFAULT_LANG = (window.EXPOSHARE_CONFIG && window.EXPOSHARE_CONFIG.DEFAULT_LANGUAGE) || "en";

  let dict = {};
  let currentLang = DEFAULT_LANG;
  const listeners = [];

  function getKey(obj, path) {
    return path.split(".").reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), obj);
  }

  function interpolate(str, vars) {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  }

  /**
   * Translate a key. Falls back to the key itself (visibly) if missing,
   * which makes untranslated strings easy to spot during QA rather than
   * silently rendering blank.
   */
  function t(key, vars) {
    const val = getKey(dict, key);
    if (val === undefined) {
      console.warn(`[i18n] Missing key for "${currentLang}": ${key}`);
      return key;
    }
    return interpolate(val, vars);
  }

  function applyDom(root) {
    const scope = root || document;

    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const varsAttr = el.getAttribute("data-i18n-vars");
      const vars = varsAttr ? JSON.parse(varsAttr) : undefined;
      el.textContent = t(key, vars);
    });

    scope.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });

    scope.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
    });

    scope.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
    });

    scope.querySelectorAll("[data-i18n-html]").forEach((el) => {
      // Only for trusted, static, non-user-generated strings.
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
  }

  function applyDirection(lang) {
    const meta = getKey(dict, "meta") || {};
    const dir = meta.dir || (lang === "ar" ? "rtl" : "ltr");
    document.documentElement.setAttribute("lang", lang);
    document.documentElement.setAttribute("dir", dir);
    document.body && document.body.classList.toggle("is-rtl", dir === "rtl");
  }

  async function loadLang(lang) {
    if (!SUPPORTED.includes(lang)) lang = DEFAULT_LANG;
    const res = await fetch(`data/i18n/${lang}.json`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load translations for ${lang}`);
    dict = await res.json();
    currentLang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    applyDirection(lang);
    applyDom(document);
    listeners.forEach((fn) => {
      try { fn(lang); } catch (e) { console.error(e); }
    });
    document.dispatchEvent(new CustomEvent("exposhare:lang-changed", { detail: { lang } }));
  }

  function getSavedLang() {
    return localStorage.getItem(STORAGE_KEY) || navigatorLang() || DEFAULT_LANG;
  }

  function navigatorLang() {
    const nav = (navigator.language || "en").slice(0, 2);
    return SUPPORTED.includes(nav) ? nav : null;
  }

  window.i18n = {
    t,
    apply: applyDom,
    init: async function () {
      await loadLang(getSavedLang());
    },
    setLang: async function (lang) {
      await loadLang(lang);
    },
    currentLang: () => currentLang,
    supported: () => SUPPORTED.slice(),
    onChange: (fn) => listeners.push(fn)
  };
})();
