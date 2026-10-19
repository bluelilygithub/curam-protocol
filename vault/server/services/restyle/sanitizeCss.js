'use strict';

// CSS that Vault serves back out to someone who is not the author (the public preview link) is cleaned here first. The pages and the
// changes come out of a saved project, which is whatever the owner's browser (or a direct API call) stored, so none of it is trusted.
// The shared page also carries a Content-Security-Policy with no scripts, so this is a second wall, not the only one.
//
//   sanitizeEditsCss  - the CSS the tool itself generates (see client/src/pages/restyle/editModel.mjs): only the properties the tool
//                       manages, plus --brand-* custom properties, inside plain rules, @media and the tool's own @keyframes.
//   sanitizePageCss   - the page's own style files: kept as written, minus @import, behaviours and anything that runs code.

const postcss = require('postcss');

// The properties the tool can change (CSS names), plus the longhands its animation presets use.
const EDITABLE_PROPERTIES = new Set([
  'font-family', 'font-size', 'font-weight', 'color', 'line-height', 'background-color', 'border-radius', 'padding', 'box-shadow',
  'text-transform', 'letter-spacing', 'text-align', 'animation',
  // keyframe bodies
  'opacity', 'transform',
]);
const SAFE_SELECTOR = /^[\w\s.#:>+~*[\]="'\-(),^$|\\]+$/;
const SAFE_MEDIA = /^[\w\s():,.\-<>=/]+$/;
const KEYFRAME_NAME = /^restyle[A-Za-z]+$/;
// Anything in a value that can load a file, run code or hide something from this check.
const DANGEROUS_VALUE = /url\s*\(|expression\s*\(|javascript:|@import|behaviou?r|-moz-binding|\\|<|\/\*/i;

function declOk(decl, { allowAnyProperty }) {
  const prop = decl.prop.toLowerCase();
  const propOk = allowAnyProperty ? !/^(behaviou?r|-moz-binding)$/.test(prop) : (EDITABLE_PROPERTIES.has(prop) || /^--brand-[a-z0-9-]+$/.test(prop));
  return propOk && decl.value && !DANGEROUS_VALUE.test(decl.value);
}

/** Cleans the CSS the tool generates. Returns '' when nothing safe is left. Never throws. */
function sanitizeEditsCss(css) {
  let root;
  try { root = postcss.parse(String(css || '')); } catch { return ''; }
  root.walkComments((c) => c.remove());
  root.walkAtRules((rule) => {
    const name = rule.name.toLowerCase();
    if (name === 'media') {
      if (!SAFE_MEDIA.test(rule.params) || /url|expression|javascript/i.test(rule.params)) rule.remove();
    } else if (name === 'keyframes' || name === '-webkit-keyframes') {
      if (!KEYFRAME_NAME.test(rule.params.trim())) rule.remove();
    } else {
      rule.remove(); // @import, @font-face, @charset, @supports... none of them belong here
    }
  });
  root.walkRules((rule) => {
    const inKeyframes = rule.parent && rule.parent.type === 'atrule' && /keyframes/i.test(rule.parent.name);
    if (!inKeyframes && (!SAFE_SELECTOR.test(rule.selector) || /[{};@]/.test(rule.selector))) rule.remove();
  });
  root.walkDecls((decl) => { if (!declOk(decl, { allowAnyProperty: false })) decl.remove(); });
  // empty rules and at-rules left behind
  root.walk((node) => { if ((node.type === 'rule' || node.type === 'atrule') && node.nodes && node.nodes.length === 0) node.remove(); });
  return root.toString().trim();
}

/** Cleans a page's own CSS for the public preview: no imports, no behaviours, nothing that runs code. Never throws. */
function sanitizePageCss(css) {
  let root;
  try { root = postcss.parse(String(css || '')); } catch { return ''; }
  root.walkAtRules((rule) => { if (/^(import|charset|namespace)$/i.test(rule.name)) rule.remove(); });
  root.walkDecls((decl) => {
    if (/^(behaviou?r|-moz-binding)$/i.test(decl.prop) || /expression\s*\(|javascript:/i.test(decl.value)) decl.remove();
  });
  return root.toString().trim();
}

/** Makes CSS safe to place inside a <style> element: nothing in it may close the element. */
function forStyleElement(css) {
  return String(css || '').replace(/<\/(style)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

module.exports = { sanitizeEditsCss, sanitizePageCss, forStyleElement, EDITABLE_PROPERTIES };
