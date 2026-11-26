// @vitest-environment jsdom
// Web pages: the HTML reader, HTML vs HTML and HTML vs Word, the Word export round trip, the "Fetch a web page" bridge, projects whose
// original is a fetched page, and the privacy guarantees (no script runs, nothing loads, nothing about the person's files is sent).
// jsdom gives the reader the DOMParser it uses in the browser. Fixture pages: tests/fixtures/web/.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareDocs } from '../src/compare/pipeline';
import { readPair } from '../src/compare/read';
import { addRound, createProject, storeFile, type CompareFn } from '../src/project/engine';
import { docxReader } from '../src/readers/docx';
import { decodeHtml, extract, htmlReader } from '../src/readers/html';
import { GateError, type Block, type NormalizedDoc } from '../src/readers/types';
import type { Change } from '../src/report/model';
import { buildWordDoc } from '../src/report/wordExport';
import { DEFAULT_SETTINGS } from '../src/settings';
import { normaliseUrl, requestPage, snapshotFile } from '../src/web/fetchPage';
import { FETCHED_TYPE, FETCH_TYPE } from '@vault-client/pages/docCompare/docCompareTools.mjs';

const page = (name: string) => new File([readFileSync(`tests/fixtures/web/${name}.html`)], `${name}.html`, { lastModified: Date.UTC(2026, 10, 1) });
const read = (name: string) => htmlReader.read(page(name));
const asWord = async (doc: NormalizedDoc, name: string) => new File([await (await buildWordDoc(doc)).arrayBuffer()], name, { lastModified: Date.UTC(2026, 10, 2) });
const real = (changes: Change[]) => changes.filter((c) => !c.trivial);
const texts = (doc: NormalizedDoc) => doc.blocks.map((b) => b.text).join('\n');
const compare: CompareFn = async (a, b) => compareDocs(a, b, DEFAULT_SETTINGS);

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the HTML reader', () => {
  it('takes a landing page from its <main>, without the menu, header, footer, sidebar, cookie banner or hidden popup', async () => {
    const d = await read('landing');
    expect(d.sourceType).toBe('html');
    expect(d.metadata.extraction).toMatch(/main area/);
    expect(d.metadata.url).toBe('https://www.harbouraccounting.example/services/bookkeeping/');
    expect(d.metadata.title).toBe('Harbour Accounting | Small business bookkeeping in Sydney');
    expect(d.metadata.producer).toBe('WordPress 6.6.2');
    const all = texts(d);
    for (const clutter of ['cookies', 'Accept all', 'About us', 'Book a call', 'Skip to content', 'Latest news', 'ABN', 'Privacy', 'monthly tax tips', 'gtag', 'dataLayer']) expect(all).not.toContain(clutter);
    const heads = d.blocks.filter((b) => b.type === 'heading').map((b) => [b.level, b.text]);
    expect(heads).toEqual([[1, 'Bookkeeping that keeps you ahead of the ATO'], [2, "What's included"], [2, 'Plans and pricing'], [2, 'What our clients say'], [2, 'How to get started']]);
    // lists: bullets, and an ordered list numbered as shown
    const items = d.blocks.filter((b) => b.type === 'listItem');
    expect(items.filter((b) => b.style === 'bullet list')).toHaveLength(4);
    expect(items.filter((b) => b.style === 'ordered list').map((b) => b.number)).toEqual(['1.', '2.', '3.']);
    // inline formatting: bold and italic, headings and table headers bold as a browser draws them
    expect(items[0].runs.find((r) => r.text === 'Monthly reconciliation')?.bold).toBe(true);
    expect(d.blocks[0].runs.find((r) => r.text === 'ahead')?.italic).toBe(true);
    // a table: 4 rows of 3 cells, with positions
    const cells = d.blocks.filter((b) => b.type === 'tableCell');
    expect(cells).toHaveLength(12);
    expect(cells[5]).toMatchObject({ text: '$49 per month', location: { table: { t: 0, r: 1, c: 2 } } });
    expect(cells[0].runs[0].bold).toBe(true);
    // links made absolute against the page's address; tel: and mailto: kept
    const links = d.blocks.flatMap((b) => b.runs.filter((r) => r.link).map((r) => r.link));
    expect(links).toEqual(['https://www.harbouraccounting.example/contact/?ref=hero', 'https://www.xero.com/au/', 'tel:+61290000000', 'mailto:hello@harbouraccounting.example']);
    // pictures keep their alt text; the 1-pixel tracker outside <main> is gone
    expect(d.blocks.filter((b) => b.type === 'image').map((b) => b.text)).toEqual(['The Harbour Accounting team at our Parramatta office']);
    expect(d.blocks.find((b) => b.style === 'Quote')?.text).toMatch(/^"Harbour took our books/);
    // alt text is not counted as words
    expect(d.metadata.wordCount).toBe(d.blocks.filter((b) => b.type !== 'image').reduce((n, b) => n + (b.text.match(/\S+/g) ?? []).length, 0));
  });

  it('finds an article without <main> with Readability, keeping heading levels and the page address from a saved page', async () => {
    const d = await read('article');
    expect(d.metadata.extraction).toMatch(/Readability/);
    expect(d.metadata.url).toBe('https://blog.harbouraccounting.example/2026/10/five-bas-mistakes-to-avoid');
    expect(d.metadata.author).toBe("Sam O'Connell");
    expect(d.metadata.created?.toISOString()).toBe('2026-10-13T22:00:00.000Z');
    const heads = d.blocks.filter((b) => b.type === 'heading');
    expect(heads[0]).toMatchObject({ level: 1, text: 'Five BAS mistakes to avoid' });
    expect(heads.filter((b) => b.level === 2)).toHaveLength(5);
    expect(heads.find((b) => b.level === 3)?.text).toBe('Key dates for quarterly lodgers');
    const all = texts(d);
    for (const clutter of ['Share on', 'You might also like', '2 comments', 'Popular posts', 'No spam', 'Parramatta NSW', 'partners use cookies', 'Cash flow']) expect(all).not.toContain(clutter);
    expect(d.blocks.flatMap((b) => b.runs.map((r) => r.link)).filter(Boolean)).toEqual(['https://blog.harbouraccounting.example/guides/separate-accounts/']);
    expect(d.blocks.find((b) => b.type === 'image')?.text).toBe('A pile of mixed personal and business receipts');
  });

  it('stops a JavaScript app shell with a plain message suggesting a saved copy', async () => {
    const e = await read('spa-shell').catch((x) => x);
    expect(e).toBeInstanceOf(GateError);
    expect(e.code).toBe('no-text');
    expect(e.message).toMatch(/almost no text.*built with JavaScript.*Save Page As/s);
  });

  it('reads the character set the page declares', () => {
    const latin1Page = Uint8Array.from([...new TextEncoder().encode('<meta charset="windows-1252"><p>Caf'), 0xe9, ...new TextEncoder().encode(' au lait</p>')]);
    expect(decodeHtml(latin1Page)).toContain('Café au lait');
    expect(decodeHtml(new TextEncoder().encode('﻿<p>naïve</p>'))).toBe('<p>naïve</p>');
  });

  it('leaves relative links as written when the page records no address of its own', () => {
    const x = extract('<main><p>See <a href="/pricing/">our pricing</a> for every plan we offer to small businesses across the whole of Sydney and the Central Coast.</p></main>');
    expect(x.url).toBeUndefined();
    expect(x.blocks[0].runs.find((r) => r.link)?.link).toBe('/pricing/');
  });
});

