import assert from 'assert';
import { scrapeProgress, wasCancelled } from './scrapeProgress.mjs';

const plain = scrapeProgress('load', { url: 'https://www.example.com/shop' });
assert.strictEqual(plain.title, 'Loading the page from example.com…', 'the site is named without www');
assert.strictEqual(plain.steps[0], 'Asking the website for the page');
assert.strictEqual(plain.steps.at(-1), 'Building the preview');
const browser = scrapeProgress('load', { render: true, url: 'example.com' });
assert.deepStrictEqual(browser.steps.slice(0, 2), ['Opening the page in a browser', 'Waiting for the page to build itself']);
assert.ok(browser.title.includes('example.com'), 'a bare address is named too');
assert.strictEqual(scrapeProgress('css', {}).title, "Reading the page's style files…", 'no address, no name');
assert.strictEqual(scrapeProgress('css', { url: 'not a url at all' }).title.includes('from'), false);
assert.ok(scrapeProgress('exact', { url: 'a.com' }).steps.includes('Copying the pictures in'));
for (const kind of ['load', 'css', 'exact']) {
  const p = scrapeProgress(kind, { url: 'a.com' });
  assert.ok(p.steps.length >= 4 && p.steps.every((s) => s && !/css|selector|DOM/i.test(s.replace('style files', ''))), `${kind}: plain words, several steps`);
  assert.ok(p.detail.length > 20);
}
assert.ok(scrapeProgress('anything').steps.length >= 1);
assert.strictEqual(wasCancelled(Object.assign(new Error('x'), { name: 'AbortError' })), true);
assert.strictEqual(wasCancelled(new Error('The user aborted a request.')), true);
assert.strictEqual(wasCancelled(new Error('Server returned 403')), false);
assert.strictEqual(wasCancelled(null), false);
console.log('scrapeProgress tests passed');
