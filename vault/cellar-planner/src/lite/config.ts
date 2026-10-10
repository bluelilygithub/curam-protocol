// The settings the business owner controls from Vault (Settings -> Cellar Planner): rack unit size, door widths, the price formula, a few words on
// the page and the starting rooms. They are fetched when the tool opens. If that fails for ANY reason the tool carries on with the built-in defaults
// below (and says why in the browser Console), so the public page never breaks because Vault is unreachable.
// The server's copy of these rules is server/config/cellarLiteConfig.js; a test keeps the two in step.

export type StartDoor = 'SINGLE' | 'DOUBLE';
export interface LitePreset { id: string; name: string; widthMm: number; depthMm: number; heightMm: number; doorStyle: StartDoor }
export interface LitePricing {
  show: boolean; currency: string;
  fixed: number | null; perUnit: number | null; doorSingle: number | null; doorDouble: number | null;
  rangePct: number; roundTo: number; note: string;
}
export type RackOrientationId = 'NECK_OUT' | 'LABEL_FORWARD';
/** One kind of rack in the owner's catalogue. null = not set (never zero). `confirmed` = the numbers are the supplier's, not guesses. */
export interface RackType {
  id: string; name: string;
  unitWidthMm: number; unitDepthMm: number | null; unitHeightMm: number; rowPitchMm: number | null;
  orientation: RackOrientationId; postsPerUnit: number | null;
  bottlesPerRow: number | null; bottlesPerRowLabelForward: number | null; rowsPerUnit: number | null;
  pricePerUnit: number | null; confirmed: boolean;
}
/** Who the staff quote PDF is from and the owner's own terms (staff only: the public answer never carries them). */
export interface QuoteSettings { businessName: string; details: string; terms: string; validityDays: number; gstNote: string }
/** The assumptions behind the staff planner's indicative cooling estimate (staff only). See server/config/cellarLiteConfig.js for what each means. */
export interface CoolingSettings { panelConductivity: number; glassU: number; floorU: number; internalGainsW: number; marginPct: number; targetC: number; ambientC: number }
export interface LiteConfig {
  version: 1;
  promise: string;
  /** Shown once the visitor asks for a quote (when we will reply). */
  quoteNote: string;
  /** A number the visitor can tap to call; blank = no call button. */
  phone: string;
  /** Brand colour of buttons and highlights, #rrggbb (dark enough for white text). */
  accent: string;
  /** The catalogue (the staff planner uses all of it; this tool uses the default type) and which type is the default. */
  rackTypes: RackType[];
  defaultRackType: string;
  /** The default type's sizes (kept in this shape for older pages). */
  rack: { unitWidthMm: number; unitHeightMm: number; unitDepthMm?: number; rowPitchMm?: number; postsPerUnit?: number; bottlesPerRow?: number; rowsPerUnit?: number };
  doors: { singleMm: number; doubleMm: number };
  pricing: LitePricing;
  quote: QuoteSettings;
  cooling: CoolingSettings;
  presets: LitePreset[];
}

export const DEFAULT_CONFIG: LiteConfig = {
  version: 1,
  promise: 'Free to use. No sign-up. Takes about two minutes. You only share your details if you ask for a quote.',
  quoteNote: 'We usually reply within one business day.',
  phone: '',
  accent: '#4a5a2a',
  rackTypes: [{
    id: 'standard', name: 'Standard rack', unitWidthMm: 600, unitDepthMm: null, unitHeightMm: 2000, rowPitchMm: null, orientation: 'NECK_OUT', postsPerUnit: null,
    bottlesPerRow: null, bottlesPerRowLabelForward: null, rowsPerUnit: null, pricePerUnit: null, confirmed: false,
  }],
  defaultRackType: 'standard',
  rack: { unitWidthMm: 600, unitHeightMm: 2000 },
  doors: { singleMm: 970, doubleMm: 1500 },
  pricing: {
    show: false, currency: '$', fixed: null, perUnit: null, doorSingle: null, doorDouble: null, rangePct: 15, roundTo: 100,
    note: 'A guide only. The final price depends on a site measure and the finishes you choose.',
  },
  quote: { businessName: '', details: '', terms: '', validityDays: 30, gstNote: '' },
  cooling: { panelConductivity: 0.025, glassU: 1.4, floorU: 1, internalGainsW: 100, marginPct: 20, targetC: 14, ambientC: 35 },
  presets: [
    { id: 'small', name: 'Small cellar', widthMm: 1800, depthMm: 1500, heightMm: 2400, doorStyle: 'SINGLE' },
    { id: 'walk-in', name: 'Walk-in cellar', widthMm: 2750, depthMm: 1565, heightMm: 2150, doorStyle: 'SINGLE' },
    { id: 'large', name: 'Large cellar', widthMm: 4000, depthMm: 3000, heightMm: 2400, doorStyle: 'DOUBLE' },
  ],
};