describe('comparing web pages', () => {
  it('HTML vs HTML: the published page against the approved one shows only the real changes, not menu, sidebar or banner changes', async () => {
    const [a, b] = await readPair(page('landing'), page('landing-published'));
    const changes = real(compareDocs(a, b, DEFAULT_SETTINGS).changes);
    const summary = changes.map((c) => `${c.category}: ${c.original ?? ''} -> ${c.edited ?? ''} ${c.detail ?? ''}`).join('\n');
    expect(changes.find((c) => c.category === 'number')).toMatchObject({ severity: 'high', original: '$49 per month', edited: '$59 per month' });
    expect(changes.find((c) => c.category === 'removed')?.original).toBe('Payroll and Single Touch Payroll reporting');
    expect(changes.some((c) => c.category === 'wording' && /their owners/.test(c.original ?? ''))).toBe(true);
    expect(changes.some((c) => c.category === 'formatting' && /link/.test(c.detail ?? '') && /xero\.com\/au\/partners/.test(c.detail ?? ''))).toBe(true);
    expect(summary).not.toMatch(/cookies|Blog|tax planning guide/);
    expect(changes).toHaveLength(4);
  });

  it('HTML vs the copywriter\'s edited Word file: their edits, a new claim, and no formatting or file-detail noise', async () => {
    const html = await read('landing');
    const edited: Block[] = [];
    for (const b of html.blocks) {
      if (b.text === 'A named bookkeeper who answers within one business day') continue; // cut in Word
      if (b.text.startsWith('Harbour Accounting looks after')) { edited.push({ ...b, text: 'Harbour Accounting keeps the books for more than 240 small businesses across Sydney, so their owners can get back to the work they love.', runs: [{ text: 'Harbour Accounting keeps the books for more than 240 small businesses across Sydney, so their owners can get back to the work they love.' }] }); continue; }
      edited.push(b);
      if (b.text.startsWith('Prices include GST')) edited.push({ id: 'new', type: 'paragraph', text: '98% of our clients renew with us every year.', runs: [{ text: '98% of our clients renew with us every year.' }], location: { index: 0 } });
    }
    const docx = await asWord({ ...html, blocks: edited }, 'bookkeeping-edited.docx');
    const [a, b] = await readPair(page('landing'), docx); // a web page and a Word file pass Gate 1 together
    expect([a.sourceType, b.sourceType]).toEqual(['html', 'docx']);
    const changes = real(compareDocs(a, b, DEFAULT_SETTINGS).changes);
    const cats = changes.map((c) => c.category).sort();
    expect(cats).toEqual(['added', 'newClaim', 'removed', 'wording']);
    expect(changes.find((c) => c.category === 'newClaim')?.severity).toBe('high');
    expect(changes.find((c) => c.category === 'removed')?.original).toBe('A named bookkeeper who answers within one business day');
  });

  it('round trip: a page exported to Word reads back with nothing lost or changed', async () => {
    for (const name of ['landing', 'article']) {
      const html = await read(name);
      const back = await docxReader.read(await asWord(html, `${name}.docx`));
      const shape = (d: NormalizedDoc) => d.blocks.map((b) => ({ type: b.type, level: b.level, text: b.text, number: b.number, links: b.runs.filter((r) => r.link).map((r) => r.link), bold: b.runs.filter((r) => r.bold).map((r) => r.text).join('|'), italic: b.runs.filter((r) => r.italic).map((r) => r.text).join('|'), table: b.location.table }));
      expect(shape(back), name).toEqual(shape(html));
      const r = compareDocs(html, back, DEFAULT_SETTINGS);
      expect(real(r.changes), name).toEqual([]);
      expect(back.metadata.title).toBe(html.metadata.title);
    }
  });

  it('a web page cannot be compared with a PDF or Markdown file', async () => {
    const md = new File(['# Plan\n\nSome text.'], 'plan.md');
    await expect(readPair(page('landing'), md)).rejects.toMatchObject({ code: 'type-mismatch', message: expect.stringMatching(/web page and a Word file may be compared/) });
  });

  it('page limits are not applied to web pages', async () => {
    const [a, b] = await readPair(page('landing'), page('landing-published'));
    const s = { ...DEFAULT_SETTINGS, pageLimit: 1 };
    expect(compareDocs(a, { ...b, metadata: { ...b.metadata, pageCount: 5 } }, s).changes.filter((c) => c.category === 'wordLimit')).toEqual([]);
  });
});

