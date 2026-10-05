// Building commands for the things the user does: draw, move, edit, delete, fill a bed. Pure: project in, command out.
import { pointInPolygonInclusive } from '@planner-core/engine/geometry';
import { setItem, type Command } from './commands';
import { sampleShape, shapeBounds } from './shapes';
import {
  FENCE_HEIGHT, type Bed, type Boundary, type CollectionName, type Collections, type FenceType, type GardenProject, type House, type Lawn,
  type PathItem, type PlantInstance, type ServiceKind, type ServiceLine, type Shape, type Structure, type StructureKind, type Vec2, type Zone,
} from './types';
import type { ItemKind, Selection } from '../state/uiStore';
import { mid } from '../plants/growth';
import { plantById } from '../plants/plants';

export interface Defaults { width: number; length: number; height: number; name: string }
export const STRUCTURE_DEFAULTS: Record<StructureKind, Defaults> = {
  pergola: { width: 3.6, length: 3.6, height: 2.7, name: 'Pergola' },
  shed: { width: 2.4, length: 1.8, height: 2.2, name: 'Shed' },
  deck: { width: 4, length: 3, height: 0.35, name: 'Deck' },
  raised_bed: { width: 2.4, length: 1.2, height: 0.45, name: 'Raised garden bed' },
  water_tank: { width: 2.2, length: 2.2, height: 2.4, name: 'Water tank' },
  clothesline: { width: 2.2, length: 2.2, height: 1.8, name: 'Clothesline' },
  pool: { width: 6, length: 3, height: 0, name: 'Pool' },
  retaining_wall: { width: 4, length: 0.3, height: 0.6, name: 'Retaining wall' },
  trellis: { width: 1.8, length: 0.1, height: 1.8, name: 'Trellis' },
  gate: { width: 0.9, length: 0.1, height: 1.5, name: 'Gate' },
};
export const STRUCTURE_LABEL: Record<StructureKind, string> = {
  pergola: 'Pergola', shed: 'Shed', deck: 'Deck', raised_bed: 'Raised bed', water_tank: 'Water tank', clothesline: 'Clothesline',
  pool: 'Pool', retaining_wall: 'Retaining wall', trellis: 'Trellis', gate: 'Gate',
};

type Ids = () => string;

export const shapeOf = (pts: Vec2[], smooth: boolean): Shape => ({ points: pts.map((p) => ({ ...p })), smooth });

export function addBed(pts: Vec2[], smooth: boolean, newId: Ids, n: number): Command {
  const bed: Bed = { id: newId(), name: `Bed ${n}`, shape: shapeOf(pts, smooth), edging: 'timber', mulch: 'bark', raised: false };
  return setItem('beds', bed.id, null, bed);
}
export function addLawn(pts: Vec2[], smooth: boolean, newId: Ids, n: number): Command {
  const lawn: Lawn = { id: newId(), name: `Lawn ${n}`, shape: shapeOf(pts, smooth), grass: 'buffalo' };
  return setItem('lawns', lawn.id, null, lawn);
}
export function addZone(pts: Vec2[], newId: Ids, n: number): Command {
  const zone: Zone = { id: newId(), name: `Zone ${n}`, kind: 'other', shape: shapeOf(pts, false) };
  return setItem('zones', zone.id, null, zone);
}
export function addPath(pts: Vec2[], newId: Ids, n: number): Command {
  const path: PathItem = { id: newId(), name: `Path ${n}`, points: pts.map((p) => ({ ...p })), width: 1, material: 'pavers' };
  return setItem('paths', path.id, null, path);
}
export function addService(pts: Vec2[], kind: ServiceKind, newId: Ids, n: number): Command {
  const name = kind === 'easement' ? `Easement ${n}` : `${kind[0].toUpperCase()}${kind.slice(1)} line ${n}`;
  const s: ServiceLine = { id: newId(), name, kind, points: pts.map((p) => ({ ...p })), width: kind === 'easement' ? 3 : 0.3 };
  return setItem('services', s.id, null, s);
}
export function addStructure(kind: StructureKind, at: Vec2, newId: Ids): Command {
  const d = STRUCTURE_DEFAULTS[kind];
  const s: Structure = { id: newId(), kind, name: d.name, position: { ...at }, width: d.width, length: d.length, height: d.height, rotation: 0, ...(kind === 'gate' ? { swing: 1 as const } : {}) };
  return setItem('structures', s.id, null, s);
}
export function addPlant(plantId: string, at: Vec2, newId: Ids): Command {
  const p: PlantInstance = { id: newId(), plantId, position: { ...at } };
  return setItem('plants', p.id, null, p);
}

export function setBoundaryCmd(p: GardenProject, b: Boundary | null): Command {
  return { type: 'SetSingleton', name: 'boundary', from: p.boundary, to: b };
}
export function setHouseCmd(p: GardenProject, h: House | null): Command {
  return { type: 'SetSingleton', name: 'house', from: p.house, to: h };
}

export function newHouse(pts: Vec2[], newId: Ids): House {
  return { id: newId(), vertices: pts.map((position) => ({ id: newId(), position })), height: 3, fixtures: [] };
}

// ---------------------------------------------------------------- finding and changing items

export function findItem(p: GardenProject, sel: Selection): unknown {
  switch (sel.kind) {
    case 'boundary': return p.boundary;
    case 'house': return p.house;
    default: return (p[collectionOf(sel.kind)] as Array<{ id: string }>).find((x) => x.id === sel.id);
  }
}

export function collectionOf(kind: Exclude<ItemKind, 'boundary' | 'house'>): CollectionName {
  return ({ zone: 'zones', bed: 'beds', path: 'paths', service: 'services', lawn: 'lawns', structure: 'structures', plant: 'plants' } as const)[kind];
}

