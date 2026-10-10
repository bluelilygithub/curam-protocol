import { createRequire } from 'node:module';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DEFAULT_CONFIG, configUrl, loadConfig, normaliseConfig, VAULT_ORIGIN, type LiteConfig } from '../src/lite/config';
import { priceRange } from '../src/lite/price';
import { defaultLite, liteResult, liteToProject, rackUnitCount, summaryLine } from '../src/lite/settings';

const require = createRequire(import.meta.url);
// the server's own rules (CommonJS); the browser copy must agree with them
const server = require('../../server/config/cellarLiteConfig.js') as { DEFAULTS: unknown; validateConfig: (raw: unknown) => { config: LiteConfig; errors: string[] } };

const withPrices = (over: Partial<LiteConfig['pricing']> = {}): LiteConfig => ({ ...DEFAULT_CONFIG, pricing: { ...DEFAULT_CONFIG.pricing, show: true, perUnit: 1000, fixed: 2000, doorSingle: 500, doorDouble: 900, rangePct: 10, roundTo: 100, ...over } });

describe('the browser and the server agree on what a setting is', () => {
  it('the built-in defaults are exactly the server defaults', () => {
    expect(JSON.parse(JSON.stringify(DEFAULT_CONFIG))).toEqual(JSON.parse(JSON.stringify(server.DEFAULTS)));
  });
  it('for a spread of inputs, the browser result equals the server result', () => {
    const inputs: unknown[] = [
      undefined, null, 'x', 7, [], {},
      { rack: { unitWidthMm: 750, unitHeightMm: 2300 }, doors: { singleMm: 900, doubleMm: 1700 } },
      { rack: { unitWidthMm: 5, unitHeightMm: 99999 }, doors: { singleMm: 'wide' } },
      { pricing: { show: true, perUnit: 1200.456, fixed: '', rangePct: 20, roundTo: 500, currency: 'AU$x', note: 'hi\u0000 there' } },
      { pricing: { show: true } },
      { pricing: { show: true, perUnit: -4, doorDouble: 'free' } },
      { promise: '  Hello\n world  ', presets: [{ name: 'A', widthMm: 2000, depthMm: 2000, heightMm: 2400, doorStyle: 'DOUBLE' }, { name: '', widthMm: 2000, depthMm: 2000, heightMm: 2400 }, { name: 'B', widthMm: 99, depthMm: 2000, heightMm: 2400 }] },
      { presets: [] },
      { presets: new Array(9).fill({ name: 'x', widthMm: 2000, depthMm: 2000, heightMm: 2400, id: 'same' }) },
    ];
    for (const raw of inputs) {
      expect(normaliseConfig(raw), JSON.stringify(raw)).toEqual(server.validateConfig(raw).config);
    }
  });
});

describe('loading the settings never breaks the page', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* node: no storage */ } });
  const ok = (body: unknown): typeof fetch => (async () => ({ ok: true, status: 200, json: async () => body }) as Response) as unknown as typeof fetch;

  it('uses the server\'s answer', async () => {
    const r = await loadConfig(ok({ rack: { unitWidthMm: 800 } }), 'http://x/api');
    expect(r.source).toBe('server');
    expect(r.config.rack.unitWidthMm).toBe(800);
  });
  it('falls back to the defaults, with the reason, when the request fails', async () => {
    const r = await loadConfig((async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch, 'http://x/api');
    expect(r.source).toBe('default');
    expect(r.reason).toMatch(/Failed to fetch/);
    expect(r.config).toEqual(DEFAULT_CONFIG);
  });
  it('falls back when the server answers an error', async () => {
    const r = await loadConfig((async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response) as unknown as typeof fetch, 'http://x/api');
    expect(r.source).toBe('default');
    expect(r.reason).toMatch(/503/);
  });
  it('falls back when the answer is not JSON', async () => {
    const r = await loadConfig((async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }) as unknown as Response) as unknown as typeof fetch, 'http://x/api');
    expect(r.source).toBe('default');
  });
  it('gives up after a few seconds instead of waiting for ever', async () => {
    vi.useFakeTimers();
    const hang = ((_u: string, init?: RequestInit) => new Promise((_res, rej) => { init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); })) as unknown as typeof fetch;
    const p = loadConfig(hang, 'http://x/api');
    await vi.advanceTimersByTimeAsync(4100);
    const r = await p;
    vi.useRealTimers();
    expect(r.source).toBe('default');
    expect(r.reason).toMatch(/no answer within 4 seconds/);
  });
  it('a damaged answer cannot produce an unbuildable tool', async () => {
    const r = await loadConfig(ok({ rack: { unitWidthMm: -1 }, presets: 'oops', pricing: { show: true } }), 'http://x/api');
    expect(r.config.rack.unitWidthMm).toBe(600);
    expect(r.config.pricing.show).toBe(false);
  });
  it('asks Vault itself when served by Vault, and Vault across the internet otherwise', () => {
    const host = new URL(VAULT_ORIGIN);
    expect(configUrl({ origin: VAULT_ORIGIN, hostname: host.hostname })).toBe(`${VAULT_ORIGIN}/api/cellar-lite/config`);
    expect(configUrl({ origin: 'https://wiwc.com.au', hostname: 'wiwc.com.au' })).toBe(`${VAULT_ORIGIN}/api/cellar-lite/config`);
  });
});