describe('found on real pages (gov.uk, Wikipedia, MDN): no change is reported for an unedited page', () => {
  it('an acronym the original uses only in the plural ("NETPs") or before a hyphen ("IGST-") is not "new"', async () => {
    const text = '<main><h1>Registering</h1><p>Read the guidance on non-established taxable persons (NETPs) before you apply, and keep a copy of every form you send to the office.</p><p>IGST- integrated goods and services tax, charged on supplies made between two different states.</p></main>';
    const a = await htmlReader.read(new File([text], 'a.html'));
    const b = await htmlReader.read(new File([text], 'b.html'));
    expect(real(compareDocs(a, b, DEFAULT_SETTINGS).changes)).toEqual([]);
  });

  it('a link to a place inside a page (#fragment) survives the Word round trip', async () => {
    const html = await htmlReader.read(new File(['<main><h1>VAT</h1><p>Check a number with the <a href="https://ec.europa.eu/taxation_customs/vies/#/vat-validation">VIES checker</a> before you invoice any business customer in another country, and keep a record of the result with the invoice in case the tax office asks.</p></main>'], 'a.html'));
    const back = await docxReader.read(await asWord(html, 'a.docx'));
    expect(back.blocks[1].runs.find((r) => r.link)?.link).toBe('https://ec.europa.eu/taxation_customs/vies/#/vat-validation');
  });

  it('in an article found by Readability, relative links stay as written when the page records no address (never the app\'s own)', async () => {
    const page = readFileSync('tests/fixtures/web/article.html', 'utf8').replace(/^<!-- saved from[^\n]*\n/, '');
    const d = await htmlReader.read(new File([page], 'article.html'));
    expect(d.metadata.extraction).toMatch(/Readability/);
    expect(d.blocks.flatMap((b) => b.runs.map((r) => r.link)).filter(Boolean)).toEqual(['../../guides/separate-accounts/']);
    expect(document.querySelector('base')).toBeNull();
  });
});