/** A command that replaces the selected item with `next` (any item type). */
export function replaceItem(p: GardenProject, sel: Selection, next: unknown): Command | null {
  const cur = findItem(p, sel);
  if (!cur) return null;
  if (sel.kind === 'boundary') return { type: 'SetSingleton', name: 'boundary', from: cur, to: next };
  if (sel.kind === 'house') return { type: 'SetSingleton', name: 'house', from: cur, to: next };
  const c = collectionOf(sel.kind);
  return setItem(c, sel.id, cur as Collections[typeof c], next as Collections[typeof c]);
}

export function deleteItem(p: GardenProject, sel: Selection): Command | null {
  const cur = findItem(p, sel);
  if (!cur) return null;
  if (sel.kind === 'boundary' || sel.kind === 'house') return replaceItem(p, sel, null);
  const c = collectionOf(sel.kind);
  return setItem(c, sel.id, cur as Collections[typeof c], null);
}

const shift = (v: Vec2, dx: number, dy: number): Vec2 => ({ x: v.x + dx, y: v.y + dy });

/** The item moved by (dx, dy). */
export function translated(item: unknown, kind: ItemKind, dx: number, dy: number): unknown {
  switch (kind) {
    case 'boundary': { const b = item as Boundary; return { ...b, vertices: b.vertices.map((v) => ({ ...v, position: shift(v.position, dx, dy) })) }; }
    case 'house': { const h = item as House; return { ...h, vertices: h.vertices.map((v) => ({ ...v, position: shift(v.position, dx, dy) })) }; }
    case 'zone': case 'bed': case 'lawn': { const s = item as Bed; return { ...s, shape: { ...s.shape, points: s.shape.points.map((q) => shift(q, dx, dy)) } }; }
    case 'path': case 'service': { const pa = item as PathItem; return { ...pa, points: pa.points.map((q) => shift(q, dx, dy)) }; }
    case 'structure': case 'plant': { const s = item as Structure; return { ...s, position: shift(s.position, dx, dy) }; }
  }
}

/** Number of draggable corner points an item has, and the item with point `i` moved to `to`. */
export function vertexCount(item: unknown, kind: ItemKind): number {
  switch (kind) {
    case 'boundary': case 'house': return (item as Boundary).vertices.length;
    case 'zone': case 'bed': case 'lawn': return (item as Bed).shape.points.length;
    case 'path': case 'service': return (item as PathItem).points.length;
    default: return 0;
  }
}
export function vertexAt(item: unknown, kind: ItemKind, i: number): Vec2 {
  switch (kind) {
    case 'boundary': case 'house': return (item as Boundary).vertices[i].position;
    case 'zone': case 'bed': case 'lawn': return (item as Bed).shape.points[i];
    default: return (item as PathItem).points[i];
  }
}
export function withVertex(item: unknown, kind: ItemKind, i: number, to: Vec2): unknown {
  switch (kind) {
    case 'boundary': { const b = item as Boundary; return { ...b, vertices: b.vertices.map((v, k) => (k === i ? { ...v, position: to } : v)) }; }
    case 'house': { const h = item as House; return { ...h, vertices: h.vertices.map((v, k) => (k === i ? { ...v, position: to } : v)) }; }
    case 'zone': case 'bed': case 'lawn': { const s = item as Bed; return { ...s, shape: { ...s.shape, points: s.shape.points.map((q, k) => (k === i ? to : q)) } }; }
    case 'path': case 'service': { const pa = item as PathItem; return { ...pa, points: pa.points.map((q, k) => (k === i ? to : q)) }; }
    default: return item;
  }
}

export function setFence(b: Boundary, index: number | 'all', fence: FenceType): Boundary {
  return { ...b, segments: b.segments.map((s, i) => (index === 'all' || i === index ? { fence, height: FENCE_HEIGHT[fence] } : s)) };
}

// ---------------------------------------------------------------- fill a bed

/** Recommended spacing between plants of this species: a little less than the mature spread (some canopy overlap is fine). */
export function recommendedSpacing(plantId: string): number {
  const p = plantById(plantId);
  return p ? Math.max(0.15, mid(p.spread) * 0.85) : 0.6;
}

/** "Fill this bed with X": a staggered grid of plants at the recommended spacing, kept `spacing / 2` inside the bed edge. */
export function fillBedCommand(p: GardenProject, bedId: string, plantId: string, newId: Ids): Command | null {
  const bed = p.beds.find((b) => b.id === bedId);
  if (!bed) return null;
  const spacing = recommendedSpacing(plantId);
  const poly = sampleShape(bed.shape);
  const box = shapeBounds(bed.shape);
  const rowH = spacing * 0.87;
  const margin = Math.min(spacing / 2, 0.3);
  const cmds: Command[] = [];
  let row = 0;
  for (let y = box.min.y + margin; y <= box.max.y - margin + 1e-9; y += rowH, row++) {
    const x0 = box.min.x + margin + (row % 2 ? spacing / 2 : 0);
    for (let x = x0; x <= box.max.x - margin + 1e-9; x += spacing) {
      const at = { x, y };
      if (insetInside(poly, at, margin)) cmds.push(addPlant(plantId, at, newId));
    }
  }
  return cmds.length ? { type: 'Composite', commands: cmds } : null;
}

function insetInside(poly: Vec2[], at: Vec2, margin: number): boolean {
  if (!pointInPolygonInclusive(at, poly)) return false;
  // a point is "inside enough" when four points `margin` away on the axes are inside too
  return [{ x: margin, y: 0 }, { x: -margin, y: 0 }, { x: 0, y: margin }, { x: 0, y: -margin }]
    .every((d) => pointInPolygonInclusive({ x: at.x + d.x, y: at.y + d.y }, poly));
}
