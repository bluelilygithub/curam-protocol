// Checks about where plants stand and whether they suit the site. Sizes are MATURE sizes (you plan for the grown garden), taken from the plant
// record, which is a draft: every message that rests on it carries the "draft, unverified" label.
import { footprintCorners } from '@planner-core/engine/footprints';
import { dist, pointInPolygonInclusive } from '@planner-core/engine/geometry';
import { closestOnPolygon, distToPolyline, fmt } from './geom';
import { withDraftLabel } from './draft';
import type { CheckSettings, Issue } from './types';
import type { GardenProject, PlantInstance, Structure, Vec2 } from '../domain/types';
import { plantSizeAt } from '../plants/growth';
import { plantById, plantLabel } from '../plants/plants';
import { sunLevelForHours, unsuitableReasons, UNSUITABLE_TEXT } from '../plants/suitability';
import type { PlantRecord } from '../plants/types';
import { weedStatus } from '../plants/weeds';

export interface PlantGeom {
  /** Canopy radius at maturity (m). */
  radius: number;
  /** Radius of the trunk or crown base that must never overlap another plant's (m). */
  core: number;
  height: number;
  layer: 'canopy' | 'mid' | 'ground';
  /** A tree or palm (the plants the house, service and sun checks look at). */
  tree: boolean;
}

export interface Placed { inst: PlantInstance; rec: PlantRecord; g: PlantGeom }

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function geomOf(rec: PlantRecord): PlantGeom {
  const { height, spread } = plantSizeAt(rec, 'mature');
  const radius = spread / 2;
  const tree = rec.type === 'tree' || rec.type === 'palm';
  const core = tree ? Math.min(0.3, 0.1 + 0.02 * height) : rec.type === 'shrub' ? 0.15 * radius : 0.1 * radius;
  const layer: PlantGeom['layer'] = tree || height >= 3 ? 'canopy' : height >= 0.8 ? 'mid' : 'ground';
  return { radius, core, height, layer, tree };
}

export function placedPlants(p: GardenProject): Placed[] {
  const out: Placed[] = [];
  for (const inst of p.plants) {
    const rec = plantById(inst.plantId);
    if (rec) out.push({ inst, rec, g: geomOf(rec) });
  }
  return out;
}

const name = (pl: Placed): string => plantLabel(pl.rec);
const spot = (pl: Placed): string => `${name(pl)} at ${fmt(pl.inst.position.x)}, ${fmt(pl.inst.position.y)}`;
const ref = (pl: Placed) => ({ kind: 'plant' as const, id: pl.inst.id });

// ---------------------------------------------------------------- where it stands

/** A plant inside the house, a shed, a deck, a tank, a pool or a retaining wall. */
export function placementIssue(p: GardenProject, pl: Placed): Issue | null {
  const c = pl.inst.position;
  if (p.house && pointInPolygonInclusive(c, p.house.vertices.map((v) => v.position), 0)) {
    return { id: `placement:${pl.inst.id}`, type: 'placement', severity: 'error', title: 'Plant inside the house', message: `${spot(pl)} is inside the house footprint. Move it outside.`, usesPlantData: false, items: [ref(pl)], at: c };
  }
  const solid: Array<Structure['kind']> = ['shed', 'deck', 'water_tank', 'pool', 'retaining_wall'];
  for (const s of p.structures) {
    if (!solid.includes(s.kind)) continue;
    const inside = s.kind === 'water_tank'
      ? dist(c, s.position) <= s.width / 2
      : pointInPolygonInclusive(c, footprintCorners({ position: s.position, width: s.width, length: Math.max(s.length, 0.1), rotation: s.rotation }), 0);
    if (inside) return { id: `placement:${pl.inst.id}`, type: 'placement', severity: 'error', title: `Plant inside a ${s.name.toLowerCase()}`, message: `${spot(pl)} is inside the ${s.name.toLowerCase()}. Move it outside.`, usesPlantData: false, items: [ref(pl), { kind: 'structure', id: s.id }], at: c };
  }
  return null;
}