describe('a project whose original is a web page', () => {
  it('original = the fetched page (no round yet), round 1 = the edited Word file, round 2 = the published page', async () => {
    const original = await read('landing');
    let p = createProject(await storeFile(page('landing'), original), 'Bookkeeping page');
    expect(p.rounds).toHaveLength(0);
    const edited: Block[] = original.blocks.filter((b) => b.text !== 'Payroll and Single Touch Payroll reporting');
    const word = await asWord({ ...original, blocks: edited }, 'bookkeeping-approved.docx');
    p = (await addRound(p, await storeFile(word, await docxReader.read(word)), compare, 'Approved copy')).project;
    expect(p.rounds[0].items.map((i) => i.change.category)).toEqual(['removed']);
    const published = page('landing-published');
    p = (await addRound(p, await storeFile(published, await htmlReader.read(published)), compare, 'Published page')).project;
    const cats = p.rounds[1].items.filter((i) => i.status !== 'fixed' && i.status !== 'accepted').map((i) => i.change.category).sort();
    expect(cats).toContain('number'); // the price the developer got wrong
    expect(cats).toContain('wording');
  });
});

describe('Fetch a web page (the bridge to Vault)', () => {
  const landingBytes = () => new Uint8Array(readFileSync('tests/fixtures/web/landing.html'));
  /** Plays Vault's page: answers the app's request with `reply`, recording exactly what the app sent. */
  function vault(reply: (req: { id: string; url: string }) => Record<string, unknown>) {
    const sent: { message: unknown; origin: string }[] = [];
    const target = {
      postMessage: (message: { id: string; url: string }, origin: string) => {
        sent.push({ message, origin });
        setTimeout(() => window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, data: { type: FETCHED_TYPE, id: message.id, ...reply(message) } })), 0);
      },
    };
    return { target: target as unknown as Window, sent };
  }

  it('sends only the address, then keeps the page as a dated snapshot that reads like a saved page', async () => {
    const at = new Date(2026, 10, 26, 9, 5);
    const v = vault(() => ({ ok: true, bytes: landingBytes().buffer, finalUrl: 'https://www.harbouraccounting.example/services/bookkeeping/', contentType: 'text/html; charset=utf-8' }));
    const got = await requestPage('harbouraccounting.example/services/bookkeeping', { target: v.target, now: () => at });
    expect(v.sent).toHaveLength(1);
    expect(v.sent[0].origin).toBe(window.location.origin);
    expect(Object.keys(v.sent[0].message as object).sort()).toEqual(['id', 'type', 'url']);
    expect(v.sent[0].message).toMatchObject({ type: FETCH_TYPE, url: 'https://harbouraccounting.example/services/bookkeeping' });
    expect(got.file.name).toBe('www.harbouraccounting.example_services_bookkeeping_2026-11-26_0905.html');
    expect(got.file.lastModified).toBe(at.getTime());
    const final = 'https://www.harbouraccounting.example/services/bookkeeping/';
    expect((await got.file.text()).startsWith(`<!-- saved from url=(${String(final.length).padStart(4, '0')})${final} -->\n<meta charset="utf-8">\n<!DOCTYPE html>`)).toBe(true);
    expect(got.doc.metadata.extraction).toMatch(/main area/);
    expect(got.doc.metadata.url).toBe('https://www.harbouraccounting.example/services/bookkeeping/');
  });

  it('a page with almost no text is refused with the advice to upload a saved copy', async () => {
    const v = vault(() => ({ ok: true, bytes: new Uint8Array(readFileSync('tests/fixtures/web/spa-shell.html')).buffer, finalUrl: 'https://portal.example/', contentType: 'text/html' }));
    await expect(requestPage('https://portal.example/', { target: v.target })).rejects.toThrow(/built with JavaScript.*Save Page As/s);
  });

  it("the server's message is shown as it is; addresses that are not web addresses are refused before anything is sent", async () => {
    const v = vault(() => ({ ok: false, error: 'That address is not allowed' }));
    await expect(requestPage('http://10.0.0.1/', { target: v.target })).rejects.toThrow('That address is not allowed');
    const none = vault(() => ({}));
    for (const bad of ['', 'file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com/x']) await expect(requestPage(bad, { target: none.target })).rejects.toThrow();
    expect(none.sent).toHaveLength(0);
    expect(normaliseUrl('example.com')).toBe('https://example.com/');
  });

  it('a reply for another request is ignored', async () => {
    const target = { postMessage: () => window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, data: { type: FETCHED_TYPE, id: 'someone-else', ok: true, bytes: new ArrayBuffer(1) } })) } as unknown as Window;
    await expect(requestPage('https://example.com/', { target, timeoutMs: 50 })).rejects.toThrow(/did not answer/);
  });

  it('a page served in another character set is kept as UTF-8 with the right characters', async () => {
    const bytes = Uint8Array.from([...new TextEncoder().encode('<main><h1>Caf'), 0xe9, ...new TextEncoder().encode(' menu</h1><p>' + 'Our café serves breakfast and lunch every day of the week, with coffee roasted locally in Marrickville. '.replace(/é/g, 'e').repeat(3) + '</p></main>')]);
    const f = snapshotFile(bytes, 'text/html; charset=windows-1252', 'https://cafe.example/');
    expect(await f.text()).toContain('Café menu');
    expect((await htmlReader.read(f)).blocks[0].text).toBe('Café menu');
  });
});

