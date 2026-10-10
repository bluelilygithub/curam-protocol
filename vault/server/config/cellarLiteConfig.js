'use strict';

// Cellar Planner LITE: the settings the business owner controls from Vault (Settings -> Cellar Planner): rack unit sizes, door widths, the price
// formula and a few words on the page. Stored as one JSON value in workspace_settings under KEY. This file is the single place that says what a valid
// setting is; the admin screen, the public endpoint and the tests all use it. The browser tool has its own copy of DEFAULTS
// (cellar-planner/src/lite/config.ts) for when this endpoint cannot be reached; keep the two in step (a test compares them).

const KEY = 'cellar_lite_config';

const LIMITS = {
  unitWidthMm: [400, 1200], unitHeightMm: [1000, 3000],
  doorSingleMm: [700, 1300], doorDoubleMm: [1200, 2400],
  price: [0, 1000000], rangePct: [0, 50],
  roomWidthMm: [1000, 8000], roomDepthMm: [1000, 8000], roomHeightMm: [1800, 3200],
};
const ROUND_TO = [1, 10, 50, 100, 500, 1000];
const MAX_PRESETS = 6;

const DEFAULTS = Object.freeze({
  version: 1,
  promise: 'Free to use. No sign-up. Takes about two minutes. You only share your details if you ask for a quote.',
  quoteNote: 'We usually reply within one business day.',
  rack: { unitWidthMm: 600, unitHeightMm: 2000 },
  doors: { singleMm: 970, doubleMm: 1500 },
  pricing: {
    show: false, currency: '$', fixed: null, perUnit: null, doorSingle: null, doorDouble: null, rangePct: 15, roundTo: 100,
    note: 'A guide only. The final price depends on a site measure and the finishes you choose.',
  },
  presets: [
    { id: 'small', name: 'Small cellar', widthMm: 1800, depthMm: 1500, heightMm: 2400, doorStyle: 'SINGLE' },
    { id: 'walk-in', name: 'Walk-in cellar', widthMm: 2750, depthMm: 1565, heightMm: 2150, doorStyle: 'SINGLE' },
    { id: 'large', name: 'Large cellar', widthMm: 4000, depthMm: 3000, heightMm: 2400, doorStyle: 'DOUBLE' },
  ],
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// control characters are never wanted in text that ends up in a page or an email
const cleanText = (v, max) => String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Turn whatever was stored or posted into a complete, safe config. Anything missing or invalid falls back to the default for that field and is
 * reported in `errors` (plain sentences the admin screen can show). The result is always usable.
 * @returns {{ config: typeof DEFAULTS, errors: string[] }}
 */
function validateConfig(raw) {
  const errors = [];
  const src = isObj(raw) ? raw : {};
  if (raw !== undefined && raw !== null && !isObj(raw)) errors.push('The settings were not in the expected format.');

  const int = (v, [lo, hi], fallback, label) => {
    if (v === undefined || v === null || v === '') return fallback;
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) { errors.push(`${label} must be between ${lo} and ${hi}.`); return fallback; }
    return Math.round(n);
  };
  const money = (v, label) => {
    if (v === undefined || v === null || v === '') return null; // blank = not set
    const n = Number(v);
    if (!Number.isFinite(n) || n < LIMITS.price[0] || n > LIMITS.price[1]) { errors.push(`${label} must be a price between 0 and ${LIMITS.price[1].toLocaleString('en-AU')}, or left blank.`); return null; }
    return Math.round(n * 100) / 100;
  };

  const rack = isObj(src.rack) ? src.rack : {};
  const doors = isObj(src.doors) ? src.doors : {};
  const p = isObj(src.pricing) ? src.pricing : {};
  const D = DEFAULTS;

  const pricing = {
    show: p.show === true,
    currency: p.currency === undefined ? D.pricing.currency : cleanText(p.currency, 3) || D.pricing.currency,
    fixed: money(p.fixed, 'The fixed amount'),
    perUnit: money(p.perUnit, 'The price per rack unit'),
    doorSingle: money(p.doorSingle, 'The single door price'),
    doorDouble: money(p.doorDouble, 'The double door price'),
    rangePct: int(p.rangePct, LIMITS.rangePct, D.pricing.rangePct, 'The price range'),
    roundTo: ROUND_TO.includes(Number(p.roundTo)) ? Number(p.roundTo) : D.pricing.roundTo,
    note: p.note === undefined ? D.pricing.note : cleanText(p.note, 300),
  };
  if (p.roundTo !== undefined && !ROUND_TO.includes(Number(p.roundTo))) errors.push(`Round prices to must be one of ${ROUND_TO.join(', ')}.`);
  if (pricing.show && pricing.fixed === null && pricing.perUnit === null && pricing.doorSingle === null && pricing.doorDouble === null) {
    errors.push('To show a price, enter at least one amount (fixed, per rack unit or a door price).');
    pricing.show = false;
  }

  const presets = [];
  if (src.presets !== undefined && !Array.isArray(src.presets)) errors.push('The starting rooms were not in the expected format.');
  const list = Array.isArray(src.presets) ? src.presets : D.presets;
  if (list.length > MAX_PRESETS) errors.push(`At most ${MAX_PRESETS} starting rooms.`);
  const seen = new Set();
  list.slice(0, MAX_PRESETS).forEach((pr, i) => {
    const n = i + 1;
    if (!isObj(pr)) { errors.push(`Starting room ${n} was not in the expected format.`); return; }
    const name = cleanText(pr.name ?? '', 40);
    if (!name) { errors.push(`Starting room ${n} needs a name.`); return; }
    const before = errors.length;
    const widthMm = int(pr.widthMm, LIMITS.roomWidthMm, null, `${name}: width`);
    const depthMm = int(pr.depthMm, LIMITS.roomDepthMm, null, `${name}: depth`);
    const heightMm = int(pr.heightMm, LIMITS.roomHeightMm, null, `${name}: height`);
    if (widthMm === null || depthMm === null || heightMm === null) { if (errors.length === before) errors.push(`${name} needs a width, depth and height.`); return; }
    const slug = (t) => cleanText(t ?? '', 40).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    let id = slug(pr.id) || slug(name) || `room-${n}`;
    while (seen.has(id)) id += '-x';
    seen.add(id);
    presets.push({ id, name, widthMm, depthMm, heightMm, doorStyle: pr.doorStyle === 'DOUBLE' ? 'DOUBLE' : 'SINGLE' });
  });

  const config = {
    version: 1,
    promise: src.promise === undefined ? D.promise : cleanText(src.promise, 200),
    quoteNote: src.quoteNote === undefined ? D.quoteNote : cleanText(src.quoteNote, 200),
    rack: {
      unitWidthMm: int(rack.unitWidthMm, LIMITS.unitWidthMm, D.rack.unitWidthMm, 'The rack unit width'),
      unitHeightMm: int(rack.unitHeightMm, LIMITS.unitHeightMm, D.rack.unitHeightMm, 'The rack unit height'),
    },
    doors: {
      singleMm: int(doors.singleMm, LIMITS.doorSingleMm, D.doors.singleMm, 'The single door width'),
      doubleMm: int(doors.doubleMm, LIMITS.doorDoubleMm, D.doors.doubleMm, 'The double door width'),
    },
    pricing,
    presets,
  };
  return { config, errors };
}

/** What the public endpoint may say. Unpublished prices are never sent: with `show` off the amounts are blanked. */
function publicView(config) {
  if (config.pricing.show) return config;
  return { ...config, pricing: { ...config.pricing, fixed: null, perUnit: null, doorSingle: null, doorDouble: null } };
}

module.exports = { KEY, LIMITS, ROUND_TO, MAX_PRESETS, DEFAULTS, validateConfig, publicView };