const R = {
  unitWidthMm: [400, 1200], unitHeightMm: [1000, 3000], unitDepthMm: [150, 1000], rowPitchMm: [60, 300], postsPerUnit: [1, 6], bottlesPerRow: [1, 40], rowsPerUnit: [1, 60], doorSingleMm: [700, 1300], doorDoubleMm: [1200, 2400],
  price: [0, 1000000], rangePct: [0, 50], roomWidthMm: [1000, 8000], roomDepthMm: [1000, 8000], roomHeightMm: [1800, 3200], quoteValidityDays: [1, 365],
  panelConductivity: [0.01, 0.1], glassU: [0.5, 6], floorU: [0.1, 6], internalGainsW: [0, 5000], marginPct: [0, 100], targetC: [0, 25], ambientC: [15, 50],
} as const;
const ROUND_TO = [1, 10, 50, 100, 500, 1000];
const MAX_RACK_TYPES = 8;

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): string => String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** Multi-line text: control characters other than line breaks are removed, each line tidied, blank runs collapsed. */
const multiline = (v: unknown, max: number): string => String(v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
  .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const int = (v: unknown, [lo, hi]: readonly [number, number], fallback: number): number => {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : fallback;
};
const optInt = (v: unknown, lim: readonly [number, number]): number | null => (v === undefined || v === null || v === '' ? null : int(v, lim, NaN) || null);
const decimal = (v: unknown, [lo, hi]: readonly [number, number], fallback: number): number => {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 1000) / 1000 : fallback;
};
const money = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= R.price[0] && n <= R.price[1] ? Math.round(n * 100) / 100 : null;
};

/** WCAG contrast of white text on a #rrggbb colour. */
export function contrastWithWhite(hex: string): number {
  const lin = (c: number): number => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const n = parseInt(hex.slice(1), 16);
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return 1.05 / (L + 0.05);
}
const cleanAccent = (v: unknown): string => {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return /^#[0-9a-f]{6}$/.test(t) && contrastWithWhite(t) >= 4.5 ? t : '#4a5a2a';
};

