'use strict';

// Loads the bundled DocCompare reader (dist/html-content-check-lib/index.cjs, made by scripts/buildHtmlContentCheckLib.js) and runs it
// under jsdom. Outside production a missing or stale bundle is rebuilt first, so local dev and tests always use the current reader.
//
// jsdom is used ONLY for its DOMParser, with jsdom's defaults left on purpose: no `runScripts` (scripts never run) and no `resources`
// (nothing a page names is ever fetched: no images, styles, scripts or frames). A DOMParser document has no browsing context either.
// Tested in lib.test.js against a local server that must receive no request.

const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const builder = require('../../../../scripts/buildHtmlContentCheckLib');

let lib = null;
let win = null;

function load() {
  if (lib) return lib;
  if (process.env.NODE_ENV !== 'production' && builder.isStale()) builder.build();
  lib = require(builder.OUT);
  return lib;
}

function domParser() {
  // a silent console: a broken page's parse errors are not Vault's log lines
  if (!win) win = new JSDOM('<!doctype html><html><body></body></html>', { virtualConsole: new VirtualConsole() }).window;
  return win.DOMParser;
}

/** The reader in full mode: { blocks, method, url, title, author, published, modified, generator }. Synchronous. */
function extractFull(html, baseUrl) {
  const l = load();
  const prev = globalThis.DOMParser;
  globalThis.DOMParser = domParser(); // the reader calls `new DOMParser()`; extract is synchronous, so nothing else runs meanwhile
  try {
    return l.extract(html, { mode: 'full', baseUrl });
  } finally {
    if (prev === undefined) delete globalThis.DOMParser; else globalThis.DOMParser = prev;
  }
}

const decodeHtml = (bytes) => load().decodeHtml(bytes);
const countWords = (s) => load().countWords(s);
const thinWords = () => load().THIN_WORDS;

/** Is the reader usable? Loads it and reads a tiny page. Returns null when fine, else the error message. */
function check() {
  try {
    const x = extractFull('<html><body><nav><a href="/a">Menu</a></nav><p>Hello there</p></body></html>', 'https://example.com/');
    if (!x.blocks.some((b) => b.text === 'Hello there')) return 'the reader returned nothing for a test page';
    return null;
  } catch (err) {
    return err.message;
  }
}

/** On boot: a missing or broken bundle files a Suggestions-inbox alert for the admin, so it is noticed before someone needs the tool. */
async function bootCheck() {
  const problem = check();
  if (!problem) return true;
  const { getLogger } = require('../../../middleware/requestContext');
  getLogger().error({ problem }, '[html-content-check] reader bundle unusable');
  const { capture, makeFingerprint, getPrimaryAdminUserId } = require('../../SuggestionService');
  const adminId = await getPrimaryAdminUserId();
  if (adminId) {
    await capture({
      userId: adminId, source: 'html-content-check', category: 'alert',
      fingerprint: makeFingerprint('html-content-check', 'reader-bundle'),
      title: 'HTML Content Check cannot read pages',
      body: `The bundled page reader (${path.relative(path.join(__dirname, '../../../..'), builder.OUT)}) is missing or broken: ${problem}. Pages cannot be fetched until it is rebuilt. Check the build log for "[html-content-check]" and run node scripts/buildHtmlContentCheckLib.js.`,
      context: 'server boot / server/services/htmlContentCheck/lib',
    });
  }
  return false;
}

module.exports = { extractFull, decodeHtml, countWords, thinWords, check, bootCheck, _reset: () => { lib = null; } };
