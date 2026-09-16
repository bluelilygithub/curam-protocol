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

  // A real page's actual styling very often lives in <style> blocks embedded directly in the
  // HTML (most commonly in <head>), not only in linked/uploaded CSS files — before this, those
  // blocks were left in place but never surfaced as CSS the tool knew about, which caused two
  // separate-looking bugs that were really the same root cause: a pasted/scraped page with only
  // embedded <style> rendered unstyled in the preview (its CSS was silently along for the ride,
  // inert, since "Build the preview" only ever runs the SEPARATE cssEntries list through the
  // auto-fix pipeline), and "Build the preview" stayed disabled since cssEntries was empty even
  // though the page unmistakably had real CSS. Fix: pull every <style> block's text out into its
  // own return value, remove the tags from the DOM so they aren't duplicated once the merged,
  // auto-fixed stylesheet is re-injected, and let the caller add it to cssEntries like any other
  // source — so it goes through the exact same auto-fix/flag pass as an uploaded file.
  const embeddedCss = [...doc.querySelectorAll('style')]
    .map(el => el.textContent || '')
    .filter(css => css.trim())
    .join('\n\n');
  doc.querySelectorAll('style').forEach(el => el.remove());

  return {
    html: dom.serialize(),
    bodyInnerHTML: doc.body ? doc.body.innerHTML : '',
    headInnerHTML: doc.head ? doc.head.innerHTML : '',
    embeddedCss,
  };
}

module.exports = { sanitizeHtml };