/** The three colours the page needs from the brand colour: itself, a darker one for pressed/hover and a very light tint for selected backgrounds. */
export function accentColours(accent: string): { main: string; dark: string; soft: string } {
  const n = parseInt(accent.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const hex = (x: number): string => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0');
  return { main: accent, dark: `#${hex(r * 0.78)}${hex(g * 0.78)}${hex(b * 0.78)}`, soft: `#${hex(r + (255 - r) * 0.88)}${hex(g + (255 - g) * 0.88)}${hex(b + (255 - b) * 0.88)}` };
}

const cleanPhone = (v: unknown): string => {
  if (v === undefined || v === null) return '';
  const t = text(v, 24);
  const digits = t.replace(/\D/g, '');
  return t && /^\+?[\d\s().-]+$/.test(t) && digits.length >= 6 && digits.length <= 15 ? t : '';
};

/** What to put after "tel:" so the phone dials it: digits with an optional leading +. */
export const telHref = (phone: string): string => `tel:${(phone.trim().startsWith('+') ? '+' : '') + phone.replace(/\D/g, '')}`;

/** Never trusts what came over the network: anything missing or out of range becomes the default, so the tool can always be built from the result. */
export function normaliseConfig(raw: unknown): LiteConfig {
  const D = DEFAULT_CONFIG;
  const src = isObj(raw) ? raw : {};
  const doors = isObj(src.doors) ? src.doors : {};
  const p = isObj(src.pricing) ? src.pricing : {};
  const q = isObj(src.quote) ? src.quote : {};
  const cl = isObj(src.cooling) ? src.cooling : {};
  const T0 = D.rackTypes[0]!;
  const slug = (t: unknown): string => text(t ?? '', 40).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const parseType = (t: unknown, n: number): RackType | null => {
    if (!isObj(t)) return null;
    const name = text(t.name ?? '', 40);
    if (!name) return null;
    const o = t.orientation === undefined || t.orientation === null || t.orientation === '' ? T0.orientation : t.orientation;
    return {
      id: slug(t.id) || slug(name) || `rack-${n}`, name,
      unitWidthMm: int(t.unitWidthMm, R.unitWidthMm, T0.unitWidthMm), unitDepthMm: optInt(t.unitDepthMm, R.unitDepthMm),
      unitHeightMm: int(t.unitHeightMm, R.unitHeightMm, T0.unitHeightMm), rowPitchMm: optInt(t.rowPitchMm, R.rowPitchMm),
      orientation: o === 'NECK_OUT' || o === 'LABEL_FORWARD' ? o : T0.orientation, postsPerUnit: optInt(t.postsPerUnit, R.postsPerUnit),
      bottlesPerRow: optInt(t.bottlesPerRow, R.bottlesPerRow), bottlesPerRowLabelForward: optInt(t.bottlesPerRowLabelForward, R.bottlesPerRow),
      rowsPerUnit: optInt(t.rowsPerUnit, R.rowsPerUnit), pricePerUnit: money(t.pricePerUnit), confirmed: t.confirmed === true,
    };
  };
  let rawTypes: unknown[];
  if (src.rackTypes === undefined || src.rackTypes === null) {
    const old = isObj(src.rack) ? src.rack : {};
    rawTypes = [{ id: T0.id, name: T0.name, unitWidthMm: old.unitWidthMm, unitHeightMm: old.unitHeightMm, pricePerUnit: p.perUnit }];
  } else rawTypes = Array.isArray(src.rackTypes) ? src.rackTypes : [];
  const rackTypes: RackType[] = [];
  rawTypes.slice(0, MAX_RACK_TYPES).forEach((t, i) => {
    const rt = parseType(t, i + 1);
    if (!rt) return;
    while (rackTypes.some((x) => x.id === rt.id)) rt.id += '-x';
    rackTypes.push(rt);
  });
  if (!rackTypes.length) rackTypes.push({ ...T0 });
  const defaultRackType = typeof src.defaultRackType === 'string' && rackTypes.some((r) => r.id === src.defaultRackType) ? src.defaultRackType : rackTypes[0]!.id;
  const def = rackTypes.find((r) => r.id === defaultRackType)!;
  const rack: LiteConfig['rack'] = { unitWidthMm: def.unitWidthMm, unitHeightMm: def.unitHeightMm };
  if (def.unitDepthMm !== null) rack.unitDepthMm = def.unitDepthMm;
  if (def.rowPitchMm !== null) rack.rowPitchMm = def.rowPitchMm;
  if (def.postsPerUnit !== null) rack.postsPerUnit = def.postsPerUnit;
  if (def.bottlesPerRow !== null) rack.bottlesPerRow = def.bottlesPerRow;
  if (def.rowsPerUnit !== null) rack.rowsPerUnit = def.rowsPerUnit;
  const pricing: LitePricing = {
    show: p.show === true,
    currency: p.currency === undefined ? D.pricing.currency : text(p.currency, 3) || D.pricing.currency,
    fixed: money(p.fixed), perUnit: def.pricePerUnit, doorSingle: money(p.doorSingle), doorDouble: money(p.doorDouble),
    rangePct: int(p.rangePct, R.rangePct, D.pricing.rangePct),
    roundTo: ROUND_TO.includes(Number(p.roundTo)) ? Number(p.roundTo) : D.pricing.roundTo,
    note: p.note === undefined ? D.pricing.note : text(p.note, 300),
  };
  if (pricing.fixed === null && pricing.perUnit === null && pricing.doorSingle === null && pricing.doorDouble === null) pricing.show = false;
  const presets: LitePreset[] = [];
  for (const pr of (Array.isArray(src.presets) ? src.presets : D.presets).slice(0, 6)) {
    if (!isObj(pr)) continue;
    const name = text(pr.name ?? '', 40);
    const widthMm = int(pr.widthMm, R.roomWidthMm, 0), depthMm = int(pr.depthMm, R.roomDepthMm, 0), heightMm = int(pr.heightMm, R.roomHeightMm, 0);
    if (!name || !widthMm || !depthMm || !heightMm) continue;
    let id = slug(pr.id) || slug(name) || `room-${presets.length + 1}`;
    while (presets.some((x) => x.id === id)) id += '-x';
    presets.push({ id, name, widthMm, depthMm, heightMm, doorStyle: pr.doorStyle === 'DOUBLE' ? 'DOUBLE' : 'SINGLE' });
  }
  return {
    version: 1,
    promise: src.promise === undefined ? D.promise : text(src.promise, 200),
    quoteNote: src.quoteNote === undefined ? D.quoteNote : text(src.quoteNote, 200),
    phone: cleanPhone(src.phone),
    accent: cleanAccent(src.accent),
    rackTypes, defaultRackType, rack,
    doors: { singleMm: int(doors.singleMm, R.doorSingleMm, D.doors.singleMm), doubleMm: int(doors.doubleMm, R.doorDoubleMm, D.doors.doubleMm) },
    pricing,
    quote: {
      businessName: q.businessName === undefined ? D.quote.businessName : text(q.businessName, 80),
      details: q.details === undefined ? D.quote.details : multiline(q.details, 300),
      terms: q.terms === undefined ? D.quote.terms : multiline(q.terms, 1200),
      validityDays: int(q.validityDays, R.quoteValidityDays, D.quote.validityDays),
      gstNote: q.gstNote === undefined ? D.quote.gstNote : text(q.gstNote, 120),
    },
    cooling: {
      panelConductivity: decimal(cl.panelConductivity, R.panelConductivity, D.cooling.panelConductivity), glassU: decimal(cl.glassU, R.glassU, D.cooling.glassU),
      floorU: decimal(cl.floorU, R.floorU, D.cooling.floorU), internalGainsW: decimal(cl.internalGainsW, R.internalGainsW, D.cooling.internalGainsW),
      marginPct: decimal(cl.marginPct, R.marginPct, D.cooling.marginPct), targetC: decimal(cl.targetC, R.targetC, D.cooling.targetC), ambientC: decimal(cl.ambientC, R.ambientC, D.cooling.ambientC),
    },
    presets,
  };
}

// ---- where the settings live

/** Vault's own address. The tool is hosted on the business's website, so it asks Vault across the internet; when Vault serves the tool itself it asks its own origin. */
export const VAULT_ORIGIN = 'https://curam-vault.up.railway.app';
const SAVED_KEY = 'cellar-lite:config:v1';
const TIMEOUT_MS = 4000;

/** Where Vault's API lives for this page: its own address when Vault serves the tool, else Vault across the internet. */
export function apiBase(loc: Pick<Location, 'origin' | 'hostname'> = window.location): string {
  return new URL(VAULT_ORIGIN).hostname === loc.hostname ? loc.origin : VAULT_ORIGIN;
}

export function configUrl(loc: Pick<Location, 'origin' | 'hostname'> = window.location): string {
  return `${apiBase(loc)}/api/cellar-lite/config`;
}

export type ConfigSource = 'server' | 'saved' | 'default';
export interface ConfigResult { config: LiteConfig; source: ConfigSource; reason?: string }

const log = (...a: unknown[]): void => { try { console.info('[cellar-lite]', ...a); } catch { /* no console */ } };

/**
 * Fetch the settings. Order of preference: the server's answer (remembered in this browser for next time), else the last answer remembered here,
 * else the built-in defaults. Never throws; every fallback is logged to the Console with its reason.
 */
export async function loadConfig(fetchFn: typeof fetch = fetch, url: string = configUrl()): Promise<ConfigResult> {
  const saved = (): LiteConfig | null => {
    try { const s = localStorage.getItem(SAVED_KEY); return s ? normaliseConfig(JSON.parse(s)) : null; } catch { return null; }
  };
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : undefined;
  try {
    log('loading settings from', url);
    const res = await fetchFn(url, { signal: ctl?.signal, credentials: 'omit', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`the settings address answered ${res.status}`);
    const config = normaliseConfig(await res.json());
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(config)); } catch { /* storage blocked: fine */ }
    log('settings loaded:', { unitWidthMm: config.rack.unitWidthMm, unitHeightMm: config.rack.unitHeightMm, showPrice: config.pricing.show, startingRooms: config.presets.length });
    return { config, source: 'server' };
  } catch (e) {
    const reason = e instanceof Error && e.name === 'AbortError' ? `no answer within ${TIMEOUT_MS / 1000} seconds` : e instanceof Error ? e.message : String(e);
    const old = saved();
    if (old) { log('could not load settings (', reason, ') - using the ones remembered from the last visit'); return { config: old, source: 'saved', reason }; }
    log('could not load settings (', reason, ') - using the built-in defaults. Prices are hidden until the settings load.');
    return { config: DEFAULT_CONFIG, source: 'default', reason };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
