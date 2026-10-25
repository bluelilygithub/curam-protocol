// node client/src/pages/graphics/toolCount.test.mjs   (npm run test:graphics-count)
// The number of Graphics tools is stated in a few places. The page now counts them itself (MODES.length); this checks that the list, the
// registry, the groups and the numbers written in docs/graphics-tools.md all agree, so adding a tool without updating them fails here.
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, ...p), 'utf8');
const page = read('..', 'GraphicsPage.jsx');
const registry = read('toolRegistry.js');
const docs = read('..', '..', '..', '..', 'docs', 'graphics-tools.md');

const block = (src, start) => src.slice(src.indexOf(start), src.indexOf('];', src.indexOf(start)));
const modeIds = [...block(page, 'const MODES = [').matchAll(/id: '([a-z0-9]+)'/g)].map((m) => m[1]);
const registered = [...registry.matchAll(/^\s{2}([a-z0-9]+): lazy/gm)].map((m) => m[1]);
const grouped = [...block(page, 'const MODE_GROUPS = [').matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]);
const n = modeIds.length;

assert.ok(n > 30, 'could not read MODES');
assert.strictEqual(new Set(modeIds).size, n, 'a tool id appears twice in MODES');
assert.deepStrictEqual([...registered].sort(), [...modeIds].sort(), 'MODES and toolRegistry.js list different tools');
assert.deepStrictEqual([...grouped].sort(), [...modeIds].sort(), 'MODE_GROUPS and MODES list different tools (a tool is in no group, or in two)');

// the "How Graphics Works" box counts for itself; it must not go back to a typed number
assert.ok(page.includes('{MODES.length} tools across seven groups'), 'the info box should use {MODES.length}');

// the docs say the number in words once and in digits twice
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const inWords = (x) => (x < 20 ? WORDS[x] : `${TENS[Math.floor(x / 10)]}${x % 10 ? `-${WORDS[x % 10]}` : ''}`);
for (const [label, needle] of [
  ['the opening line', `It bundles ${inWords(n)} tools`],
  ['the frontend paragraph', `Each of the ${n} tools is its own file`],
  ['the tooltips paragraph', `over 300 controls across all ${n} tools`],
]) assert.ok(docs.includes(needle), `docs/graphics-tools.md (${label}) should say "${needle}": update the number there`);

console.log(`graphics tool count: ok (${n} tools)`);
