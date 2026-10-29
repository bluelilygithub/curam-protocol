import { describe, expect, it } from 'vitest';
import { classifyText, guessLanguage, normalizeHex } from '../src/lib/classify';
import { detectTable, parseDelimited } from '../src/lib/csv';
import { htmlPreviewDocument, sanitizeHtml, sanitizeSvg } from '../src/lib/sanitize';
import { escapeHtml, highlightCode } from '../src/lib/highlight';
import { scrollToReveal, windowFor } from '../src/lib/virtual';
import { countByFilter, describeClip, matchesFilter } from '../src/lib/describe';
import { hotkeyFromEvent, hotkeyProblem } from '../src/lib/hotkey';
import { clampRetention, normalizeAppName, normalizeBaseUrl, visibleActions, DEFAULT_SETTINGS } from '../src/lib/settings';
import { formatBytes, timeAgo } from '../src/lib/time';
import type { ClipMeta, VerifyResult } from '../src/bridge/types';

describe('classifyText', () => {
  it('finds hex colours in every length and normalises them', () => {
    expect(classifyText('#fff')).toMatchObject({ type: 'color', color: '#ffffff' });
    expect(classifyText('  #1A2b3C  ')).toMatchObject({ type: 'color', color: '#1a2b3c' });
    expect(classifyText('#11223380')).toMatchObject({ type: 'color', color: '#11223380' });
    expect(normalizeHex('#abcd')).toBe('#aabbccdd');
  });
  it('does not treat other hash text as a colour', () => {
    for (const t of ['#12345', '#ggg', '#hashtag', 'colour #fff here', '#1234567']) expect(classifyText(t).type).not.toBe('color');
  });
  it('finds links, with or without a scheme, and only a single bare address', () => {
    expect(classifyText('https://example.com/a?b=1')).toMatchObject({ type: 'link' });
    expect(classifyText('www.example.com.au/page')).toMatchObject({ type: 'link', url: 'https://www.example.com.au/page' });
    expect(classifyText('see https://example.com now').type).not.toBe('link');
    expect(classifyText('https://example.com\nhttps://other.com').type).not.toBe('link');
    expect(classifyText('https://nodot').type).not.toBe('link');
  });
  it('finds code by language and never calls a plain sentence code', () => {
    expect(classifyText('{"a": 1, "b": [1,2]}')).toMatchObject({ type: 'code', language: 'json' });
    expect(classifyText('SELECT id, name FROM users WHERE id = 3')).toMatchObject({ type: 'code', language: 'sql' });
    expect(classifyText('def add(a, b):\n    return a + b\n\nprint(add(1, 2))')).toMatchObject({ type: 'code', language: 'python' });
    expect(classifyText('const add = (a, b) => {\n  return a + b;\n};\nconsole.log(add(1, 2));')).toMatchObject({ type: 'code', language: 'javascript' });
    expect(classifyText('interface User { id: number }\nconst u: User = { id: 1 };\nexport default u;')).toMatchObject({ type: 'code', language: 'typescript' });
    expect(classifyText('.card {\n  color: red;\n  padding: 4px;\n}')).toMatchObject({ type: 'code', language: 'css' });
    expect(classifyText('<div class="a"><p>Hi</p></div>')).toMatchObject({ type: 'code', language: 'xml' });
    for (const t of ['Meeting moved to Tuesday, please confirm.', 'I will select the best option from the list.', 'Remember to update the report.', 'hello']) {
      expect(classifyText(t).type).toBe('text');
    }
  });
  it('finds tables: CSV, TSV, semicolon, pipe and markdown', () => {
    expect(classifyText('name,qty\nbolt,4\nnut,9')).toMatchObject({ type: 'table', table: { delimiter: ',' } });
    expect(classifyText('a\tb\tc\n1\t2\t3')).toMatchObject({ type: 'table', table: { delimiter: '\t' } });
    expect(classifyText('a;b\n1;2')).toMatchObject({ type: 'table', table: { delimiter: ';' } });
    const md = classifyText('| Item | Qty |\n|------|-----|\n| Bolt | 4 |\n| Nut | 9 |');
    expect(md.type).toBe('table');
    expect(md.table?.rows).toEqual([['Item', 'Qty'], ['Bolt', '4'], ['Nut', '9']]);
  });
  it('does not turn prose with commas into a table', () => {
    expect(classifyText('Dear John,\nThanks, bye').type).toBe('text');
    expect(classifyText('First, we went home.\nThen, we slept.').type).toBe('text');
    expect(classifyText('one line, with a comma').type).toBe('text');
  });
  it('ignores a half-read last row of a cut-off preview', () => {
    expect(classifyText('a,b\n1,2\n3', true).type).toBe('table');
    expect(classifyText('a,b\n1,2\n3', false).type).toBe('text');
  });
  it('treats empty text as text', () => { expect(classifyText('   ').type).toBe('text'); });
});

