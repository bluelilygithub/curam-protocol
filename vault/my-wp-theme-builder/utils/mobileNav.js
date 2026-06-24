/**
 * Inject hamburger toggle + collapsible nav for mobile viewports.
 */

const NAV_TOGGLE_CSS = `
/* theme-builder mobile nav */
.nav-toggle,
.tb-nav-toggle {
  display: none;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  width: 2.75rem;
  height: 2.75rem;
  padding: 0.5rem;
  margin-left: auto;
  border: 1px solid currentColor;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  flex-shrink: 0;
}
.nav-toggle__bar {
  display: block;
  width: 100%;
  height: 2px;
  background: currentColor;
  border-radius: 1px;
}
@media (max-width: 767px) {
  .header-inner,
  header > .container,
  header .container {
    display: flex !important;
    flex-direction: row !important;
    flex-wrap: wrap !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 0.75rem !important;
  }
  .nav-toggle,
  .tb-nav-toggle {
    display: flex !important;
    order: 2;
    margin-left: auto;
  }
  header > .container > a,
  header > .container > .logo,
  header .header-inner > a,
  header .header-inner > .logo,
  header .site-logo {
    order: 1;
  }
  header nav:not(.is-open),
  #site-navigation:not(.is-open) {
    display: none !important;
    order: 3;
    flex-basis: 100%;
    width: 100% !important;
    flex-direction: column !important;
    gap: 0.5rem !important;
    margin-top: 0 !important;
  }
  header nav.is-open,
  #site-navigation.is-open {
    display: flex !important;
    order: 3;
    flex-basis: 100%;
    flex-direction: column !important;
    width: 100% !important;
    gap: 0.5rem !important;
    margin-top: 0.25rem !important;
  }
  header nav ul,
  #site-navigation ul,
  header nav ol,
  #site-navigation ol {
    flex-direction: column !important;
    align-items: stretch !important;
    width: 100% !important;
    gap: 0.5rem !important;
    margin: 0 !important;
    padding: 0 !important;
    list-style: none !important;
  }
  header nav a,
  #site-navigation a {
    display: block !important;
    width: 100% !important;
    padding: 0.5rem 0 !important;
  }
}
@media (min-width: 768px) {
  .nav-toggle,
  .tb-nav-toggle {
    display: none !important;
  }
  header nav,
  #site-navigation {
    display: flex !important;
    flex-direction: row !important;
    align-items: center !important;
  }
}
`.trim();

const NAV_TOGGLE_SCRIPT = `<script id="tb-nav-toggle">
(function () {
  var btn = document.querySelector('.nav-toggle, .tb-nav-toggle');
  if (!btn || btn.dataset.tbNavBound) return;
  btn.dataset.tbNavBound = '1';
  var nav = document.getElementById('site-navigation') || document.querySelector('header nav');
  if (!nav) return;
  nav.classList.remove('is-open');
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', function () {
    var open = nav.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
})();
</script>`;

const TOGGLE_BUTTON = `<button type="button" class="nav-toggle tb-nav-toggle" aria-expanded="false" aria-controls="site-navigation">
  <span class="nav-toggle__bar" aria-hidden="true"></span>
  <span class="nav-toggle__bar" aria-hidden="true"></span>
  <span class="nav-toggle__bar" aria-hidden="true"></span>
  <span class="visually-hidden">Menu</span>
</button>`;

function hasNavToggle(html) {
  return /class=["'][^"']*(nav-toggle|tb-nav-toggle)/i.test(html);
}

function ensureNavId(html) {
  if (!/<header\b/i.test(html) || !/<nav\b/i.test(html)) return html;

  return html.replace(
    /<header\b([\s\S]*?)<nav\b([^>]*)>/i,
    (full, headBody, navAttrs) => {
      if (/\bid\s*=\s*["']site-navigation["']/i.test(navAttrs)) {
        return full;
      }
      if (/\bid\s*=/i.test(navAttrs)) {
        return `<header${headBody}<nav id="site-navigation"${navAttrs}>`;
      }
      return `<header${headBody}<nav id="site-navigation"${navAttrs}>`;
    }
  );
}

function injectNavToggle(html) {
  if (!/<header\b/i.test(html) || !/<nav\b/i.test(html)) return html;
  if (hasNavToggle(html)) return ensureNavId(html);

  let out = ensureNavId(html);
  out = out.replace(
    /(<header\b[\s\S]*?)(<nav\b)/i,
    `$1${TOGGLE_BUTTON}\n$2`
  );

  return out;
}

function injectNavToggleStyles(html) {
  const block = `<style id="tb-nav-styles">\n${NAV_TOGGLE_CSS}\n</style>`;
  let out = html.replace(/<style id=["']tb-nav-styles["'][^>]*>[\s\S]*?<\/style>/gi, '');
  if (/<\/body>/i.test(out)) {
    return out.replace(/<\/body>/i, `${block}\n</body>`);
  }
  if (/<\/head>/i.test(out)) {
    return out.replace(/<\/head>/i, `${block}\n</head>`);
  }
  return `${out}\n${block}`;
}

function injectNavToggleScript(html) {
  if (/<script[^>]+id=["']tb-nav-toggle["']/i.test(html)) {
    return html;
  }
  if (!hasNavToggle(html) && !/<header\b[\s\S]*?<nav\b/i.test(html)) {
    return html;
  }

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${NAV_TOGGLE_SCRIPT}\n</body>`);
  }
  return `${html}\n${NAV_TOGGLE_SCRIPT}`;
}

function ensureMobileNav(html) {
  if (!html) return html;
  let out = injectNavToggle(html);
  out = injectNavToggleStyles(out);
  out = injectNavToggleScript(out);
  return out;
}

module.exports = {
  NAV_TOGGLE_CSS,
  ensureMobileNav,
};
