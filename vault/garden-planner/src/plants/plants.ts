import type { AuState, ClimateZone, Frost, Soil } from '../domain/types';
import { PLANT_ROWS } from './plantRows';
import type { Caution, Feature, Form3D, GrowthRate, PlantRecord, PlantType, Sun, Water } from './types';

/** Bump when the dataset changes in a way that matters to saved plans. */
export const DATASET_VERSION = '0.1.0-draft';
const SOURCE = {
  dataset: `starter-${DATASET_VERSION}`,
  note: 'Draft compiled from general horticultural knowledge; not yet verified against ANBG, ALA, state weed lists or nursery sources.',
};

const ZONE: Record<string, ClimateZone> = { T: 'tropical', S: 'subtropical', W: 'warm_temperate', C: 'cool_temperate', A: 'arid', L: 'alpine' };
const SUN: Record<string, Sun> = { F: 'full_sun', P: 'part_shade', S: 'shade' };
const FEATURE: Record<string, Feature> = { B: 'bird', E: 'bee', S: 'screening', D: 'edible', F: 'fragrant', C: 'coastal', P: 'pet_safe' };
const CAUTION: Record<string, Caution> = { T: 'toxic_pets', H: 'toxic_people', K: 'spiky', R: 'invasive_roots' };
const FROST: Frost[] = ['none', 'light', 'moderate', 'heavy'];
const GROWTH: Record<string, GrowthRate> = { s: 'slow', m: 'medium', f: 'fast' };
const WATER: Record<string, Water> = { l: 'low', m: 'medium', h: 'high' };
const SOIL: Record<string, Soil> = { s: 'sandy', l: 'loam', c: 'clay' };
const FORM: Record<string, Form3D> = {
  col: 'columnar', rnd: 'rounded', spr: 'spreading', wee: 'weeping', palm: 'palm', grs: 'clumping_grass', mat: 'groundcover_mat', cli: 'climber',
};

const pick = <T,>(map: Record<string, T>, letters: string): T[] => [...letters].map((c) => map[c]).filter((v): v is T => v !== undefined);
const range = (s: string): [number, number] => {
  const [a, b] = s.split('-').map(Number);
  return [a, b ?? a];
};

/** Months for "9-11" or a wrapping "11-2"; none for "-". */
export function parseMonths(s: string): number[] {
  if (s === '-' || !s) return [];
  const [a, b] = s.split('-').map(Number);
  const out: number[] = [];
  for (let m = a; ; m = m === 12 ? 1 : m + 1) { out.push(m); if (m === b || out.length === 12) break; }
  return out;
}

export const slug = (s: string): string => s.toLowerCase().replace(/['"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function parseRow(row: string): PlantRecord {
  const f = row.split('|');
  if (f.length !== 20) throw new Error(`plant row needs 20 fields, has ${f.length}: ${row.slice(0, 60)}`);
  const [name, common, origin, type, h, s, years, growth, sun, zones, frost, water, soil, months, colours, foliage, features, cautions, weeds, form] = f;
  const cultivarMatch = /'([^']+)'/.exec(name);
  const native = origin.startsWith('N');
  const originStates = native ? origin.slice(2).split(',').filter(Boolean) as AuState[] : [];
  return {
    id: slug(name),
    botanical: name.replace(/\s*'[^']+'/, '').trim(),
    ...(cultivarMatch ? { cultivar: cultivarMatch[1] } : {}),
    common: common.split(';').map((c) => c.trim()).filter(Boolean),
    native, origin: originStates,
    type: type as PlantType,
    height: range(h), spread: range(s), yearsToMature: Number(years),
    growth: GROWTH[growth],
    sun: pick(SUN, sun), zones: pick(ZONE, zones), frost: FROST[Number(frost)],
    water: WATER[water[0]], droughtTolerant: water.includes('d'),
    soils: pick(SOIL, soil.replace('w', '')), tolerantOfPoorDrainage: soil.includes('w'),
    flowerMonths: parseMonths(months),
    flowerColours: colours === '-' ? [] : colours.split(','),
    foliage: foliage[0] === 'd' ? 'deciduous' : 'evergreen', foliageColour: foliage.slice(1),
    features: pick(FEATURE, features), cautions: pick(CAUTION, cautions),
    weedStates: weeds ? (weeds.split(',') as AuState[]) : [],
    weedChecked: [],
    form: FORM[form],
    source: SOURCE,
  };
}

export const PLANTS: readonly PlantRecord[] = PLANT_ROWS.map(parseRow);
const BY_ID = new Map(PLANTS.map((p) => [p.id, p]));
export const plantById = (id: string): PlantRecord | undefined => BY_ID.get(id);

export function plantLabel(p: PlantRecord): string {
  const common = p.common[0];
  return common ?? `${p.botanical}${p.cultivar ? ` '${p.cultivar}'` : ''}`;
}
export const botanicalLabel = (p: PlantRecord): string => `${p.botanical}${p.cultivar ? ` '${p.cultivar}'` : ''}`;
