/*
 * Cellar Planner lite: fills the website's enquiry form from the embedded planner.
 *
 * Put this on the WordPress page that holds the planner iframe AND the enquiry form (enqueue it from the theme, or a Custom HTML block), AFTER
 * checking the settings below. The planner posts its design (a short design code and a one-line summary) to this page; this script writes them into
 * the form's message box and, when the visitor presses "Request a quote for this design", scrolls to the form. No personal data passes through
 * here: the planner only knows the room size, door wall, bottle style and bottle count.
 *
 * Nothing is sent anywhere by this script. The visitor still presses your form's own Send button.
 */
(function () {
  'use strict';

  // 1. The origin that serves the planner iframe, exactly as in the iframe's src (scheme + host, no path, no trailing slash).
  var PLANNER_ORIGIN = 'https://www.wiwc.com.au';
  // 2. The enquiry form, its message box, and the first field the visitor should fill in (focused after the scroll; '' = leave focus alone).
  var FORM_SELECTOR = '#cw-contact-form';
  var MESSAGE_FIELD = '#cw-contact-message';
  var FIRST_FIELD = '#cw-contact-name';
  // 3. true = scroll the form into view when the visitor presses "Request a quote for this design".
  var SCROLL_TO_FORM = true;

  // The design goes into the message between these two lines. A later change in the planner replaces just this block, never what the visitor typed.
  var START = '--- Cellar planner design ---';
  var END = '---';
  var BLOCK = new RegExp('(^|\\n)' + START + '[\\s\\S]*?\\n' + END + '(\\n|$)');
  var wasRequested = false;

  function put(el, design) {
    var block = START + '\n' + design + '\n' + END;
    var current = el.value || '';
    el.value = BLOCK.test(current) ? current.replace(BLOCK, function (m, a, b) { return a + block + b; }) : (current ? current.replace(/\s+$/, '') + '\n\n' : '') + block;
    // frameworks and form plugins listen for these, not for a direct value change
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  window.addEventListener('message', function (ev) {
    // only the planner's own origin; anything else is ignored
    if (ev.origin !== PLANNER_ORIGIN) return;
    var d = ev.data;
    if (!d || d.type !== 'cellar-lite:design' || d.version !== 1) return;
    if (typeof d.code !== 'string' || typeof d.summary !== 'string') return;
    // the code is base64url text and the summary one plain line; refuse anything else rather than put it in a form
    if (!/^CL\d+\.[A-Za-z0-9_-]{1,200}$/.test(d.code) || d.summary.length > 400) return;

    var message = document.querySelector(MESSAGE_FIELD);
    if (message) put(message, d.summary + '\nDesign code: ' + d.code);

    // scroll once, when the button is pressed, not again for every later tweak to the design
    var pressed = !!d.requested && !wasRequested;
    wasRequested = !!d.requested;
    if (!pressed || !SCROLL_TO_FORM) return;
    var form = document.querySelector(FORM_SELECTOR);
    if (!form || !form.scrollIntoView) return;
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    form.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    var first = FIRST_FIELD && document.querySelector(FIRST_FIELD);
    // focus without a second jump; the smooth scroll above is already under way
    if (first && first.focus) window.setTimeout(function () { first.focus({ preventScroll: true }); }, 600);
  });
})();
