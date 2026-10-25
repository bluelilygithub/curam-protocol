'use strict';

// Saved recipes and the pipeline they run on. No database: db.js is stubbed and the recipe table is a tiny in-memory fake.
//   node server/routes/graphics/graphicsRecipes.test.js      (npm run test:graphics-recipes)

const assert = require('assert');
const sharp = require('sharp');

const stub = (rel, exports) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('../../db', { pool: { query: async () => ({ rows: [] }) } });

const { runPipeline, PIPELINE_OPS, PIPELINE_MAX_STEPS } = require('./enhance');
const recipes = require('../../services/graphicsRecipes');

const RULES = { ops: PIPELINE_OPS, maxSteps: PIPELINE_MAX_STEPS };
const dataUrl = (buf, type = 'png') => `data:image/${type};base64,${buf.toString('base64')}`;
const solid = (w, h, bg = { r: 200, g: 60, b: 60, alpha: 1 }, channels = 4) => sharp({ create: { width: w, height: h, channels, background: bg } });
const sizeOf = async (url) => sharp(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')).metadata();

(async () => {
  // ── sanitising what the browser sends ────────────────────────────────────────────────
  const ok = recipes.sanitizeRecipe({
    name: '  Web hero  ',
    steps: [{ op: 'crop', aspect: '16:9', strategy: 'attention', junk: 'x' }, { op: 'resize', width: '1600', fit: 'inside' }, { op: 'sharpen', value: 2 }],
    outFormat: 'WEBP', outQuality: 150,
  }, RULES);
  assert.strictEqual(ok.name, 'Web hero');
  assert.deepStrictEqual(ok.steps[0], { op: 'crop', aspect: '16:9', strategy: 'attention' }); // unknown fields dropped
  assert.strictEqual(ok.steps[1].width, 1600);
  assert.strictEqual(ok.outFormat, 'webp');
  assert.strictEqual(ok.outQuality, 100); // clamped
  assert.strictEqual(recipes.sanitizeRecipe({ name: 'p', steps: [{ op: 'blur' }], outFormat: 'png', outQuality: 50 }, RULES).outQuality, null);
  assert.throws(() => recipes.sanitizeRecipe({ name: '', steps: [{ op: 'blur' }] }, RULES), /name/);
  assert.throws(() => recipes.sanitizeRecipe({ name: 'a', steps: [] }, RULES), /at least one step/);
  assert.throws(() => recipes.sanitizeRecipe({ name: 'a', steps: [{ op: 'rm -rf' }] }, RULES), /not a step/);
  assert.throws(() => recipes.sanitizeRecipe({ name: 'a', steps: Array(13).fill({ op: 'blur' }) }, RULES), /at most/);

  // ── save / update / same-name replace / limit, against a fake table ───────────────────
  const table = [];
  let nextId = 1;
  const db = {
    async query(sql, p) {
      if (/^\s*UPDATE graphics_recipes/.test(sql)) {
        const row = table.find((r) => r.id === p[0] && r.userId === p[1]);
        if (!row) return { rows: [] };
        Object.assign(row, { name: p[2], steps: JSON.parse(p[3]), outFormat: p[4], outQuality: p[5] });
        return { rows: [row] };
      }
      if (/SELECT id FROM graphics_recipes/.test(sql)) return { rows: table.filter((r) => r.userId === p[0] && r.name.toLowerCase() === p[1].toLowerCase()).map((r) => ({ id: r.id })) };
      if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: String(table.filter((r) => r.userId === p[0]).length) }] };
      if (/^\s*INSERT INTO graphics_recipes/.test(sql)) {
        const row = { id: nextId++, userId: p[0], name: p[1], steps: JSON.parse(p[2]), outFormat: p[3], outQuality: p[4], updatedAt: new Date() };
        table.push(row);
        return { rows: [row] };
      }
      if (/SELECT \* FROM graphics_recipes WHERE id/.test(sql)) return { rows: table.filter((r) => r.id === p[0] && r.userId === p[1]) };
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
  const a = await recipes.saveRecipe(db, 7, { name: 'Hero', steps: [{ op: 'sharpen', value: 2 }] }, RULES);
  const a2 = await recipes.saveRecipe(db, 7, { name: 'hero', steps: [{ op: 'blur', value: 3 }] }, RULES); // same name: replaced, not duplicated
  assert.strictEqual(a2.id, a.id);
  assert.strictEqual(table.length, 1);
  assert.strictEqual(table[0].steps[0].op, 'blur');
  assert.strictEqual((await recipes.getRecipe(db, 7, a.id)).name, 'hero');
  assert.strictEqual(await recipes.getRecipe(db, 8, a.id), null); // someone else's recipe is not found
  assert.strictEqual(await recipes.getRecipe(db, 7, 'abc'), null);
  await assert.rejects(recipes.saveRecipe(db, 8, { id: a.id, name: 'steal', steps: [{ op: 'blur' }] }, RULES), /not found/);
  for (let i = 0; i < recipes.MAX_RECIPES_PER_USER - 1; i += 1) await recipes.saveRecipe(db, 7, { name: `r${i}`, steps: [{ op: 'blur' }] }, RULES);
  await assert.rejects(recipes.saveRecipe(db, 7, { name: 'one too many', steps: [{ op: 'blur' }] }, RULES), /up to 50/);

  // ── running a recipe ─────────────────────────────────────────────────────────────────
  const wide = dataUrl(await solid(400, 200).png().toBuffer());

  const square = await runPipeline({ imageDataUrl: wide, steps: [{ op: 'crop', aspect: '1:1' }] });
  assert.deepStrictEqual([square.width, square.height], [200, 200]); // cropped to a square at full resolution, not shrunk

  const wide169 = await runPipeline({ imageDataUrl: dataUrl(await solid(300, 300).png().toBuffer()), steps: [{ op: 'crop', aspect: '16:9' }] });
  assert.deepStrictEqual([wide169.width, wide169.height], [300, 169]);

  await assert.rejects(runPipeline({ imageDataUrl: wide, steps: [{ op: 'crop', aspect: 'square' }] }), /shape like/);

  const marked = await runPipeline({ imageDataUrl: wide, steps: [{ op: 'watermark', text: 'Sample', position: 'bottom-right', opacity: 1, color: '#000000' }] });
  assert.deepStrictEqual([marked.width, marked.height], [400, 200]);
  assert.notStrictEqual(marked.imageDataUrl, wide); // the picture changed
  await assert.rejects(runPipeline({ imageDataUrl: wide, steps: [{ op: 'watermark', text: '  ' }] }), /words/);

  // The logo comes from the Brand Kit, by reference. No logo saved = a clear message, not a crash.
  await assert.rejects(runPipeline({ imageDataUrl: wide, steps: [{ op: 'logo' }] }), /Brand Kit/);
  const logo = dataUrl(await solid(60, 60, { r: 0, g: 0, b: 255, alpha: 1 }).png().toBuffer());
  const logged = await runPipeline({ imageDataUrl: wide, steps: [{ op: 'logo', scale: 25, position: 'top-left' }], brandLogoDataUrl: logo });
  assert.deepStrictEqual([logged.width, logged.height], [400, 200]);

  // The whole saved recipe in one go: crop -> resize -> convert to WebP.
  const full = await runPipeline({ imageDataUrl: wide, steps: [{ op: 'crop', aspect: '1:1' }, { op: 'resize', width: 100, fit: 'inside' }], format: 'webp', quality: 70 });
  assert.strictEqual(full.format, 'webp');
  assert.deepStrictEqual([full.width, full.height], [100, 100]);
  assert.strictEqual((await sizeOf(full.imageDataUrl)).format, 'webp');

  // A see-through PNG saved as JPG becomes white, not black.
  const seeThrough = dataUrl(await solid(20, 20, { r: 0, g: 0, b: 0, alpha: 0 }).png().toBuffer());
  const jpg = await runPipeline({ imageDataUrl: seeThrough, steps: [{ op: 'sharpen', value: 1 }], format: 'jpg' });
  const px = await sharp(Buffer.from(jpg.imageDataUrl.slice(jpg.imageDataUrl.indexOf(',') + 1), 'base64')).raw().toBuffer();
  assert.ok(px[0] > 240 && px[1] > 240 && px[2] > 240, 'transparent area should be white in a JPG');

  // Own format is kept when none is asked for; a PDF is refused cleanly.
  assert.strictEqual((await runPipeline({ imageDataUrl: wide, steps: [{ op: 'grayscale' }] })).format, 'png');
  await assert.rejects(runPipeline({ imageDataUrl: 'data:application/pdf;base64,AAAA', steps: [{ op: 'grayscale' }] }), /valid image/);
  await assert.rejects(runPipeline({ imageDataUrl: wide, steps: Array(13).fill({ op: 'grayscale' }) }), /Too many/);

  console.log('graphicsRecipes: ok');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
