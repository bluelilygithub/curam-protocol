import { createStore, type StoreApi } from 'zustand/vanilla';
import { readVaultToken, type ReadableStorage } from '@planner-core/library/library';
import { normaliseConfig, type CoolingSettings, type LitePricing, type QuoteSettings, type RackType } from '../lite/config';
import type { RackSpec } from '../rack';
import { ESTIMATE_FIELDS, type AppProject } from './model';

// The rack CATALOGUE the owner keeps in Vault (Settings -> Cellar Planner -> Rack types). The public lite tool reads the default type; this staff planner
// reads all of it, plus the real prices, from the signed-in endpoint /api/cellar-planner/catalogue. Choosing a type copies its numbers into the design
// (the design stays self-contained: a later catalogue change never silently changes a saved design). A type that is not "confirmed by supplier" keeps its
// values marked ESTIMATED until the person types over them.

export interface Catalogue {
  rackTypes: RackType[];
  defaultRackType: string;
  doors: { singleMm: number; doubleMm: number };
  pricing: LitePricing;
  /** Who the staff quote is from and the owner's terms. */
  quote: QuoteSettings;
  /** The assumptions behind the indicative cooling estimate. */
  cooling: CoolingSettings;
}

export const CATALOGUE_URL = '/api/cellar-planner/catalogue';
export const CATALOGUE_SAVED_KEY = 'cellar-planner:catalogue:v1';

/** Never trusts the network: the lite tool's own validator cleans the values (anything invalid becomes the default or "not set"). null = not a catalogue at all. */
export function parseCatalogue(raw: unknown): Catalogue | null {
  const o = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const c = o && o.catalogue !== null && typeof o.catalogue === 'object' ? (o.catalogue as Record<string, unknown>) : o;
  if (!c || !Array.isArray(c.rackTypes) || c.rackTypes.length === 0) return null;
  const cfg = normaliseConfig({ rackTypes: c.rackTypes, defaultRackType: c.defaultRackType, doors: c.doors, pricing: c.pricing, quote: c.quote, cooling: c.cooling });
  return { rackTypes: cfg.rackTypes, defaultRackType: cfg.defaultRackType, doors: cfg.doors, pricing: cfg.pricing, quote: cfg.quote, cooling: cfg.cooling };
}

export const typeById = (c: Catalogue | null, id: string | undefined): RackType | null => (c && id ? c.rackTypes.find((r) => r.id === id) ?? null : null);
export const defaultType = (c: Catalogue | null): RackType | null => (c ? typeById(c, c.defaultRackType) ?? c.rackTypes[0] ?? null : null);

export const rackSpecFromType = (t: RackType): RackSpec => ({
  unitWidthMm: t.unitWidthMm, unitDepthMm: t.unitDepthMm, unitHeightMm: t.unitHeightMm, rowPitchMm: t.rowPitchMm,
  bottlesPerRow: t.bottlesPerRow, bottlesPerRowLabelForward: t.bottlesPerRowLabelForward, orientation: t.orientation,
  postsPerUnit: t.postsPerUnit, rowsPerUnit: t.rowsPerUnit,
});

/**
 * Put a catalogue type into a design. Confirmed type: its values are the supplier's, nothing is marked estimated. Unconfirmed type: every value it
 * does have is marked estimated (blanks stay "not set", never filled in silently). Runs and the enclosure are untouched.
 */
export function applyRackType(p: AppProject, t: RackType): AppProject {
  const rackSpec = rackSpecFromType(t);
  const estimated = t.confirmed ? [] : ESTIMATE_FIELDS.filter((k) => rackSpec[k] !== null && rackSpec[k] !== undefined);
  return { ...p, rackSpec, rackType: { id: t.id, name: t.name, confirmed: t.confirmed }, estimated };
}

/** Do the design's rack values still equal the catalogue type's (so "Standard 600" really is Standard 600)? */
export function matchesType(p: AppProject, t: RackType): boolean {
  const want = rackSpecFromType(t);
  const have = p.rackSpec;
  return (Object.keys(want) as Array<keyof RackSpec>).every((k) => (have[k] ?? null) === (want[k] ?? null));
}

