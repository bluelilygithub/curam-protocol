'use strict';

// Cellar Planner settings the business owner controls from Vault (Settings -> Cellar Planner): the RACK TYPES (sizes, bottle counts, price per unit,
// "confirmed by the supplier"), door widths, the price formula and a few words on the public page. Shared: the public lite tool reads the default rack
// type (as `rack` and `pricing.perUnit`, the same shape as before, so pages with an older copy keep working) and the staff Cellar Planner reads the
// whole catalogue. Stored as one JSON value in workspace_settings under KEY. This file is the single place that says what a valid
// setting is; the admin screen, the public endpoint and the tests all use it. The browser tool has its own copy of DEFAULTS
// (cellar-planner/src/lite/config.ts) for when this endpoint cannot be reached; keep the two in step (a test compares them).

const KEY = 'cellar_lite_config';


const LIMITS = {
  unitWidthMm: [400, 1200], unitHeightMm: [1000, 3000], unitDepthMm: [150, 1000], rowPitchMm: [60, 300], postsPerUnit: [1, 6],
  bottlesPerRow: [1, 40], rowsPerUnit: [1, 60],
  doorSingleMm: [700, 1300], doorDoubleMm: [1200, 2400],
  price: [0, 1000000], rangePct: [0, 50],
  roomWidthMm: [1000, 8000], roomDepthMm: [1000, 8000], roomHeightMm: [1800, 3200],
  quoteValidityDays: [1, 365],
};
const ROUND_TO = [1, 10, 50, 100, 500, 1000];
const MAX_PRESETS = 6;
const MAX_RACK_TYPES = 8;
const ORIENTATIONS = ['NECK_OUT', 'LABEL_FORWARD'];

const DEFAULTS = Object.freeze({
  version: 1,
  promise: 'Free to use. No sign-up. Takes about two minutes. You only share your details if you ask for a quote.',
  quoteNote: 'We usually reply within one business day.',
  phone: '',
  accent: '#4a5a2a',
  // the catalogue of rack types; null = not set (the staff app then shows its best guess, marked estimated). `confirmed` = the values are the supplier's.
  rackTypes: [{
    id: 'standard', name: 'Standard rack', unitWidthMm: 600, unitDepthMm: null, unitHeightMm: 2000, rowPitchMm: null, orientation: 'NECK_OUT', postsPerUnit: null,
    bottlesPerRow: null, bottlesPerRowLabelForward: null, rowsPerUnit: null, pricePerUnit: null, confirmed: false,
  }],
  defaultRackType: 'standard',
  // derived from the default rack type (kept in this shape for the public tool and for older copies of it)
  rack: { unitWidthMm: 600, unitHeightMm: 2000 },
  doors: { singleMm: 970, doubleMm: 1500 },
  pricing: {
    show: false, currency: '$', fixed: null, perUnit: null, doorSingle: null, doorDouble: null, rangePct: 15, roundTo: 100,
    note: 'A guide only. The final price depends on a site measure and the finishes you choose.',
  },
  // the staff quote PDF: who it is from and the owner's own terms. Never sent to the public tool.
  quote: { businessName: '', details: '', terms: '', validityDays: 30, gstNote: '' },
  presets: [
    { id: 'small', name: 'Small cellar', widthMm: 1800, depthMm: 1500, heightMm: 2400, doorStyle: 'SINGLE' },
    { id: 'walk-in', name: 'Walk-in cellar', widthMm: 2750, depthMm: 1565, heightMm: 2150, doorStyle: 'SINGLE' },
    { id: 'large', name: 'Large cellar', widthMm: 4000, depthMm: 3000, heightMm: 2400, doorStyle: 'DOUBLE' },
  ],
});

