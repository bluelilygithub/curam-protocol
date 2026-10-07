// `chromium` for the e2e scripts, with one change: the Inspector blocks are an accordion (one open at a time), so before a test types into
// or clicks a control, open the closed block that holds it. Clicking a block's own heading is left alone (it is the toggle).
import { chromium as base } from 'playwright-core';

const openAncestors = (el) => {
  let from = el.tagName === 'SUMMARY' ? el.parentElement?.parentElement : el;
  let d;
  while (from && (d = from.closest('details:not([open])'))) { d.setAttribute('open', ''); from = d.parentElement; }
};
const ACTIONS = ['fill', 'click', 'dblclick', 'selectOption', 'check', 'uncheck', 'press', 'hover', 'setInputFiles', 'pressSequentially'];
let patched = false;
const patchLocators = (page) => {
  if (patched) return;
  patched = true;
  const proto = Object.getPrototypeOf(page.locator('body'));
  for (const m of ACTIONS) {
    const orig = proto[m];
    if (typeof orig !== 'function') continue;
    proto[m] = async function (...args) { await this.evaluate(openAncestors, undefined, { timeout: 10000 }).catch(() => {}); return orig.apply(this, args); };
  }
};

export const chromium = {
  ...base,
  launch: async (...a) => {
    const browser = await base.launch(...a);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...c) => {
      const ctx = await newContext(...c);
      const newPage = ctx.newPage.bind(ctx);
      ctx.newPage = async (...p) => { const pg = await newPage(...p); patchLocators(pg); return pg; };
      return ctx;
    };
    const newPage = browser.newPage.bind(browser);
    browser.newPage = async (...p) => { const pg = await newPage(...p); patchLocators(pg); return pg; };
    return browser;
  },
};