describe('privacy: nothing runs, nothing loads, nothing is sent', () => {
  it('reading a hostile page runs no script, loads nothing, touches nothing in the app, and keeps only its text', async () => {
    const fetchSpy = vi.fn(() => { throw new Error('network call'); });
    const xhrSpy = vi.fn(() => { throw new Error('network call'); });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', xhrSpy);
    const ImageSpy = vi.fn();
    vi.stubGlobal('Image', ImageSpy);
    const postSpy = vi.spyOn(window, 'postMessage');
    const before = document.documentElement.outerHTML;
    const mutations: MutationRecord[] = [];
    const obs = new MutationObserver((m) => mutations.push(...m));
    obs.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    // any HTML put into an element of the app's own document would show up here
    const innerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!;
    const liveWrites: string[] = [];
    vi.spyOn(Element.prototype, 'innerHTML', 'set').mockImplementation(function (this: Element, v: string) { if (this.ownerDocument === document) liveWrites.push(v); innerHTML.set!.call(this, v); });

    const d = await read('hostile');
    await new Promise((r) => setTimeout(r, 50)); // time for any event handler or timer the page might have queued
    obs.disconnect();

    expect((window as unknown as { __pwned?: string }).__pwned).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(ImageSpy).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
    expect(liveWrites).toEqual([]);
    expect(mutations).toEqual([]);
    expect(document.documentElement.outerHTML).toBe(before);
    const all = texts(d);
    expect(all).not.toMatch(/pwned|fetch\(|steal@example|srcdoc|evil\.example/);
    expect(all).toContain('Membership grew to 1,240 households');
    // the javascript: link keeps its words but loses its target; only the real link is kept
    expect(d.blocks.flatMap((b) => b.runs.map((r) => r.link)).filter(Boolean)).toEqual(['https://members.example/report.pdf']);
  });

  it('reading and comparing web pages and making the Word file make no network call and post nothing', async () => {
    const fetchSpy = vi.fn(() => { throw new Error('network call'); });
    const xhrSpy = vi.fn(() => { throw new Error('network call'); });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', xhrSpy);
    const postSpy = vi.spyOn(window, 'postMessage');
    const [a, b] = await readPair(page('landing'), page('landing-published'));
    compareDocs(a, b, DEFAULT_SETTINGS);
    const word = await asWord(a, 'x.docx');
    compareDocs(a, await docxReader.read(word), DEFAULT_SETTINGS);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled(); // the only message the app ever sends is a typed address, and only when Fetch is pressed
  });
});