describe('guessLanguage', () => {
  it('needs real evidence', () => {
    expect(guessLanguage('short')).toBeNull();
    expect(guessLanguage('Just a normal paragraph of text, with some words in it.')).toBeNull();
    expect(guessLanguage('[1, 2, 3]')).toBe('json');
    expect(guessLanguage('[not json')).toBeNull();
  });
});

describe('parseDelimited / detectTable', () => {
  it('handles quotes, doubled quotes, embedded delimiters and newlines, and CRLF', () => {
    expect(parseDelimited('a,"b, c","say ""hi"""\r\n1,2,3', ',')).toEqual([['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
    expect(parseDelimited('a,"line1\nline2"\nx,y', ',')).toEqual([['a', 'line1\nline2'], ['x', 'y']]);
  });
  it('keeps a trailing empty cell and stops at the row cap', () => {
    expect(parseDelimited('a,b,\n1,2,3', ',')).toEqual([['a', 'b', ''], ['1', '2', '3']]);
    const many = Array.from({ length: 500 }, (_, i) => `${i},x`).join('\n');
    expect(parseDelimited(many, ',').length).toBe(200);
  });
  it('rejects ragged or oversized or mostly empty grids', () => {
    expect(detectTable('a,b\n1,2,3')).toBeNull();
    expect(detectTable('a,b\n,\n,')).toBeNull();
    expect(detectTable(`a,b\n${'x'.repeat(200)},y`)).toBeNull();
    expect(detectTable('only one line, two cells')).toBeNull();
  });
});

describe('sanitizeSvg', () => {
  const dirty = `<svg viewBox="0 0 10 10" onload="alert(1)" width="100">
    <script>alert('x')</script>
    <rect width="5" height="5" fill="red" onclick="evil()" style="fill:blue"/>
    <foreignObject><iframe src="https://evil.example"></iframe><body onload="x()"></body></foreignObject>
    <a href="javascript:alert(1)"><circle r="2" /></a>
    <use href="https://evil.example/x.svg#a"/>
    <image href="https://evil.example/track.png"/>
    <animate attributeName="href" values="javascript:alert(1)"/>
    <set attributeName="onmouseover" to="alert(1)"/>
    <style>@import url(https://evil.example/x.css);</style>
    <rect style="fill:url(https://evil.example/f)" width="1" height="1"/>
  </svg>`;
  it('removes script, handlers, embedded pages, outside references and animation, and keeps the drawing', () => {
    const out = sanitizeSvg(dirty) as string;
    expect(out).toBeTruthy();
    for (const bad of ['<script', 'alert', 'onload', 'onclick', 'foreignObject', 'iframe', 'javascript:', 'evil.example', 'onmouseover', '<animate', '<set', '<style', '<use', '<image', 'url(']) {
      expect(out.toLowerCase()).not.toContain(bad.toLowerCase());
    }
    expect(out).toContain('<rect');
    expect(out).toContain('fill="red"');
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out.toLowerCase()).toContain('viewbox="0 0 10 10"');
  });
  it('returns null for something that is not a drawing, or is only script', () => {
    expect(sanitizeSvg('<script>alert(1)</script>')).toBeNull();
    expect(sanitizeSvg('just text')).toBeNull();
    expect(sanitizeSvg('')).toBeNull();
  });
  it('keeps an existing namespace and harmless inline style', () => {
    const out = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2" style="fill:#00f;stroke:#000"/></svg>') as string;
    expect(out.match(/xmlns=/g)?.length).toBe(1);
    expect(out).toContain('fill:#00f');
  });
});

describe('sanitizeHtml', () => {
  it('removes script, handlers, frames, forms, links and remote pictures; keeps ordinary formatting and inline pictures', () => {
    const dirty = `<h1 onclick="x()">Title</h1><p>Hello <b>world</b> <a href="https://evil.example">link</a></p>
      <script>alert(1)</script><iframe src="https://evil.example"></iframe><form action="https://evil.example"><input name="p"><button>go</button></form>
      <img src="https://evil.example/pixel.png" onerror="alert(1)"><img src="data:image/png;base64,iVBORw0KGgo=" alt="ok">
      <svg><script>alert(1)</script></svg><object data="x"></object><style>body{background:url(https://evil.example/b)}</style>
      <div style="background:url(https://evil.example/c)">x</div><div style="color:red">y</div>`;
    const out = sanitizeHtml(dirty);
    for (const bad of ['<script', 'alert', 'onclick', 'onerror', 'iframe', '<form', '<input', '<button', 'href', 'evil.example', '<svg', '<object']) {
      expect(out.toLowerCase()).not.toContain(bad.toLowerCase());
    }
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<b>world</b>');
    expect(out).toContain('data:image/png;base64,iVBORw0KGgo=');
    expect(out).toContain('color:red');
  });
  it('wraps clean HTML in a page that blocks all network', () => {
    const doc = htmlPreviewDocument('<p>x</p>');
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain('<p>x</p>');
    expect(doc).not.toContain('<script');
  });
});

describe('highlightCode', () => {
  it('colours known languages, escapes everything, and leaves long or unknown text plain', () => {
    const html = highlightCode('const a = "<b>";', 'javascript');
    expect(html).toContain('hljs-');
    expect(html).not.toContain('<b>');
    expect(highlightCode('<script>alert(1)</script>', undefined)).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(highlightCode('x'.repeat(30000), 'javascript')).toBe('x'.repeat(30000));
    expect(escapeHtml('a&b"c')).toBe('a&amp;b&quot;c');
  });
});

describe('windowing', () => {
  it('renders only the cards in view plus a margin', () => {
    const w = windowFor({ scroll: 0, viewport: 600, itemSize: 180, gap: 10, count: 100, overscan: 1 });
    expect(w.start).toBe(0);
    expect(w.end).toBeLessThanOrEqual(6);
    expect(w.total).toBe(100 * 190 - 10);
    const mid = windowFor({ scroll: 9500, viewport: 600, itemSize: 180, gap: 10, count: 100, overscan: 1 });
    expect(mid.start).toBe(49);
    expect(mid.end - mid.start).toBeLessThan(10);
  });
  it('handles empty, short and past-the-end lists', () => {
    expect(windowFor({ scroll: 0, viewport: 600, itemSize: 180, gap: 10, count: 0 })).toMatchObject({ start: 0, end: 0, total: 0 });
    expect(windowFor({ scroll: 0, viewport: 600, itemSize: 180, gap: 10, count: 2 }).end).toBe(2);
    const past = windowFor({ scroll: 99999, viewport: 600, itemSize: 180, gap: 10, count: 5 });
    expect(past.start).toBeLessThanOrEqual(past.end);
    expect(past.end).toBe(5);
  });
  it('scrolls the least needed to reveal a card', () => {
    expect(scrollToReveal(0, 0, 600, 180, 10)).toBe(0);
    expect(scrollToReveal(2, 0, 600, 180, 10)).toBe(0);
    expect(scrollToReveal(5, 0, 600, 180, 10)).toBe(5 * 190 + 180 - 600);
    expect(scrollToReveal(1, 500, 600, 180, 10)).toBe(190);
  });
});

const clip = (over: Partial<ClipMeta>): ClipMeta => ({ id: 'x', kind: 'text', createdAt: 0, sourceApp: null, sizeBytes: 1, preview: 'hi', truncated: false, masked: false, ...over });

describe('describeClip and filters', () => {
  it('puts each clip in the chip a person would look under', () => {
    const items = [
      clip({ preview: 'hello there' }),
      clip({ preview: 'https://example.com' }),
      clip({ preview: 'a,b\n1,2' }),
      clip({ preview: '#ff0000' }),
      clip({ kind: 'image', preview: '' }),
      clip({ kind: 'svg', preview: '<svg/>' }),
      clip({ kind: 'html', preview: '<p>x</p>' }),
    ].map(describeClip);
    expect(items.map((d) => d.category)).toEqual(['text', 'links', 'tables', 'text', 'images', 'images', 'text']);
    expect(countByFilter(items)).toEqual({ all: 7, text: 3, images: 2, links: 1, tables: 1 });
    expect(items.filter((d) => matchesFilter(d, 'images')).length).toBe(2);
    expect(items.filter((d) => matchesFilter(d, 'all')).length).toBe(7);
  });
});

describe('hotkeys', () => {
  const press = (o: Partial<{ key: string; code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }>) => ({ key: '', code: '', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o });
  it('records a combination in a fixed order', () => {
    expect(hotkeyFromEvent(press({ key: ' ', code: 'Space', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+Space');
    expect(hotkeyFromEvent(press({ key: 'V', code: 'KeyV', ctrlKey: true, altKey: true, shiftKey: true, metaKey: true }))).toBe('Ctrl+Alt+Shift+Win+V');
    expect(hotkeyFromEvent(press({ key: 'F9', code: 'F9' }))).toBe('F9');
    expect(hotkeyFromEvent(press({ key: '1', code: 'Digit1', altKey: true }))).toBe('Alt+1');
  });
  it('waits while only modifiers are held, and ignores keys that differ between keyboards', () => {
    expect(hotkeyFromEvent(press({ key: 'Control', ctrlKey: true }))).toBeNull();
    expect(hotkeyFromEvent(press({ key: 'Shift', shiftKey: true }))).toBeNull();
    expect(hotkeyFromEvent(press({ key: ';', code: 'Semicolon', ctrlKey: true }))).toBeNull();
  });
  it('rejects bare letters, shift-only, reserved and malformed combinations', () => {
    expect(hotkeyProblem('Ctrl+Shift+Space')).toBeNull();
    expect(hotkeyProblem('F9')).toBeNull();
    expect(hotkeyProblem('Alt+1')).toBeNull();
    expect(hotkeyProblem('A')).toBe('no-modifier');
    expect(hotkeyProblem('Shift+A')).toBe('no-modifier');
    expect(hotkeyProblem('Ctrl+C')).toBe('reserved');
    expect(hotkeyProblem('Ctrl+V')).toBe('reserved');
    expect(hotkeyProblem('ctrl+v')).toBe('bad'); // the recorder always writes "Ctrl+V"; anything else is not a saved shortcut
    expect(hotkeyProblem('Ctrl+Ctrl+X')).toBe('bad');
    expect(hotkeyProblem('Super+X')).toBe('bad');
    expect(hotkeyProblem('')).toBe('bad');
  });
});

describe('settings rules', () => {
  it('accepts an https address and keeps only its origin', () => {
    expect(normalizeBaseUrl('https://my-app.up.railway.app/settings?x=1#y')).toEqual({ ok: true, url: 'https://my-app.up.railway.app' });
    expect(normalizeBaseUrl('my-app.up.railway.app')).toEqual({ ok: true, url: 'https://my-app.up.railway.app' });
    expect(normalizeBaseUrl('  https://x.example.com:8443/  ')).toEqual({ ok: true, url: 'https://x.example.com:8443' });
  });
  it('refuses http for a remote server, logins in the address, odd schemes and nonsense; allows http only on this PC', () => {
    for (const bad of ['http://my-app.example.com', 'https://user:pw@my-app.example.com', 'ftp://x.example.com', 'javascript:alert(1)', 'not a url', '', 'https://nodot']) {
      expect(normalizeBaseUrl(bad).ok).toBe(false);
    }
    expect(normalizeBaseUrl('http://localhost:3001')).toEqual({ ok: true, url: 'http://localhost:3001' });
    expect(normalizeBaseUrl('http://127.0.0.1:3001')).toEqual({ ok: true, url: 'http://127.0.0.1:3001' });
  });
  it('tidies program names and refuses paths', () => {
    expect(normalizeAppName('KeePass.exe')).toBe('keepass.exe');
    expect(normalizeAppName(' 1Password ')).toBe('1password.exe');
    for (const bad of ['C:\\Program Files\\x.exe', '..\\x.exe', 'a/b.exe', '', '.exe', 'x..exe']) expect(normalizeAppName(bad)).toBeNull();
  });
  it('keeps the history size inside 10 to 200', () => {
    expect([clampRetention(5), clampRetention(10), clampRetention(100), clampRetention(500), clampRetention(NaN)]).toEqual([10, 10, 100, 200, 100]);
  });
  const ok: VerifyResult = { ok: true, scopes: ['notes:write', 'redact:check'], unavailable: [{ scope: 'finance:write', reason: 'Finance is switched off for your account.' }] };
  it('shows only the buttons switched on, and greys the ones the key cannot do, with the reason', () => {
    const s = { ...DEFAULT_SETTINGS, hasKey: true, actions: { finance: true, notes: true, redact: false, crm: true } };
    const a = visibleActions(s, ok);
    expect(a.map((x) => x.id)).toEqual(['finance', 'notes', 'crm']);
    expect(a.find((x) => x.id === 'notes')?.enabled).toBe(true);
    expect(a.find((x) => x.id === 'finance')).toMatchObject({ enabled: false, reason: 'Finance is switched off for your account.' });
    expect(a.find((x) => x.id === 'crm')).toMatchObject({ enabled: false });
    expect(a.find((x) => x.id === 'crm')?.reason).toBeTruthy();
  });
  it('greys everything when there is no key, no answer yet, or a refused key', () => {
    const s = { ...DEFAULT_SETTINGS, hasKey: true };
    expect(visibleActions({ ...s, hasKey: false }, ok).every((x) => !x.enabled && /Settings/.test(x.reason ?? ''))).toBe(true);
    expect(visibleActions(s, null).every((x) => !x.enabled)).toBe(true);
    expect(visibleActions(s, { ok: false, scopes: [], unavailable: [], error: 'This key was revoked.' }).every((x) => x.reason === 'This key was revoked.')).toBe(true);
  });
});

describe('time and size words', () => {
  const now = Date.UTC(2026, 9, 29, 12, 0, 0);
  it('speaks plainly', () => {
    expect(timeAgo(now - 10_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(timeAgo(now - 3 * 3600_000, now)).toBe('3 h ago');
    expect(timeAgo(now - 30 * 3600_000, now)).toBe('yesterday');
    expect(timeAgo(now - 4 * 86400_000, now)).toBe('4 days ago');
    expect(timeAgo(now + 5000, now)).toBe('just now');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1048576)).toBe('3.0 MB');
  });
});
