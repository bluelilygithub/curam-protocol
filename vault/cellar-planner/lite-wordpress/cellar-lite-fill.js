/*
 * Cellar Planner lite: sends the visitor from the planner page to the contact page with their design already in the form.
 *
 * Load this one file on BOTH pages: the page that holds the planner and the contact page (enqueue it site-wide, or on those two pages).
 *
 *  - On the planner page: when the visitor presses "Request a quote for this design", it takes them to CONTACT_URL, carrying the design in the address.
 *  - On the contact page: it finds the design in the address, writes it into the form's message box, scrolls to the form and puts the cursor in the
 *    first field. The visitor still presses the form's own Send button; nothing is sent by this script.
 *
 * No personal data passes through here: the planner only knows the room size, door wall, bottle style and bottle count.
 */
(function () {
  'use strict';

  // 1. The origin that serves the planner iframe, exactly as in the iframe's src (scheme + host, no path, no trailing slash).
  var PLANNER_ORIGIN = 'https://www.wiwc.com.au';
  // 2. The contact page that holds the form.
  var CONTACT_URL = 'https://wiwc.com.au/contact/';
  // The address of the planner folder itself (not the WordPress page that embeds it). The enquiry carries a link here with the design code added,
  // so the customer, and you, can reopen exactly this design later.
  var PLANNER_LINK = 'https://wiwc.com.au/cellar-lite/';
  // 3. On the contact page: the form, its message box, and the first field the visitor fills in ('' = leave focus alone).
  var FORM_SELECTOR = '#cw-contact-form';
  var MESSAGE_FIELD = '#cw-contact-message';
  var FIRST_FIELD = '#cw-contact-name';

  // 4. Set to false once everything works. While true, each step is written to the browser Console (F12), every line starting "[cellar-lite]".
  var DEBUG = true;
  function log() { if (DEBUG && window.console) console.log.apply(console, ['[cellar-lite]'].concat([].slice.call(arguments))); }
  log('script loaded on', window.location.href, '| expecting planner from', PLANNER_ORIGIN, '| contact page', CONTACT_URL);

  var CODE_RE = /^CL\d+\.[A-Za-z0-9_-]{1,200}$/;
  var START = '--- Cellar planner design ---';
  var END = '---';
  var wasRequested = false;

  // Same scheme, port and host, treating "www.example.com" and "example.com" as the same site.
  function sameSite(a, b) {
    try {
      var x = new URL(a), y = new URL(b);
      return x.protocol === y.protocol && x.port === y.port && x.hostname.replace(/^www\./, '') === y.hostname.replace(/^www\./, '');
    } catch (e) { return false; }
  }

  // ---- planner page: the button was pressed, go to the contact page ----
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    // log every planner message, whoever it came from, so a wrong origin is visible instead of silent
    if (d && d.type === 'cellar-lite:design') log('message from', ev.origin, '| requested:', d.requested, '| code:', d.code);
    else return;
    if (!sameSite(ev.origin, PLANNER_ORIGIN)) { log('IGNORED: sent from', ev.origin, 'but PLANNER_ORIGIN is', PLANNER_ORIGIN); return; }
    if (d.version !== 1) { log('IGNORED: unknown version', d.version); return; }
    if (typeof d.code !== 'string' || typeof d.summary !== 'string') { log('IGNORED: code or summary missing'); return; }
    // the code is base64url text and the summary one plain line; refuse anything else
    if (!CODE_RE.test(d.code) || d.summary.length > 400) { log('IGNORED: code or summary has an unexpected shape'); return; }
    var pressed = !!d.requested && !wasRequested; // once per press, not for every later tweak
    wasRequested = !!d.requested;
    if (!pressed) { log('design updated; button not pressed, staying here'); return; }
    var url = CONTACT_URL + '?cellar-design=' + encodeURIComponent(d.code) + '&cellar-summary=' + encodeURIComponent(d.summary) + '#cw-contact-form';
    log('button pressed: going to', url);
    window.location.href = url;
  });

  // ---- contact page: fill the form from the address ----
  function fillFromAddress() {
    var params;
    try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
    var code = params.get('cellar-design');
    var summary = params.get('cellar-summary');
    if (!code || !summary) { log('contact-page check: no design in the address, nothing to fill'); return; }
    if (!CODE_RE.test(code) || summary.length > 400) { log('contact-page check: design in the address has an unexpected shape, ignored'); return; }
    var form = document.querySelector(FORM_SELECTOR);
    var message = document.querySelector(MESSAGE_FIELD);
    log('contact-page check: design found; form', FORM_SELECTOR, form ? 'found' : 'NOT FOUND', '| message box', MESSAGE_FIELD, message ? 'found' : 'NOT FOUND');
    if (!form || !message) return;

    var link = PLANNER_LINK + '?d=' + encodeURIComponent(code);
    var block = START + '\n' + summary + '\nDesign code: ' + code + '\nView this design again: ' + link + '\n' + END;
    var typed = (message.value || '').replace(/\s+$/, '');
    if (message.value.indexOf(START) === -1) message.value = typed ? typed + '\n\n' + block : block;
    // form plugins listen for these, not for a direct value change
    message.dispatchEvent(new Event('input', { bubbles: true }));
    message.dispatchEvent(new Event('change', { bubbles: true }));

    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    form.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    var first = FIRST_FIELD && document.querySelector(FIRST_FIELD);
    if (first && first.focus) window.setTimeout(function () { first.focus({ preventScroll: true }); }, 600);

    log('message box filled; scrolled to the form');
    // tidy the address so a refresh or a shared link does not carry the design along
    try { window.history.replaceState(null, '', window.location.pathname + '#cw-contact-form'); } catch (e) { /* fine */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fillFromAddress);
  else fillFromAddress();
})();