// ---------------------------------------------------------------- the staff price

export interface PriceLine { label: string; detail: string; amount: number }
export type StaffPrice =
  | { status: 'OK'; lines: PriceLine[]; total: number; low: number; high: number; text: string; currency: string; warnings: string[] }
  | { status: 'UNAVAILABLE'; reason: string };

/**
 * The full price breakdown for staff: fixed amount + (the design's rack type price per unit x total units) + the door price, then the range the
 * customer would be shown. Unlike the public tool this is shown whether or not the public price is switched on. A price is never invented: no
 * catalogue, an unknown rack type or no amounts at all gives UNAVAILABLE with the reason.
 */
export function staffPrice(p: AppProject, cat: Catalogue | null, opts: { errors?: number } = {}): StaffPrice {
  if (!cat) return { status: 'UNAVAILABLE', reason: 'The rack catalogue could not be loaded, so there are no prices. Sign in to Vault and reload.' };
  if (!p.rackType) return { status: 'UNAVAILABLE', reason: 'Choose a rack type (Rack specification) to price this design.' };
  const t = typeById(cat, p.rackType.id);
  if (!t) return { status: 'UNAVAILABLE', reason: `The rack type "${p.rackType.name}" is no longer in the catalogue. Choose another.` };
  const units = p.runs.reduce((n, r) => n + (Number.isFinite(r.units) && r.units > 0 ? Math.floor(r.units) : 0), 0);
  if (units <= 0) return { status: 'UNAVAILABLE', reason: 'Place some racks to get a price.' };
  const pr = cat.pricing;
  const double = p.enclosure.door.leaves === 2;
  const doorPrice = double ? pr.doorDouble : pr.doorSingle;
  if (pr.fixed === null && t.pricePerUnit === null && doorPrice === null) return { status: 'UNAVAILABLE', reason: 'No prices have been entered in Settings -> Cellar Planner.' };
  const fmt = (n: number): string => `${pr.currency}${n.toLocaleString('en-AU')}`;
  const lines: PriceLine[] = [];
  if (pr.fixed !== null) lines.push({ label: 'Fixed amount', detail: 'every job', amount: pr.fixed });
  if (t.pricePerUnit !== null) lines.push({ label: `${t.name} racks`, detail: `${units} unit${units === 1 ? '' : 's'} x ${fmt(t.pricePerUnit)}`, amount: Math.round(units * t.pricePerUnit * 100) / 100 });
  if (doorPrice !== null) lines.push({ label: double ? 'Double door' : 'Single door', detail: '', amount: doorPrice });
  const total = Math.round(lines.reduce((n, l) => n + l.amount, 0) * 100) / 100;
  const step = pr.roundTo, spread = pr.rangePct / 100;
  const round = (n: number): number => Math.round(n / step) * step;
  const low = Math.max(0, round(total * (1 - spread))), high = Math.max(low, round(total * (1 + spread)));
  const warnings: string[] = [];
  if (t.pricePerUnit === null) warnings.push(`${t.name} has no price per unit, so the racks are not in this total.`);
  if (!t.confirmed) warnings.push(`${t.name} is not confirmed by the supplier: this price is indicative only.`);
  if (opts.errors && opts.errors > 0) {
    const one = opts.errors === 1;
    warnings.push(`${opts.errors} check${one ? '' : 's'} in this design ${one ? 'shows' : 'show'} an error: fix ${one ? 'it' : 'them'} before relying on this price.`);
  }
  return { status: 'OK', lines, total, low, high, text: low === high ? `about ${fmt(low)}` : `${fmt(low)} to ${fmt(high)}`, currency: pr.currency, warnings };
}

// ---------------------------------------------------------------- loading it

export type CatalogueStatus = 'idle' | 'loading' | 'server' | 'saved' | 'unavailable';
export interface CatalogueState {
  catalogue: Catalogue | null;
  status: CatalogueStatus;
  /** Why it could not be loaded (plain words). */
  reason: string;
  load(fetchFn: ((url: string, init?: RequestInit) => Promise<Response>) | undefined, storage: ReadableStorage & { setItem(k: string, v: string): void }): Promise<void>;
}
export type CatalogueStore = StoreApi<CatalogueState>;