describe('the indicative price', () => {
  it('is fixed + per unit x units + the door, as a rounded range', () => {
    // 2000 + 1000 x 12 + 500 = 14500; +/-10% = 13050..15950 -> 13100..16000
    const r = priceRange(withPrices(), 12, 'SINGLE');
    expect(r).toMatchObject({ low: 13100, high: 16000 });
    expect(r?.text).toBe('$13,100 to $16,000');
  });
  it('uses the double door price for a double door', () => {
    expect(priceRange(withPrices({ rangePct: 0 }), 12, 'DOUBLE')?.text).toBe('about $14,900');
  });
  it('shows nothing unless prices are switched on', () => {
    expect(priceRange({ ...withPrices(), pricing: { ...withPrices().pricing, show: false } }, 12, 'SINGLE')).toBeNull();
    expect(priceRange(DEFAULT_CONFIG, 12, 'SINGLE')).toBeNull();
  });
  it('shows nothing when no amount is entered, however it is switched', () => {
    expect(priceRange(withPrices({ fixed: null, perUnit: null, doorSingle: null, doorDouble: null }), 12, 'SINGLE')).toBeNull();
  });
  it('only needs one amount: a per-unit price alone works, and a missing door price counts as nothing', () => {
    expect(priceRange(withPrices({ fixed: null, doorSingle: null, doorDouble: null, rangePct: 0 }), 10, 'SINGLE')?.low).toBe(10000);
  });
  it('shows nothing for a design that cannot be built, or has no units', () => {
    expect(priceRange(withPrices(), 12, 'SINGLE', 1)).toBeNull();
    expect(priceRange(withPrices(), 0, 'SINGLE')).toBeNull();
  });
  it('rounds to the chosen step and never goes negative', () => {
    expect(priceRange(withPrices({ roundTo: 1000, rangePct: 0 }), 12, 'SINGLE')?.low).toBe(15000);
    expect(priceRange(withPrices({ rangePct: 50, fixed: 0, perUnit: 100, doorSingle: 0 }), 1, 'SINGLE')!.low).toBeGreaterThanOrEqual(0);
  });
  it('a price that rounds to one figure reads "about"', () => {
    expect(priceRange(withPrices({ rangePct: 0 }), 12, 'SINGLE')?.text).toBe('about $14,500');
  });
});

describe('the owner\'s rack and door sizes change the design', () => {
  const s = defaultLite();
  const base = liteResult(s);
  const cfg = (rack: Partial<LiteConfig['rack']> = {}, doors: Partial<LiteConfig['doors']> = {}): LiteConfig => ({ ...DEFAULT_CONFIG, rack: { ...DEFAULT_CONFIG.rack, ...rack }, doors: { ...DEFAULT_CONFIG.doors, ...doors } });

  it('with the default settings nothing has changed from before (the standard design still holds 1120 bottles)', () => {
    expect(base.bottles).toBe(1120);
    expect(liteResult(s, DEFAULT_CONFIG).bottles).toBe(1120);
  });
  it('a wider rack unit changes the number of units and the bottle count', () => {
    const wide = liteResult(s, cfg({ unitWidthMm: 900 }));
    expect(wide.problems).toEqual([]);
    expect(rackUnitCount(wide.project)).toBeLessThan(rackUnitCount(base.project));
    expect(wide.bottles).not.toBe(base.bottles);
  });
  it('a taller rack unit holds more rows', () => {
    const tall = liteResult({ ...s, heightMm: 2600 }, cfg({ unitHeightMm: 2400 }));
    const std = liteResult({ ...s, heightMm: 2600 }, cfg({ unitHeightMm: 2000 }));
    expect(tall.bottles).toBeGreaterThan(std.bottles);
  });
  it('a unit can never be taller than the room: the design stays buildable', () => {
    const r = liteResult({ ...s, heightMm: 2150 }, cfg({ unitHeightMm: 3000 }));
    expect(r.problems).toEqual([]);
    expect(liteToProject({ ...s, heightMm: 2150 }, cfg({ unitHeightMm: 3000 })).rackSpec.unitHeightMm).toBe(2150);
  });
  it('the door widths come from the settings', () => {
    expect(liteToProject(s, cfg({}, { singleMm: 1100 })).enclosure.door.widthMm).toBe(1100);
    expect(liteToProject({ ...s, doorStyle: 'DOUBLE' }, cfg({}, { doubleMm: 1800 })).enclosure.door.widthMm).toBe(1800);
  });
  it('the enquiry line quotes the unit width actually used', () => {
    expect(summaryLine(s, 1000, cfg({ unitWidthMm: 750 }))).toContain('about 750 mm wide');
    expect(summaryLine(s, 1120)).toContain('about 600 mm wide');
  });
  it('every extreme the owner can set still gives a design the tool can draw', () => {
    for (const w of [400, 600, 1200]) for (const h of [1000, 2000, 3000]) {
      const r = liteResult(s, cfg({ unitWidthMm: w, unitHeightMm: h }, { singleMm: 700, doubleMm: 2400 }));
      expect(Number.isFinite(r.bottles)).toBe(true);
    }
  });
});
