'use strict';

// Strips anything that could execute script from uploaded HTML before it's ever sent to the
// browser — the iframe preview relies on this, not on the sandbox attribute alone, since we
// deliberately don't set allow-scripts. Uses jsdom's real DOM/parser, never regex, so this
// can't be bypassed by malformed markup the way a naive string replace could be.
const { JSDOM } = require('jsdom');

const EVENT_HANDLER_ATTR = /^on/i;

function sanitizeHtml(rawHtml) {
  const dom = new JSDOM(rawHtml || '<html><body></body></html>');
  const doc = dom.window.document;

  // Remove <script> tags entirely.
  doc.querySelectorAll('script').forEach(el => el.remove());

  // Remove inline event handlers (onclick, onerror, etc.) and javascript: URLs on every element.
  doc.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      if (EVENT_HANDLER_ATTR.test(attr.name)) el.removeAttribute(attr.name);
      if (['href', 'src', 'action'].includes(attr.name.toLowerCase()) && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    });
  });

  // Neutralize <meta http-equiv="refresh"> and any <iframe>/<object>/<embed> (nested browsing
  // contexts we don't control) and <base> (could redirect relative asset paths unexpectedly).
  doc.querySelectorAll('iframe, object, embed, base').forEach(el => el.remove());
  doc.querySelectorAll('meta[http-equiv]').forEach(el => {
    if (/refresh/i.test(el.getAttribute('http-equiv') || '')) el.remove();
  });

  return {
    html: dom.serialize(),
    bodyInnerHTML: doc.body ? doc.body.innerHTML : '',
    headInnerHTML: doc.head ? doc.head.innerHTML : '',
  };
}

module.exports = { sanitizeHtml };
