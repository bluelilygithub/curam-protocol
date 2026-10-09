/*
 * Cellar Planner lite: fills the website's enquiry form from the embedded planner.
 *
 * Put this on the WordPress page that holds the planner iframe (a Custom HTML block, or the theme's footer scripts), AFTER editing the three
 * settings below. The planner posts its design (a short design code and a one-line summary) to this page; this script copies them into two
 * fields of your form (Contact Form 7, WPForms, Gravity Forms or any plain form). No personal data passes through here: the planner only knows
 * the room size, door wall, bottle style and bottle count.
 *
 * Nothing is sent anywhere by this script. The visitor still presses your form's own Send button.
 */
(function () {
  'use strict';

  // 1. The origin that serves the planner iframe, exactly as in the iframe's src (scheme + host, no path, no trailing slash).
  var PLANNER_ORIGIN = 'https://www.example.com.au';
  // 2. CSS selectors of the two form fields to fill. Use a hidden field for the code and a visible (or hidden) text/textarea for the summary.
  var CODE_FIELD = 'input[name="design-code"]';
  var SUMMARY_FIELD = '[name="design-summary"]';
  // 3. true = also scroll the form into view when the visitor presses "Request a quote" in the planner. FORM_SELECTOR is that form.
  var SCROLL_TO_FORM = true;
  var FORM_SELECTOR = 'form';

  function setValue(selector, value) {
    var el = document.querySelector(selector);
    if (!el) return false;
    el.value = value;
    // frameworks and form plugins listen for these, not for a direct value change
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  window.addEventListener('message', function (ev) {
    // only the planner's own origin; anything else is ignored
    if (ev.origin !== PLANNER_ORIGIN) return;
    var d = ev.data;
    if (!d || d.type !== 'cellar-lite:design' || d.version !== 1) return;
    if (typeof d.code !== 'string' || typeof d.summary !== 'string') return;
    // the code is base64url text and the summary one plain line; refuse anything else rather than put it in a form
    if (!/^CL\d+\.[A-Za-z0-9_-]{1,200}$/.test(d.code) || d.summary.length > 400) return;
    setValue(CODE_FIELD, d.code);
    setValue(SUMMARY_FIELD, d.summary + ' [Design code: ' + d.code + ']');
    if (d.requested && SCROLL_TO_FORM) {
      var form = document.querySelector(FORM_SELECTOR);
      if (form && form.scrollIntoView) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
})();