/** Two plants: trunks and crowns must not overlap; same-layer canopies may overlap a little, not a lot. */
export function spacingIssue(a: Placed, b: Placed): Issue | null {
  const d = dist(a.inst.position, b.inst.position);
  const coreSum = a.g.core + b.g.core;
  const lo = a.inst.id < b.inst.id ? a : b, hi = lo === a ? b : a;
  const id = `spacing:${lo.inst.id}:${hi.inst.id}`;
  const at = { x: (a.inst.position.x + b.inst.position.x) / 2, y: (a.inst.position.y + b.inst.position.y) / 2 };
  if (d < coreSum) {
    return {
      id, type: 'spacing', severity: 'error', title: 'Plants too close', usesPlantData: true, items: [ref(lo), ref(hi)], at,
      message: withDraftLabel(`${name(a)} and ${name(b)} are only ${fmt(d, 2)} m apart, closer than their trunks or crowns will be at maturity (about ${fmt(coreSum, 2)} m). One of them has to move.`),
    };
  }
  if (a.g.layer === b.g.layer) {
    const need = 0.6 * (a.g.radius + b.g.radius);
    if (d < need) {
      const overlap = Math.round((1 - d / (a.g.radius + b.g.radius)) * 100);
      return {
        id, type: 'spacing', severity: 'warning', title: 'Plants will crowd each other', usesPlantData: true, items: [ref(lo), ref(hi)], at,
        message: withDraftLabel(`${name(a)} and ${name(b)} will crowd each other at maturity: their centres are ${fmt(d, 2)} m apart and they need about ${fmt(need, 1)} m (their canopies would overlap by ${overlap}%).`),
      };
    }
  }
  return null;
}

/** A canopy that hangs over the boundary into the neighbour's yard. */
export function boundaryIssue(p: GardenProject, pl: Placed): Issue | null {
  if (!p.boundary || pl.g.height < 0.5) return null;
  const poly = p.boundary.vertices.map((v) => v.position);
  const c = closestOnPolygon(pl.inst.position, poly);
  const base = { id: `boundary:${pl.inst.id}`, type: 'boundary' as const, usesPlantData: true, items: [ref(pl)], at: pl.inst.position };
  if (!c.inside) return { ...base, severity: 'error', title: 'Plant outside the boundary', message: `${spot(pl)} is outside your boundary, in the neighbour's yard.` , usesPlantData: false };
  const overhang = pl.g.radius - c.dist;
  if (overhang > 0.25) {
    const trunkOver = c.dist < pl.g.core;
    return {
      ...base, severity: trunkOver ? 'error' : 'warning', title: 'Canopy over the boundary',
      message: withDraftLabel(`${spot(pl)} will overhang the boundary by ${fmt(overhang, 1)} m at maturity (canopy about ${fmt(pl.g.radius, 1)} m from its centre, ${fmt(c.dist, 1)} m from the boundary), into the neighbour's yard.`),
    };
  }
  return null;
}

/** Trees (and plants flagged for invasive roots) near the house. */
export function houseIssue(p: GardenProject, pl: Placed): Issue | null {
  if (!p.house || p.house.vertices.length < 3) return null;
  const roots = pl.rec.cautions.includes('invasive_roots');
  if (!pl.g.tree && !(roots && pl.g.height >= 1.5)) return null;
  const c = closestOnPolygon(pl.inst.position, p.house.vertices.map((v) => v.position));
  if (c.inside) return null; // reported as "plant inside the house"
  const H = pl.g.height;
  const need = roots ? clamp(H, 3, 10) : clamp(0.5 * H, 2, 5);
  if (c.dist >= need) return null;
  return {
    id: `house_distance:${pl.inst.id}`, type: 'house_distance', severity: roots ? 'error' : 'warning', title: roots ? 'Invasive roots too close to the house' : 'Tree too close to the house', usesPlantData: true, items: [ref(pl)], at: pl.inst.position,
    message: withDraftLabel(`${spot(pl)} is ${fmt(c.dist, 1)} m from the house. At maturity it will be about ${fmt(H, 1)} m tall${roots ? ' with roots flagged as invasive' : ''}, and needs about ${fmt(need, 1)} m clear of the walls.`),
  };
}