const log = (...a: unknown[]): void => { try { console.info('[cellar-catalogue]', ...a); } catch { /* no console */ } };

/**
 * Loads the catalogue once the app opens. Order: Vault's answer (remembered in this browser), else the last answer remembered here, else nothing
 * (rack types then cannot be chosen and prices are unavailable; the design itself still works). Never throws; every fallback is logged with its reason.
 */
export function createCatalogueStore(): CatalogueStore {
  return createStore<CatalogueState>((set) => ({
    catalogue: null, status: 'idle', reason: '',
    async load(fetchFn, storage) {
      set({ status: 'loading', reason: '' });
      const fallback = (reason: string): void => {
        let saved: Catalogue | null = null;
        try { const t = storage.getItem(CATALOGUE_SAVED_KEY); saved = t ? parseCatalogue(JSON.parse(t)) : null; } catch { saved = null; }
        if (saved) { log('could not load the catalogue (', reason, ') - using the one remembered from the last visit'); set({ catalogue: saved, status: 'saved', reason }); }
        else { log('could not load the catalogue (', reason, ') - rack types and prices are unavailable'); set({ catalogue: null, status: 'unavailable', reason }); }
      };
      const token = readVaultToken(storage);
      if (!fetchFn) return fallback('this browser cannot make the request');
      if (!token) return fallback('you are not signed in to Vault');
      try {
        log('loading the rack catalogue from', CATALOGUE_URL);
        const res = await fetchFn(CATALOGUE_URL, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
        if (!res.ok) return fallback(res.status === 403 ? 'your Vault account does not have the Cellar Planner feature' : `Vault answered ${res.status}`);
        const body: unknown = await res.json();
        const catalogue = parseCatalogue(body);
        if (!catalogue) return fallback('Vault sent something that is not a rack catalogue');
        try { storage.setItem(CATALOGUE_SAVED_KEY, JSON.stringify(body)); } catch { /* storage blocked: fine */ }
        log('catalogue loaded:', catalogue.rackTypes.map((r) => `${r.name}${r.confirmed ? ' (confirmed)' : ''}`).join(', '), '| default:', catalogue.defaultRackType);
        set({ catalogue, status: 'server', reason: '' });
      } catch (e) {
        fallback(e instanceof Error ? e.message : String(e));
      }
    },
  }));
}

// ---------------------------------------------------------------- what choosing a rack type changed

const SPEC_FIELD_NAMES: Array<[keyof RackSpec, string]> = [
  ['unitWidthMm', 'unit width'], ['unitDepthMm', 'unit depth'], ['unitHeightMm', 'unit height'], ['rowPitchMm', 'row pitch'], ['rowsPerUnit', 'rows per unit'],
  ['bottlesPerRow', 'bottles per row'], ['bottlesPerRowLabelForward', 'bottles per row (label-forward)'], ['orientation', 'bottle orientation'], ['postsPerUnit', 'posts per unit'],
];
const specValue = (v: unknown): string => (v === null || v === undefined ? 'not set' : v === 'NECK_OUT' ? 'neck-out' : v === 'LABEL_FORWARD' ? 'label-forward' : String(v));

/** Plain words on what choosing a rack type changed in the design's rack values: each value that moved, from and to. */
export function describeRackChange(before: AppProject, after: AppProject): string {
  const name = after.rackType?.name ?? 'the rack type';
  const moves: string[] = [];
  for (const [k, label] of SPEC_FIELD_NAMES) {
    const a = before.rackSpec[k] ?? null, b = after.rackSpec[k] ?? null;
    if (a !== b) moves.push(`${label} ${specValue(a)} → ${specValue(b)}`);
  }
  const est = after.estimated?.length ? ` ${after.estimated.length} value${after.estimated.length === 1 ? ' is' : 's are'} marked estimated because it is not confirmed by the supplier.` : '';
  return moves.length ? `Applied "${name}": ${moves.join(', ')}.${est} Undo takes it back.` : `Applied "${name}": the rack values were already the same.${est}`;
}
