'use strict';

// node server/services/restyle/restyleSource.test.js   (npm run test:restyle-source). Laying out HTML and CSS for the "HTML source" tool:
// readable, never changing what the page is, safe on odd input.

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { JSDOM } = require('jsdom');

(async () => {
  const S = await import(pathToFileURL(path.join(__dirname, '../../../client/src/pages/restyle/sourceView.mjs')).href);

  // ---- CSS ----
  const css = '@import url("a;b.css");/* keep; this */body{margin:0;font:12px/1 "A{B}",serif;background:url(data:image/png;base64,AAA=)}@media (max-width:480px){.a,.b{color:red!important}}';
  const out = S.formatCss(css);
  assert.strictEqual(out, [
    '@import url("a;b.css");',
    '/* keep; this */',
    'body {',
    '  margin:0;',
    '  font:12px/1 "A{B}",serif;',
    '  background:url(data:image/png;base64,AAA=)',
    '}',
    '@media (max-width:480px) {',
    '  .a,.b {',
    '    color:red!important',
    '  }',
    '}',
  ].join('\n'));
  assert.strictEqual(S.formatCss(out), out, 'laying it out twice changes nothing');
  assert.strictEqual(S.formatCss(''), '');
  assert.strictEqual(S.formatCss(undefined), '');
  assert.doesNotThrow(() => S.formatCss('a { b: "unterminated'));
  assert.doesNotThrow(() => S.formatCss('}}}{{{'));
  assert.strictEqual(S.formatCss('x'.repeat(S.MAX_FORMAT_CHARS + 1)).length, S.MAX_FORMAT_CHARS + 1, 'text too big to lay out is shown as it is');
  // laid out CSS means the same thing: same rules, same declarations
  const postcss = require('postcss');
  const flat = (c) => { const r = []; postcss.parse(c).walkDecls((d) => r.push(`${d.parent.selector || d.parent.params}|${d.prop}|${d.value}`)); return r; };
  assert.deepStrictEqual(flat(S.formatCss(css)), flat(css));

  // ---- HTML ----
  const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>T &amp; U</title><style>.a{color:red}</style><script>var a = "<b>"; if (a) { go(); }</script></head><body class="x"><!-- note --><div id="a" data-x="1>2"><p>Hello   <b>big</b>  world</p><img src="a.png" alt=""><br><pre>  keep\n   this </pre><ul><li>one</li><li>two</li></ul><input value="a>b"/></div></body></html>';
  const pretty = S.formatHtml(html);
  const lines = pretty.split('\n');
  assert.ok(lines.length > 25, 'one tag per line');
  assert.strictEqual(lines[0], '<!DOCTYPE html>');
  assert.strictEqual(lines[1], '<html lang="en">');
  assert.ok(lines.includes('  <head>') && lines.includes('    <meta charset="utf-8">'), 'children are indented');
  assert.ok(lines.includes('    <title>') && lines.includes('      T &amp; U') && lines.includes('    </title>'), 'text is on its own line, its tags around it');
  assert.ok(lines.includes('      .a {') && lines.includes('        color:red;') === false && lines.includes('        color:red'), 'a <style> block is laid out as CSS');
  assert.ok(lines.some((l) => /^\s+var a = "<b>"; if \(a\) \{ go\(\); \}$/.test(l)), 'a script keeps its contents, even with a tag-like string in it');
  assert.ok(lines.some((l) => l.trim() === '<!-- note -->'), 'comments stay');
  assert.ok(lines.some((l) => l.trim() === '<div id="a" data-x="1>2">'), 'a ">" inside an attribute does not end the tag');
  assert.ok(lines.some((l) => l.trim() === '<img src="a.png" alt="">') && lines.some((l) => l.trim() === '<br>'), 'void tags do not indent what follows');
  assert.ok(pretty.includes('<pre>  keep\n   this </pre>'), '<pre> keeps its spacing');
  assert.ok(lines.some((l) => l.trim() === 'Hello big world') === false && lines.some((l) => l.trim() === 'Hello'), 'text is trimmed and split at tags');
  assert.ok(lines.some((l) => l.trim() === '<input value="a>b"/>'));
  assert.strictEqual(lines[lines.length - 1], '</html>');
  assert.ok(lines.every((l, i) => !/^\s+$/.test(l) || false), 'no blank padding lines');
  // the laid-out page is the same page
  const text = (h) => new JSDOM(h).window.document.body.textContent.replace(/\s+/g, '');
  assert.strictEqual(text(pretty), text(html), 'same words');
  assert.strictEqual(new JSDOM(pretty).window.document.querySelectorAll('*').length, new JSDOM(html).window.document.querySelectorAll('*').length, 'same elements');
  assert.strictEqual(new JSDOM(pretty).window.document.getElementById('a').getAttribute('data-x'), '1>2');
  assert.strictEqual(S.formatHtml(pretty).split('\n').length, lines.length, 'laying it out twice does not grow it');
  assert.strictEqual(S.formatHtml(''), '');
  assert.doesNotThrow(() => S.formatHtml('<div <<< broken <a href="x'));
  assert.doesNotThrow(() => S.formatHtml('</div></div></div>'));
  assert.doesNotThrow(() => S.formatHtml('<script>never closed'));

  // ---- numbered lines and the filter ----
  const text3 = 'alpha\nBeta\ngamma\nbeta again';
  const all = S.sourceLines(text3);
  assert.deepStrictEqual(all.rows.map((r) => r.number), [1, 2, 3, 4]);
  assert.strictEqual(all.total, 4);
  assert.strictEqual(all.truncated, false);
  const filtered = S.sourceLines(text3, { query: 'BETA' });
  assert.deepStrictEqual(filtered.rows, [{ number: 2, text: 'Beta' }, { number: 4, text: 'beta again' }], 'a filter keeps the line numbers of the whole text, and ignores case');
  assert.strictEqual(filtered.matches, 2);
  const big = S.sourceLines(Array.from({ length: 10000 }, (_, i) => `line ${i}`).join('\n'));
  assert.strictEqual(big.rows.length, S.MAX_SHOWN_LINES);
  assert.strictEqual(big.truncated, true);
  assert.strictEqual(big.total, 10000);
  assert.strictEqual(S.sourceLines(Array.from({ length: 10000 }, (_, i) => `line ${i}`).join('\n'), { query: 'line 9999' }).rows[0].number, 10000, 'a match past the cap is still found when filtered');
  assert.deepStrictEqual(S.sourceLines('').rows, [{ number: 1, text: '' }]);

  console.log('restyle source-view tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