/** Trees and invasive roots near pipes, and big plants inside easements. */
export function serviceIssues(p: GardenProject, pl: Placed): Issue[] {
  const out: Issue[] = [];
  const roots = pl.rec.cautions.includes('invasive_roots');
  const H = pl.g.height;
  for (const s of p.services) {
    if (s.points.length < 2) continue;
    const d = distToPolyline(pl.inst.position, s.points);
    if (s.kind === 'easement') {
      if ((pl.g.tree || H >= 1.5 || roots) && d < s.width / 2) {
        out.push({
          id: `service_distance:${pl.inst.id}:${s.id}`, type: 'service_distance', severity: 'error', title: 'Plant in an easement', usesPlantData: true, items: [ref(pl), { kind: 'service', id: s.id }], at: pl.inst.position,
          message: withDraftLabel(`${spot(pl)} is inside "${s.name}". Trees and large plants are not allowed in an easement (it will be about ${fmt(H, 1)} m tall).`),
        });
      }
      continue;
    }
    const need = roots ? clamp(H, 3, 8) : pl.g.tree ? clamp(0.4 * H, 1.5, 4) : 0;
    if (need > 0 && d < need) {
      out.push({
        id: `service_distance:${pl.inst.id}:${s.id}`, type: 'service_distance', severity: roots ? 'error' : 'warning', title: `Roots near the ${s.kind} line`, usesPlantData: true, items: [ref(pl), { kind: 'service', id: s.id }], at: pl.inst.position,
        message: withDraftLabel(`${spot(pl)} is ${fmt(d, 1)} m from "${s.name}". At maturity it will be about ${fmt(H, 1)} m tall${roots ? ' with roots flagged as invasive' : ''}, and its roots need about ${fmt(need, 1)} m clear of the pipe.`),
      });
    }
  }
  return out;
}

/** Every position-dependent issue for one plant: what "Fix position" must avoid. */
export function positionIssues(p: GardenProject, pl: Placed, others: Placed[]): Issue[] {
  const out: Issue[] = [];
  const placement = placementIssue(p, pl);
  if (placement) out.push(placement);
  for (const o of others) {
    if (o.inst.id === pl.inst.id) continue;
    const s = spacingIssue(pl, o);
    if (s) out.push(s);
  }
  for (const f of [boundaryIssue(p, pl), houseIssue(p, pl)]) if (f) out.push(f);
  out.push(...serviceIssues(p, pl));
  return out;
}

// ---------------------------------------------------------------- does it suit the site

/** Mean sun hours a plant gets at its spot, from the sun-hours maps. Trees are measured without their own shade. */
export type SunLookup = (pos: Vec2, isTree: boolean) => number | null;

export function sunIssue(pl: Placed, sun: SunLookup, s: CheckSettings): Issue | null {
  const hours = sun(pl.inst.position, pl.g.tree);
  if (hours === null) return null;
  const level = sunLevelForHours(hours, s.sun);
  if (pl.rec.sun.includes(level)) return null;
  const word = { full_sun: 'full sun', part_shade: 'part shade', shade: 'shade' } as const;
  const rank = { shade: 0, part_shade: 1, full_sun: 2 } as const;
  const ranks = pl.rec.sun.map((x) => rank[x]);
  const needsMore = rank[level] < Math.min(...ranks); // the spot is darker than anything the plant accepts
  const likes = pl.rec.sun.map((x) => word[x]).join(' or ');
  return {
    id: `sun:${pl.inst.id}`, type: 'sun', severity: 'warning', title: needsMore ? 'Not enough sun' : 'Too much sun', usesPlantData: true, items: [ref(pl)], at: pl.inst.position,
    message: withDraftLabel(`${spot(pl)} likes ${likes}, but this spot gets about ${fmt(hours, 1)} h of direct sun a day on average across the seasons (${word[level]}, by your ${s.sun.fullSunHours} h and ${s.sun.partShadeHours} h settings). ${needsMore ? 'Try a sunnier spot.' : 'Try a shadier spot.'}`),
  };
}

