'use strict';

// node server/services/pdfVoiceCommand.test.js   (npm run test:pdf-voice). No model is called: a fake stands in for it.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { TOOL_SCHEMAS, SYSTEM, interpretPdfVoiceCommand, clean } = require('./pdfVoiceCommand');

// ---- every tool with a voice box has a schema, and none of them can take a password ----
const ids = Object.keys(TOOL_SCHEMAS);
assert.ok(ids.length >= 12);
for (const banned of ['protect', 'unprotect', 'sign', 'fill']) assert.ok(!ids.includes(banned), `${banned} has no voice box`);
for (const id of ids) assert.ok(!/password/i.test(JSON.stringify(TOOL_SCHEMAS[id])), `${id} never asks for a password`);
assert.match(SYSTEM, /Never invent values/);

// the client has an example and a place to put the values for each of them
const bar = fs.readFileSync(path.join(__dirname, '../../client/src/pages/pdf/PdfVoice.jsx'), 'utf8');
for (const id of ids) assert.ok(new RegExp(`\\b${id}:`).test(bar), `PdfVoice.jsx has an example for ${id}`);

// ---- values are clamped, typed and filtered by the schema ----
assert.deepStrictEqual(clean('watermark', { text: ' DRAFT  copy ', fontSize: 9999, opacityPercent: 3, angle: 45.4, color: '#ff0000', evil: 'x' }),
  { text: 'DRAFT copy', fontSize: 200, opacityPercent: 5, angle: 45, color: '#FF0000' }, 'clamped, trimmed, unknown keys dropped');
assert.deepStrictEqual(clean('watermark', { color: 'red', fontSize: 'big', text: '' }), {}, 'unusable values are dropped, not guessed');
assert.deepStrictEqual(clean('rotate', { angle: '180', pages: ' 1-3, 5 ' }), { angle: 180, pages: '1-3,5' }, 'a typed number matches the numeric option; ranges are tidied');
assert.deepStrictEqual(clean('rotate', { angle: 45, pages: '1-3; drop table' }), {}, 'a bad angle and a range with other characters are refused');
assert.deepStrictEqual(clean('split', { pages: 'ALL' }), { pages: 'all' });
assert.deepStrictEqual(clean('nup', { perSheet: '4', sheet: 'letter', border: 'false', gapMm: 50 }), { perSheet: 4, sheet: 'Letter', border: false, gapMm: 20 });
assert.deepStrictEqual(clean('pagenumbers', { format: 'Page-Of', position: 'top-right', startAt: 0 }), { format: 'page-of', position: 'top-right', startAt: 1 });
assert.deepStrictEqual(clean('compress', { recompressImages: true, quality: 'LOW' }), { recompressImages: true, quality: 'low' });
assert.deepStrictEqual(clean('unknown-tool', { a: 1 }), {});

// ---- the model path ----
(async () => {
  let seen = null; let logged = null;
  const deps = {
    getModels: async () => ({ light: 'light-model', standard: 'standard-model' }),
    callModel: async (model, prompt, opts) => { seen = { model, prompt, system: opts.system }; return { text: '```json\n{"values":{"text":"CONFIDENTIAL","opacityPercent":30,"angle":45,"fontSize":"72","bogus":1}}\n```', model, inputTokens: 5, outputTokens: 6 }; },
    logUsage: (u) => { logged = u; },
  };
  const out = await interpretPdfVoiceCommand(9, { tool: 'watermark', transcript: '  put   CONFIDENTIAL on it, faint, diagonal  ' }, deps);
  assert.deepStrictEqual(out.values, { text: 'CONFIDENTIAL', opacityPercent: 30, angle: 45, fontSize: 72 });
  assert.strictEqual(out.heard, 'put CONFIDENTIAL on it, faint, diagonal');
  assert.ok(out.applied.length === 4 && out.applied.some((a) => /CONFIDENTIAL/.test(a)));
  assert.strictEqual(seen.model, 'light-model', 'the model comes from Settings (light tier)');
  assert.match(seen.prompt, /Tool: Watermark/);
  assert.match(seen.prompt, /opacityPercent/);
  assert.deepStrictEqual({ u: logged.userId, f: logged.feature }, { u: 9, f: 'pdf_voice' });

  // a model that answers with nonsense changes nothing
  const junk = await interpretPdfVoiceCommand(9, { tool: 'crop', transcript: 'trim a bit' }, { ...deps, callModel: async () => ({ text: 'Sure! I would trim 5mm.', model: 'm' }) });
  assert.deepStrictEqual(junk.values, {});
  assert.deepStrictEqual(junk.applied, []);
  // values not wrapped in {"values": ...} still work
  const bare = await interpretPdfVoiceCommand(9, { tool: 'crop', transcript: 'x' }, { ...deps, callModel: async () => ({ text: '{"topMm": 10, "leftMm": "15"}', model: 'm' }) });
  assert.deepStrictEqual(bare.values, { topMm: 10, leftMm: 15 });

  await assert.rejects(interpretPdfVoiceCommand(9, { tool: 'protect', transcript: 'password hunter2' }, deps), /Unknown tool/, 'Password Protect is not available by voice');
  await assert.rejects(interpretPdfVoiceCommand(9, { tool: 'crop', transcript: '   ' }, deps), /Nothing heard/);
  await assert.rejects(interpretPdfVoiceCommand(9, { tool: 'crop', transcript: 'x' }, { ...deps, getModels: async () => ({}) }), /No AI model/);

  console.log('pdfVoiceCommand tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
