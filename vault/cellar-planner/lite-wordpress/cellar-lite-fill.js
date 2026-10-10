/*
 * Cellar Planner lite: the small script that lives on the website around the planner.
 *
 * Load this one file on BOTH pages: the page that holds the planner and the contact page (enqueue it site-wide, or on those two pages).
 *
 *  - Planner page: when the visitor presses "Request a quote for this design", it takes them to CONTACT_URL, carrying the design in the address.
 *    It also (a) sizes the planner's frame to fit, so there is one page to scroll, (b) on phones shows a bar at the bottom of the screen with the
 *    bottle count, the guide price and a quote button while the planner is on screen, and (c) passes the planner's anonymous usage events to Google
 *    Tag Manager (window.dataLayer), if the site has it.
 *  - Contact page: it finds the design in the address, writes it into the form's message box, scrolls to the form and puts the cursor in the
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
  // 4. Planner page extras. Switch any off by setting it to false.
  var AUTO_HEIGHT = true;       // size the planner's frame to its content (no scroll bar inside the page)
  var STICKY_BAR = true;        // phone-width screens: a quote bar at the bottom while the planner is on screen
  var STICKY_MAX_WIDTH = 640;   // "phone width" in pixels
  var TRACK_EVENTS = true;      // push the planner's usage events to window.dataLayer
  // 5. Set to false once everything works. While true, each step is written to the browser Console (F12), every line starting "[cellar-lite]".
  var DEBUG = true;
  function log() { if (DEBUG && window.console) console.log.apply(console, ['[cellar-lite]'].concat([].slice.call(arguments))); }
  log('script loaded on', window.location.href, '| expecting planner from', PLANNER_ORIGIN, '| contact page', CONTACT_URL);

  var CODE_RE = /^CL\d+\.[A-Za-z0-9_-]{1,200}$/;
  var START = '--- Cellar planner design ---';
  var END = '---';
  var EVENTS = ['start', 'preset', 'unit', 'view', 'quote', 'link_copied', 'plan_downloaded', 'price_help', 'fix', 'welcome_back', 'call', 'door_pick', 'step', 'finish'];
  var wasRequested = false;
  var latest = null; // the newest valid design message { code, summary, bottles, priceText, thumb }
  var layout = null; // where the planner's big picture sits inside its frame { frame, top, bottom }
  var THUMB_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/;

  // Same scheme, port and host, treating "www.example.com" and "example.com" as the same site.
  function sameSite(a, b) {
    try {
      var x = new URL(a), y = new URL(b);
      return x.protocol === y.protocol && x.port === y.port && x.hostname.replace(/^www\./, '') === y.hostname.replace(/^www\./, '');
    } catch (e) { return false; }
  }
  /** The iframe element a message came from (its window is ev.source), or null. */
  function frameOf(source) {
    var frames = document.getElementsByTagName('iframe');
    for (var i = 0; i < frames.length; i++) if (frames[i].contentWindow === source) return frames[i];
    return null;
  }

  function goToContact(code, summary) {
    var url = CONTACT_URL + '?cellar-design=' + encodeURIComponent(code) + '&cellar-summary=' + encodeURIComponent(summary) + '#cw-contact-form';
    log('going to', url);
    window.location.href = url;
  }

  // ---- planner page: the phone bar ----
  var bar = null, barText = null, barImg = null, frameVisible = false, observed = null, ticking = false;
  function ensureBar() {
    if (bar) return;
    var css = document.createElement('style');
    css.textContent =
      '#cellar-lite-bar{position:fixed;left:0;right:0;bottom:0;z-index:99990;display:none;align-items:center;gap:12px;padding:10px 14px;background:#1f1f1f;color:#fff;font:600 15px/1.25 system-ui,sans-serif;box-shadow:0 -2px 12px rgba(0,0,0,.25)}' +
      '#cellar-lite-bar .t{flex:1;min-width:0}' +
      '#cellar-lite-bar img{flex:none;width:90px;height:56px;border-radius:6px;object-fit:cover;background:#e9dfcc;display:none}' +
      '#cellar-lite-bar button{flex:none;min-height:44px;padding:0 18px;border:0;border-radius:999px;background:#cc785c;color:#fff;font:700 15px system-ui,sans-serif;cursor:pointer;transition:opacity 200ms}' +
      '#cellar-lite-bar button:hover{opacity:.8}';
    document.head.appendChild(css);
    bar = document.createElement('div');
    bar.id = 'cellar-lite-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Request a quote');
    barImg = document.createElement('img');
    barImg.alt = 'Your cellar';
    barText = document.createElement('span');
    barText.className = 't';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Request a quote';
    btn.setAttribute('title', 'Ask for a quote for the design you have made.');
    btn.addEventListener('click', function () { if (latest) goToContact(latest.code, latest.summary); });
    bar.appendChild(barImg); bar.appendChild(barText); bar.appendChild(btn);
    document.body.appendChild(bar);
    window.addEventListener('resize', refreshBar);
    // the little picture shows only while the big one is off screen, so it is never shown twice
    window.addEventListener('scroll', function () { if (ticking) return; ticking = true; window.requestAnimationFrame(function () { ticking = false; refreshBar(); }); }, { passive: true });
  }
  function refreshBar() {
    if (!bar) return;
    var phone = window.matchMedia && window.matchMedia('(max-width: ' + STICKY_MAX_WIDTH + 'px)').matches;
    bar.style.display = phone && frameVisible && latest && !wasRequested ? 'flex' : 'none';
    var showPic = bar.style.display === 'flex' && !!latest.thumb && !pictureOnScreen();
    barImg.style.display = showPic ? 'block' : 'none';
    document.body.style.paddingBottom = bar.style.display === 'flex' ? bar.offsetHeight + 'px' : '';
  }
  /** True when most of the planner's big picture is inside the visible part of the screen. */
  function pictureOnScreen() {
    if (!layout || !layout.frame) return false;
    var top = layout.frame.getBoundingClientRect().top;
    var from = top + layout.top, to = top + layout.bottom;
    var overlap = Math.min(to, window.innerHeight) - Math.max(from, 0);
    return overlap >= Math.min(220, (to - from) * 0.6);
  }
  function watchFrame(frame) {
    if (observed === frame || typeof IntersectionObserver === 'undefined') return;
    observed = frame;
    new IntersectionObserver(function (entries) { frameVisible = entries[0].isIntersecting; refreshBar(); }, { threshold: 0.12 }).observe(frame);
  }

  // ---- messages from the planner ----
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || typeof d.type !== 'string' || d.type.indexOf('cellar-lite:') !== 0) return;
    // log every planner message, whoever it came from, so a wrong origin is visible instead of silent
    log('message', d.type, 'from', ev.origin);
    if (!sameSite(ev.origin, PLANNER_ORIGIN)) { log('IGNORED: sent from', ev.origin, 'but PLANNER_ORIGIN is', PLANNER_ORIGIN); return; }
    if (d.version !== 1) { log('IGNORED: unknown version', d.version); return; }

    if (d.type === 'cellar-lite:height') {
      var h = Number(d.height);
      var f = AUTO_HEIGHT && frameOf(ev.source);
      if (f && isFinite(h) && h >= 300 && h <= 8000) { f.style.height = Math.ceil(h) + 'px'; f.setAttribute('scrolling', 'no'); log('frame height set to', Math.ceil(h)); }
      var pt = Number(d.pictureTop), pb = Number(d.pictureBottom);
      if (f && isFinite(pt) && isFinite(pb) && pb > pt && pb <= 20000) { layout = { frame: f, top: pt, bottom: pb }; refreshBar(); }
      return;
    }

    if (d.type === 'cellar-lite:event') {
      if (!TRACK_EVENTS || EVENTS.indexOf(d.name) === -1) return;
      var push = { event: 'cellar_lite_' + d.name };
      ['room', 'unit', 'view', 'step', 'finish'].forEach(function (k) { if (typeof d[k] === 'string' && /^[a-z0-9-]{1,40}$/.test(d[k])) push['cellar_lite_' + k] = d[k]; });
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(push);
      log('dataLayer.push', JSON.stringify(push));
      return;
    }

    if (d.type !== 'cellar-lite:design') return;
    if (typeof d.code !== 'string' || typeof d.summary !== 'string') { log('IGNORED: code or summary missing'); return; }
    // the code is base64url text and the summary one plain line; refuse anything else
    if (!CODE_RE.test(d.code) || d.summary.length > 400) { log('IGNORED: code or summary has an unexpected shape'); return; }
    latest = { code: d.code, summary: d.summary, bottles: Number(d.bottles) || 0, priceText: typeof d.priceText === 'string' && d.priceText.length <= 60 ? d.priceText : '',
      thumb: typeof d.thumb === 'string' && d.thumb.length <= 40000 && THUMB_RE.test(d.thumb) ? d.thumb : '' };

    if (STICKY_BAR) {
      ensureBar();
      barText.textContent = 'About ' + latest.bottles + ' bottles' + (latest.priceText ? ' · ' + latest.priceText : '');
      if (latest.thumb && barImg.getAttribute('src') !== latest.thumb) barImg.src = latest.thumb;
      var fr = frameOf(ev.source);
      if (fr) watchFrame(fr);
    }

    var pressed = !!d.requested && !wasRequested; // once per press, not for every later tweak
    wasRequested = !!d.requested;
    refreshBar();
    if (!pressed) { log('design updated; button not pressed, staying here'); return; }
    log('button pressed');
    goToContact(d.code, d.summary);
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
