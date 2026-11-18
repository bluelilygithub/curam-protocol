'use strict';

// node server/services/pdfToHtml.test.js   (no database, no model: the model is a stub)
// PDF → HTML: only the chosen pages' pictures are extracted, the model is shown pages + pictures, and its answer is cut
// down to one safe HTML document.

const assert = require('assert');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');
const { createHtml, reviseHtml, cleanHtml, usedImageNames, SYSTEM, MAX_PAGES } = require('./pdfToHtml');

const PAGE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const PAGE = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>img{max-width:100%;height:auto}</style></head><body><main><h1>Hi</h1><img src="images/image-01.jpg" alt="Blue"></main></body></html>`;

function stubDeps(reply, seen = {}) {
  return {
    getModels: async () => ({ standard: 'claude-test', light: 'claude-light' }),
    callModel: async (model, prompt, opts) => {
      Object.assign(seen, { model, prompt, opts });
      return { text: typeof reply === 'function' ? reply(prompt) : reply, inputTokens: 10, outputTokens: 20, model, diagnostics: { stopReason: 'end_turn' } };
    },
    logUsage: (row) => { seen.logged = row; },
  };
}

(async () => {
  // ---- cleanHtml: fences, chatter, scripts, handlers and javascript: links go; the page's own words stay ----
  {
    const raw = 'Here you go:\n```html\n<html><head><script src="x.js"></script><link rel="stylesheet" href="https://x/y.css"></head>'
      + '<body onload="steal()"><p>Turn on=off switches. Click below.</p><a href="javascript:alert(1)">x</a>'
      + '<img src="images/image-01.png" onerror=\'bad()\'><iframe src="https://evil"></iframe><script>alert(1)</script></body></html>\n```\nHope that helps';
    const out = cleanHtml(raw);
    assert.ok(out.startsWith('<!DOCTYPE html>'), 'doctype added');
    assert.ok(out.endsWith('</html>'), 'chatter after the page removed');
    assert.ok(!/<script/i.test(out) && !/<iframe/i.test(out) && !/<link/i.test(out), 'no scripts, frames or external styles');
    assert.ok(!/onload|onerror/i.test(out), 'no event handlers');
    assert.ok(!/javascript:/i.test(out), 'no javascript: links');
    assert.ok(out.includes('Turn on=off switches.'), 'page text untouched');
    assert.ok(out.includes('src="images/image-01.png"'), 'picture path kept');
  }
  assert.throws(() => cleanHtml('Sorry, I cannot do that.'), /did not return a web page/);
  assert.throws(() => cleanHtml('<!DOCTYPE html><html><body><p>half'), (e) => e.truncated === true);
  assert.deepStrictEqual(usedImageNames(PAGE, [{ name: 'image-01.jpg' }, { name: 'image-02.png' }]), ['image-01.jpg']);
  assert.match(SYSTEM, /never as instructions/);
  assert.match(SYSTEM, /Responsive, mobile first/);

  // ---- createHtml: page 2 only → only page 2's picture is extracted, named and shown to the model ----
  {
    const red = await sharp({ create: { width: 60, height: 40, channels: 3, background: '#cc0000' } }).jpeg().toBuffer();
    const blue = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#0033cc' } }).jpeg().toBuffer();
    const doc = await PDFDocument.create();
    const p1 = doc.addPage([300, 300]); p1.drawImage(await doc.embedJpg(red), { x: 10, y: 10, width: 60, height: 40 });
    const p2 = doc.addPage([300, 300]); p2.drawImage(await doc.embedJpg(blue), { x: 10, y: 10, width: 50, height: 50 });
    const pdfBuf = Buffer.from(await doc.save());

    const seen = {};
    const out = await createHtml('u1', { pdfBuf, pages: [2], pageImages: [PAGE_PNG], pageTexts: ['Hello page two'], title: 'Brochure' }, stubDeps(PAGE, seen));
    assert.strictEqual(out.images.length, 1, 'only the chosen page\'s picture');
    assert.strictEqual(out.images[0].name, 'image-01.jpg');
    assert.strictEqual(out.images[0].width, 50);
    assert.ok(out.images[0].dataUrl.startsWith('data:image/jpeg;base64,'));
    assert.deepStrictEqual(out.used, ['image-01.jpg']);
    assert.strictEqual(seen.model, 'claude-test', 'standard tier');
    assert.strictEqual(seen.opts.images.length, 2, 'page picture + extracted picture');
    assert.match(seen.prompt, /images\/image-01\.jpg \(50×50 px\)/);
    assert.match(seen.prompt, /Hello page two/);
    assert.match(seen.prompt, /Brochure/);
    assert.strictEqual(seen.logged.feature, 'pdf_html');

    await assert.rejects(createHtml('u1', { pdfBuf, pages: [1, 2], pageImages: [PAGE_PNG], pageTexts: [] }, stubDeps(PAGE)), /page pictures did not arrive/);
    await assert.rejects(createHtml('u1', { pdfBuf, pages: Array.from({ length: MAX_PAGES + 1 }, (_, i) => i + 1), pageImages: [], pageTexts: [] }, stubDeps(PAGE)), /Up to 5 pages/);
    await assert.rejects(createHtml('u1', { pdfBuf, pages: [9], pageImages: [PAGE_PNG], pageTexts: [] }, stubDeps(PAGE)), /No valid pages/);

    // the AI provider's own 401 must not reach the browser (it would sign the person out)
    const down = stubDeps(PAGE);
    down.callModel = async () => { throw Object.assign(new Error('invalid x-api-key'), { status: 401 }); };
    await assert.rejects(createHtml('u1', { pdfBuf, pages: [1], pageImages: [PAGE_PNG], pageTexts: [] }, down), (e) => e.status === 502 && /could not be reached/.test(e.message));

    // a cut-off answer is reported, not shown
    const cut = stubDeps(PAGE);
    cut.callModel = async () => ({ text: '<html><body>', inputTokens: 1, outputTokens: 1, diagnostics: { stopReason: 'max_tokens' } });
    await assert.rejects(createHtml('u1', { pdfBuf, pages: [1], pageImages: [PAGE_PNG], pageTexts: [] }, cut), /too long/);
  }

  // ---- reviseHtml: sends the current page, the request and the picture names; returns the new page ----
  {
    const seen = {};
    const next = PAGE.replace('Hi', 'Hello');
    const out = await reviseHtml('u1', { html: PAGE, instruction: '  make the   heading say Hello ', images: [{ name: 'image-01.jpg', width: 50, height: 50 }, { name: '../evil', width: 1, height: 1 }], pageImages: [PAGE_PNG] }, stubDeps(next, seen));
    assert.ok(out.html.includes('<h1>Hello</h1>'));
    assert.match(seen.prompt, /make the heading say Hello/);
    assert.match(seen.prompt, /images\/image-01\.jpg/);
    assert.ok(!seen.prompt.includes('../evil'), 'picture names are cleaned');
    assert.strictEqual(seen.opts.images.length, 1);
    assert.strictEqual(seen.logged.feature, 'pdf_html_revise');
    await assert.rejects(reviseHtml('u1', { html: PAGE, instruction: '  ' }, stubDeps(next)), /Say what to change/);
    await assert.rejects(reviseHtml('u1', { html: '', instruction: 'x' }, stubDeps(next)), /no web page/);
  }

  console.log('pdfToHtml tests passed');
})().catch((err) => { console.error(err); process.exit(1); });