/** Species-level checks: climate, frost, weed, pets. One issue per species, listing how many plants. */
export function speciesIssues(p: GardenProject, plants: Placed[]): Issue[] {
  const bySpecies = new Map<string, Placed[]>();
  for (const pl of plants) bySpecies.set(pl.rec.id, [...(bySpecies.get(pl.rec.id) ?? []), pl]);
  const site = { zone: p.climateZone, frost: p.frost, state: p.location.state };
  const out: Issue[] = [];
  const unknownWeeds: PlantRecord[] = [];
  for (const [, list] of bySpecies) {
    const rec = list[0].rec;
    const items = list.map(ref);
    const at = list[0].inst.position;
    const many = list.length > 1 ? ` (${list.length} plants)` : '';
    const reasons = unsuitableReasons(rec, site);
    if (reasons.includes('climate')) {
      out.push({ id: `climate:${rec.id}`, type: 'climate', severity: 'warning', title: 'Not suited to your climate', usesPlantData: true, items, at, message: withDraftLabel(`${UNSUITABLE_TEXT.climate(rec, site)}${many} It is listed for ${rec.zones.map((z) => z.replace('_', ' ')).join(', ')}.`) });
    }
    if (reasons.includes('frost')) {
      out.push({ id: `frost:${rec.id}`, type: 'frost', severity: 'warning', title: 'Frost will damage it', usesPlantData: true, items, at, message: withDraftLabel(`${UNSUITABLE_TEXT.frost(rec, site)}${many} Your garden is set to ${p.frost} frost.`) });
    }
    const status = weedStatus(rec, p.location.state);
    if (status === 'listed') {
      out.push({ id: `weed:${rec.id}`, type: 'weed', severity: 'error', title: 'Listed as a weed', usesPlantData: true, items, at, message: withDraftLabel(`${plantLabel(rec)}${many} is listed as a weed in ${p.location.state}. Weed lists change, so check the current ${p.location.state} list before keeping it.`) });
    } else if (status === 'unknown') {
      unknownWeeds.push(rec);
    }
    if (p.pets && rec.cautions.includes('toxic_pets')) {
      out.push({ id: `pets:${rec.id}`, type: 'pets', severity: 'warning', title: 'Toxic to pets', usesPlantData: true, items, at, message: withDraftLabel(`${plantLabel(rec)}${many} is flagged as toxic to pets. Pets are switched on for this garden. A plant that is not flagged is not confirmed safe.`) });
    }
  }
  if (unknownWeeds.length) {
    const names = unknownWeeds.map(plantLabel).sort();
    const shown = names.slice(0, 8).join(', ') + (names.length > 8 ? `, and ${names.length - 8} more` : '');
    const items = plants.filter((pl) => unknownWeeds.includes(pl.rec)).map(ref);
    out.push({
      id: 'weed_unknown', type: 'weed_unknown', severity: 'info', title: `Weed status unknown for ${names.length} plant${names.length === 1 ? '' : 's'}`, usesPlantData: true, items, at: plants.find((pl) => unknownWeeds.includes(pl.rec))?.inst.position,
      message: withDraftLabel(`${shown}: none of these has been checked against the ${p.location.state} weed list, so their weed status is unknown, not "not a weed". Check the current ${p.location.state} list before relying on them.`),
    });
  }
  return out;
}
