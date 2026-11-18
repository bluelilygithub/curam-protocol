'use strict';

// node server/services/pdfToHtml.test.js   (no database, no model: the model is a stub)
// PDF → HTML: only the chosen pages' pictures are extracted, the model is shown pages + pictures, and its answer is cut
// down to one safe HTML document.

const assert = require('assert');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');
const { createHtml, reviseHtml, cleanHtml, usedImageNames, providerReason, modelFailure, contactSheets, SYSTEM, MAX_PAGES } = require('./pdfToHtml');

let PAGE_PNG = ''; // a small valid PNG, made by sharp at the start (a hand-typed one was rejected now and then by libspng)
const PAGE = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>img{max-width:100%;height:auto}</style></head><body><main><h1>Hi</h1><img src="images/image-01.jpg" alt="Blue"></main></body></html>`;

function stubDeps(reply, seen = {}) {
  return {
    resolveModel: async () => ({ modelId: 'claude-test', auto: true, why: 'default' }),
    callModel: async (model, prompt, opts) => {
      Object.assign(seen, { model, prompt, opts });
      return { text: typeof reply === 'function' ? reply(prompt) : reply, inputTokens: 10, outputTokens: 20, model, diagnostics: { stopReason: 'end_turn' } };
    },
    logUsage: (row) => { seen.logged = row; },
  };
}

(async () => {
  PAGE_PNG = `data:image/png;base64,${(await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }).png().toBuffer()).toString('base64')}`;
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
    const dot = Buffer.from('<svg width="20" height="20"><circle cx="10" cy="10" r="9" fill="#fff"/></svg>'); // some detail, so they are not "plain"
    const red = await sharp({ create: { width: 60, height: 40, channels: 3, background: '#cc0000' } }).composite([{ input: dot, left: 5, top: 5 }]).jpeg().toBuffer();
    const blue = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#0033cc' } }).composite([{ input: dot, left: 5, top: 5 }]).jpeg().toBuffer();
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
    down.callModel = async () => { throw Object.assign(new Error('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'), { status: 401 }); };
    await assert.rejects(createHtml('u1', { pdfBuf, pages: [1], pageImages: [PAGE_PNG], pageTexts: [] }, down),
      (e) => e.status === 502 && /rejected Vault's key for claude-test/.test(e.message) && /Reason: 401: invalid x-api-key/.test(e.message));

    // a cut-off answer is reported, not shown
    const cut = stubDeps(PAGE);
    cut.callModel = async () => ({ text: '<html><body>', inputTokens: 1, outputTokens: 1, diagnostics: { stopReason: 'max_tokens' } });
    cut.callModel = async () => ({ text: '<html><body>', inputTokens: 1, outputTokens: 32000, diagnostics: { stopReason: 'max_tokens' } });
    await assert.rejects(createHtml('u1', { pdfBuf, pages: [1], pageImages: [PAGE_PNG], pageTexts: [] }, cut), (e) => /ran out of room/.test(e.message) && /32,000 tokens/.test(e.message) && !/fewer pages\.$/.test(e.message));

    // long answers: streamed, 32,000 tokens of room; a model with a lower limit is retried once at its limit
    const calls = [];
    const older = stubDeps(PAGE);
    older.callModel = async (model, prompt, opts) => {
      calls.push({ maxTokens: opts.maxTokens, stream: opts.stream });
      if (opts.maxTokens > 8192) throw Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: 32000 > 8192, which is the maximum allowed number of output tokens for claude-old"}}'), { status: 400 });
      return { text: PAGE, inputTokens: 1, outputTokens: 1, model, diagnostics: { stopReason: 'end_turn' } };
    };
    await createHtml('u1', { pdfBuf, pages: [1], pageImages: [PAGE_PNG], pageTexts: [] }, older);
    assert.deepStrictEqual(calls, [{ maxTokens: 32000, stream: true }, { maxTokens: 8192, stream: true }]);
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

  // ---- the provider's real reason is shown, in plain words ----
  assert.strictEqual(providerReason(Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"image too big"}}'), { status: 400 })), '400: image too big');
  assert.strictEqual(providerReason(new Error('[GoogleGenerativeAI Error]: Error fetching from https://x: [400 Bad Request] API key not valid.')), '400: API key not valid.');
  assert.match(modelFailure(Object.assign(new Error('529 {"error":{"type":"overloaded_error","message":"Overloaded"}}'), { status: 529 }), 'm1').message, /m1\) is busy right now.*Reason: 529: Overloaded/);
  assert.match(modelFailure(new Error('Model call timed out after 240s (m1)'), 'm1').message, /took too long/);
  assert.match(modelFailure(Object.assign(new Error('404 {"error":{"message":"model: x"}}'), { status: 404 }), 'm1').message, /does not know the model m1/);

  // ---- a tall page arrives as slices; pictures go as labelled contact sheets; never more than 20 pictures in one request ----
  {
    const slice = `data:image/jpeg;base64,${(await sharp({ create: { width: 1400, height: 1440, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()).toString('base64')}`;
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 4400]);
    for (let i = 0; i < 30; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const jpg = await sharp({ create: { width: 900 + i, height: 700, channels: 3, background: { r: i * 8, g: 100, b: 200 } } }).composite([{ input: Buffer.from(`<svg width="40" height="40"><rect width="40" height="40" fill="#fff"/></svg>`), left: 5, top: 5 }]).jpeg().toBuffer();
      // eslint-disable-next-line no-await-in-loop
      page.drawImage(await doc.embedJpg(jpg), { x: 10, y: i * 50, width: 40, height: 30 });
    }
    // not content: a browser-toolbar strip and a plain white layer
    page.drawImage(await doc.embedPng(await sharp({ create: { width: 2040, height: 75, channels: 3, background: '#eeeeee' } }).composite([{ input: Buffer.from('<svg width="300" height="20"><rect width="300" height="20" fill="#c00"/></svg>'), left: 10, top: 20 }]).png().toBuffer()), { x: 0, y: 4300, width: 600, height: 20 });
    page.drawImage(await doc.embedPng(await sharp({ create: { width: 800, height: 450, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0.5 } } }).png().toBuffer()), { x: 0, y: 4000, width: 600, height: 300 });
    const pdfBuf = Buffer.from(await doc.save());

    const slices = Array.from({ length: 8 }, (_, i) => ({ page: 1, part: i + 1, parts: 8 }));
    const seen = {};
    const out = await createHtml('u1', {
      pdfBuf, pages: [1], pageImages: slices.map(() => slice), pageTexts: slices.map((_, i) => `Text of part ${i + 1}`), slices,
    }, stubDeps(PAGE, seen));
    assert.strictEqual(out.images.length, 32, 'every picture is still in the zip');
    const skipped = out.images.filter((im) => im.aiSkip);
    assert.deepStrictEqual(skipped.map((im) => im.aiSkip).sort(), ['plain', 'strip'], 'the strip and the plain layer are marked');
    assert.strictEqual(seen.opts.images.length, 8 + 2, 'eight slices + two contact sheets (30 pictures, 16 a sheet)');
    assert.ok(seen.opts.images.length <= 20);
    for (const im of seen.opts.images) {
      // eslint-disable-next-line no-await-in-loop
      const meta = await sharp(Buffer.from(im.data, 'base64')).metadata();
      assert.ok(Math.max(meta.width, meta.height) <= 1568, `picture ${meta.width}x${meta.height} is within limits`);
      assert.strictEqual(im.mimeType, 'image/jpeg');
    }
    const sheet = await sharp(Buffer.from(seen.opts.images[8].data, 'base64')).metadata();
    assert.deepStrictEqual([sheet.width, sheet.height], [1024, 1024], 'a full sheet is 4 × 4 tiles of 256 px');
    assert.match(seen.prompt, /Picture 1: page 1, part 1 of 8 \(top to bottom\)/);
    assert.match(seen.prompt, /--- Page 1, part 3 of 8 \(picture 3\) ---\nText of part 3/);
    assert.match(seen.prompt, /Picture 9: a contact sheet .*1 = images\/image-01\.jpg/);
    assert.match(seen.prompt, /Picture 10: a contact sheet .*14 = images\/image-30\.jpg/);
    for (const im of skipped) assert.ok(!seen.prompt.includes(`images/${im.name}`), `${im.name} (${im.aiSkip}) is not offered to the model`);
    assert.match(seen.prompt, /Do not invent sections/);

    // a change request also leaves the marked pictures out
    const seen2 = {};
    await reviseHtml('u1', { html: PAGE, instruction: 'bigger logos', images: out.images.map(({ name, width, height, aiSkip }) => ({ name, width, height, aiSkip })), pageImages: [slice] }, stubDeps(PAGE, seen2));
    for (const im of skipped) assert.ok(!seen2.prompt.includes(`images/${im.name}`));
    await assert.rejects(createHtml('u1', { pdfBuf, pages: [1], pageImages: Array(15).fill(slice), pageTexts: [] }, stubDeps(PAGE)), /at most 14/);
  }

  // white logos on a transparent background are visible on the sheet (grey, not white)
  {
    const whiteLogo = await sharp({ create: { width: 200, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from('<svg width="200" height="80"><rect x="20" y="20" width="160" height="40" fill="#fff"/></svg>') }]).png().toBuffer();
    const [sh] = await contactSheets([{ name: 'logo.png', bytes: whiteLogo }], 1);
    const { data, info } = await sharp(Buffer.from(sh.image.data, 'base64')).raw().toBuffer({ resolveWithObject: true });
    const px = (x, y) => data[(y * info.width + x) * info.channels];
    assert.ok(px(10, 60) < 160 && px(128, 128) > 230, 'grey around, white logo visible');
  }

  console.log('pdfToHtml tests passed');
})().catch((err) => { console.error(err); process.exit(1); });
