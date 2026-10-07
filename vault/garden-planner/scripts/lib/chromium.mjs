// `chromium` for the e2e scripts, with one change: Inspector blocks are an accordion (one open at a time), so before a test types into or
// clicks a control, open the closed block that holds it. A block's own heading button is left alone (it is the toggle).
import { chromium as base } from 'playwright-core';

const openBlock = (el) => {
  if (!el.closest('.gp-collapse')) return;
  el.closest('.gp-section.collapsed')?.querySelector('.gp-section-toggle')?.click();
};
const ACTIONS = ['fill', 'click', 'dblclick', 'selectOption', 'check', 'uncheck', 'press', 'hover', 'setInputFiles', 'pressSequentially'];
let patched = false;
const patchLocators = (page) => {
  if (patched) return;
  patched = true;
  const proto = Object.getPrototypeOf(page.locator('body'));
  const pageProto = Object.getPrototypeOf(page);
  for (const m of ['click', 'dblclick', 'fill', 'selectOption', 'check', 'uncheck', 'press', 'hover']) {
    const orig = pageProto[m];
    if (typeof orig !== 'function') continue;
    pageProto[m] = async function (selector, ...args) { if (typeof selector === 'string') await this.locator(selector).first().evaluate(openBlock, undefined, { timeout: 10000 }).catch(() => {}); return orig.call(this, selector, ...args); };
  }
  for (const m of ACTIONS) {
    const orig = proto[m];
    if (typeof orig !== 'function') continue;
    proto[m] = async function (...args) { await this.evaluate(openBlock, undefined, { timeout: 10000 }).catch(() => {}); return orig.apply(this, args); };
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