/** WCAG contrast of white text on this #rrggbb colour (needs 4.5 or more to read comfortably). */
function contrastWithWhite(hex) {
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const n = parseInt(hex.slice(1), 16);
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return 1.05 / (L + 0.05);
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// multi-line text (terms, address lines): control characters other than line breaks are removed, each line is tidied, blank runs collapse
const cleanMultiline = (v, max) => String(v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
  .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
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

  /** A phone number the visitor can tap to call: digits with an optional leading +, and spaces, hyphens, dots or brackets for readability. Blank hides the button. */
  const cleanPhone = (v) => {
    if (v === undefined || v === null) return '';
    const t = cleanText(v, 24);
    if (!t) return '';
    const digits = t.replace(/\D/g, '');
    if (!/^\+?[\d\s().-]+$/.test(t) || digits.length < 6 || digits.length > 15) { errors.push('The phone number must have 6 to 15 digits (spaces, + - . and brackets are fine), or be left blank.'); return ''; }
    return t;
  };

  /** The brand colour of the buttons and highlights: #rrggbb, dark enough for white text on it. */
  const cleanAccent = (v) => {
    if (v === undefined || v === null || v === '') return D0.accent;
    const t = String(v).trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(t)) { errors.push('The brand colour must be a hex colour such as #4a5a2a.'); return D0.accent; }
    if (contrastWithWhite(t) < 4.5) { errors.push('That brand colour is too light for white text on buttons. Choose a darker one.'); return D0.accent; }
    return t;
  };

  const doors = isObj(src.doors) ? src.doors : {};
  const p = isObj(src.pricing) ? src.pricing : {};
  const D = DEFAULTS;
  const D0 = DEFAULTS;
  const T0 = D.rackTypes[0];

  // ---- rack types. Settings saved before there were types had `rack` and `pricing.perUnit`: they become the one "Standard rack".
  const optInt = (v, lim, label) => (v === undefined || v === null || v === '' ? null : int(v, lim, null, label));
  const slug = (t) => cleanText(t ?? '', 40).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const parseType = (t, n) => {
    if (!isObj(t)) { errors.push(`Rack type ${n} was not in the expected format.`); return null; }
    const name = cleanText(t.name ?? '', 40);
    if (!name) { errors.push(`Rack type ${n} needs a name.`); return null; }
    const orientation = t.orientation === undefined || t.orientation === null || t.orientation === '' ? T0.orientation : t.orientation;
    if (!ORIENTATIONS.includes(orientation)) errors.push(`${name}: the bottle orientation must be neck-out or label-forward.`);
    return {
      id: slug(t.id) || slug(name) || `rack-${n}`,
      name,
      unitWidthMm: int(t.unitWidthMm, LIMITS.unitWidthMm, T0.unitWidthMm, `${name}: unit width`),
      unitDepthMm: optInt(t.unitDepthMm, LIMITS.unitDepthMm, `${name}: unit depth`),
      unitHeightMm: int(t.unitHeightMm, LIMITS.unitHeightMm, T0.unitHeightMm, `${name}: unit height`),
      rowPitchMm: optInt(t.rowPitchMm, LIMITS.rowPitchMm, `${name}: row pitch`),
      orientation: ORIENTATIONS.includes(orientation) ? orientation : T0.orientation,
      postsPerUnit: optInt(t.postsPerUnit, LIMITS.postsPerUnit, `${name}: posts per unit`),
      bottlesPerRow: optInt(t.bottlesPerRow, LIMITS.bottlesPerRow, `${name}: bottles per row`),
      bottlesPerRowLabelForward: optInt(t.bottlesPerRowLabelForward, LIMITS.bottlesPerRow, `${name}: bottles per row (label-forward)`),
      rowsPerUnit: optInt(t.rowsPerUnit, LIMITS.rowsPerUnit, `${name}: rows per unit`),
      pricePerUnit: money(t.pricePerUnit, `${name}: the price per rack unit`),
      confirmed: t.confirmed === true,
    };
  };
  let rawTypes;
  if (src.rackTypes === undefined || src.rackTypes === null) {
    const old = isObj(src.rack) ? src.rack : {};
    rawTypes = [{ id: T0.id, name: T0.name, unitWidthMm: old.unitWidthMm, unitHeightMm: old.unitHeightMm, pricePerUnit: p.perUnit }];
  } else if (!Array.isArray(src.rackTypes)) {
    errors.push('The rack types were not in the expected format.');
    rawTypes = [];
  } else {
    rawTypes = src.rackTypes;
  }
  if (rawTypes.length > MAX_RACK_TYPES) errors.push(`At most ${MAX_RACK_TYPES} rack types.`);
  const rackTypes = [];
  const usedIds = new Set();
  rawTypes.slice(0, MAX_RACK_TYPES).forEach((t, i) => {
    const rt = parseType(t, i + 1);
    if (!rt) return;
    while (usedIds.has(rt.id)) rt.id += '-x';
    usedIds.add(rt.id);
    rackTypes.push(rt);
  });
  if (!rackTypes.length) rackTypes.push({ ...T0 });
  let defaultRackType = typeof src.defaultRackType === 'string' && rackTypes.some((r) => r.id === src.defaultRackType) ? src.defaultRackType : rackTypes[0].id;
  if (src.defaultRackType !== undefined && src.defaultRackType !== null && src.defaultRackType !== '' && defaultRackType !== src.defaultRackType) errors.push('The default rack type must be one of the listed rack types.');
  const def = rackTypes.find((r) => r.id === defaultRackType);
  // what the public tool and older copies of it read: the default type's sizes (and its price per unit below)
  const rack = { unitWidthMm: def.unitWidthMm, unitHeightMm: def.unitHeightMm };
  for (const k of ['unitDepthMm', 'rowPitchMm', 'postsPerUnit', 'bottlesPerRow', 'rowsPerUnit']) if (def[k] !== null) rack[k] = def[k];

  const pricing = {
    show: p.show === true,
    currency: p.currency === undefined ? D.pricing.currency : cleanText(p.currency, 3) || D.pricing.currency,
    fixed: money(p.fixed, 'The fixed amount'),
    perUnit: def.pricePerUnit,
    doorSingle: money(p.doorSingle, 'The single door price'),
    doorDouble: money(p.doorDouble, 'The double door price'),
    rangePct: int(p.rangePct, LIMITS.rangePct, D.pricing.rangePct, 'The price range'),
    roundTo: ROUND_TO.includes(Number(p.roundTo)) ? Number(p.roundTo) : D.pricing.roundTo,
    note: p.note === undefined ? D.pricing.note : cleanText(p.note, 300),
  };
  if (p.roundTo !== undefined && !ROUND_TO.includes(Number(p.roundTo))) errors.push(`Round prices to must be one of ${ROUND_TO.join(', ')}.`);
  if (pricing.show && pricing.fixed === null && pricing.perUnit === null && pricing.doorSingle === null && pricing.doorDouble === null) {
    errors.push('To show a price, enter at least one amount (fixed, a rack type\'s price per unit, or a door price).');
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
    let id = slug(pr.id) || slug(name) || `room-${n}`;
    while (seen.has(id)) id += '-x';
    seen.add(id);
    presets.push({ id, name, widthMm, depthMm, heightMm, doorStyle: pr.doorStyle === 'DOUBLE' ? 'DOUBLE' : 'SINGLE' });
  });

  const q = isObj(src.quote) ? src.quote : {};
  const quote = {
    businessName: q.businessName === undefined ? D.quote.businessName : cleanText(q.businessName, 80),
    details: q.details === undefined ? D.quote.details : cleanMultiline(q.details, 300),
    terms: q.terms === undefined ? D.quote.terms : cleanMultiline(q.terms, 1200),
    validityDays: int(q.validityDays, LIMITS.quoteValidityDays, D.quote.validityDays, 'The quote validity'),
    gstNote: q.gstNote === undefined ? D.quote.gstNote : cleanText(q.gstNote, 120),
  };

  const config = {
    version: 1,
    promise: src.promise === undefined ? D.promise : cleanText(src.promise, 200),
    quoteNote: src.quoteNote === undefined ? D.quoteNote : cleanText(src.quoteNote, 200),
    phone: cleanPhone(src.phone),
    accent: cleanAccent(src.accent),
    rackTypes,
    defaultRackType,
    rack,
    doors: {
      singleMm: int(doors.singleMm, LIMITS.doorSingleMm, D.doors.singleMm, 'The single door width'),
      doubleMm: int(doors.doubleMm, LIMITS.doorDoubleMm, D.doors.doubleMm, 'The double door width'),
    },
    pricing,
    quote,
    presets,
  };
  return { config, errors };
}

/** What the public endpoint may say. Unpublished prices are never sent: with `show` off the amounts are blanked. */
function publicView(config) {
  const { quote: _quote, ...open } = config; // the quote details are for staff only
  void _quote;
  config = open;
  if (config.pricing.show) return config;
  return {
    ...config,
    rackTypes: config.rackTypes.map((r) => ({ ...r, pricePerUnit: null })),
    pricing: { ...config.pricing, fixed: null, perUnit: null, doorSingle: null, doorDouble: null },
  };
}

/** What the signed-in staff app may read: the whole catalogue and the real prices (whether or not the public tool shows a price). */
function staffView(config) {
  return { rackTypes: config.rackTypes, defaultRackType: config.defaultRackType, doors: config.doors, pricing: config.pricing, quote: config.quote };
}

module.exports = { contrastWithWhite, KEY, LIMITS, ROUND_TO, MAX_PRESETS, MAX_RACK_TYPES, DEFAULTS, validateConfig, publicView, staffView };
