'use strict';
// node server/services/htmlContentCheck/lib.test.js
// The bundled reader loads and reads a page, and jsdom runs nothing and loads nothing: a hostile page that names scripts, styles,
// pictures, frames, objects, media and a refresh on a local server must cause no request to it, and its inline script and event
// handlers must not run. Also: the boot check passes, and fails (with a message) when the bundle cannot be loaded.
const assert = require('node:assert/strict');
const http = require('http');
const lib = require('./lib');

(async () => {
  const hits = [];
  const server = http.createServer((req, res) => { hits.push(req.url); res.end('alert(1)'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const at = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(lib.check(), null, 'the boot check passes');

    const hostile = `<!doctype html><html><head>
      <link rel="stylesheet" href="${at}/style.css"><link rel="preload" href="${at}/preload.js" as="script">
      <style>@import url("${at}/import.css"); body { background: url("${at}/bg.png") }</style>
      <script src="${at}/external.js"></script>
      <script>globalThis.__hccRan = 'inline';</script>
      <meta http-equiv="refresh" content="0; url=${at}/refresh">
      </head><body onload="globalThis.__hccRan = 'onload'">
      <p>A page that tries everything to make the reader load or run something.</p>
      <img src="${at}/pic.png" onerror="globalThis.__hccRan = 'onerror'" alt="pic">
      <iframe src="${at}/frame"></iframe><object data="${at}/object"></object><embed src="${at}/embed">
      <video src="${at}/video.mp4" poster="${at}/poster.png"></video><audio src="${at}/audio.mp3"></audio>
      <img srcset="${at}/a.png 1x, ${at}/b.png 2x" alt="set"><input type="image" src="${at}/input.png">
      <svg><image href="${at}/svg.png"/></svg><div style="background:url('${at}/inline.png')">x</div>
      </body></html>`;
    const x = lib.extractFull(hostile, 'https://example.com/');
    assert.ok(x.blocks.some((b) => /tries everything/.test(b.text)), 'the text is read');
    await new Promise((r) => setTimeout(r, 800)); // anything asynchronous would have reached the server by now
    assert.deepEqual(hits, [], `no request was made: ${hits.join(', ')}`);
    assert.equal(globalThis.__hccRan, undefined, 'no script or handler ran');
    assert.equal(globalThis.DOMParser, undefined, 'the global DOMParser is put back');

    // a broken bundle is reported, not thrown
    const builder = require('../../../scripts/buildHtmlContentCheckLib');
    const realOut = builder.OUT;
    const realEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production'; // no rebuild on the way
    builder.OUT = `${realOut}.missing`;
    lib._reset();
    try {
      assert.match(lib.check() || '', /Cannot find module/, 'a missing bundle is reported');
    } finally {
      builder.OUT = realOut; lib._reset();
      if (realEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = realEnv;
    }
    assert.equal(lib.check(), null, 'and works again once it is there');
    console.log(`lib.test.js: passed (Node ${process.version})`);
  } finally {
    server.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
