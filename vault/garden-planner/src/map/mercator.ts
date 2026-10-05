// Web-mercator map maths for the satellite underlay. Pure: no Konva, no network.
//
// The plan is in metres with its own axes; the map is north-up. They meet at one anchor: the point of the earth (lat, lng) that sits at plan
// position (0, 0), and the garden's `northDeg` (the way north points on the plan, clockwise from plan-up). That is enough, because a garden
// is tiny compared with the earth: east/north metres convert to degrees with one cosine at the anchor.
//
// Plan axes: +x right, +y up. Screen: +x right, +y DOWN. North on the plan points at `northDeg` clockwise from up, so
//   north = (sin t, cos t), east = (cos t, -sin t)   (both in plan axes)
// and a tile's pixels (right = east, down = south) land on the screen turned clockwise by `northDeg`: that is the Konva rotation.
import type { View } from '@planner-core/adapters/canvas';

export const TILE = 256;
const EARTH = 156543.03392804097; // metres per pixel at zoom 0 on the equator
const M_PER_DEG = 111320;
const RAD = Math.PI / 180;

export interface LatLng { lat: number; lng: number }
export interface TileRef { z: number; x: number; y: number; px: number; py: number }

/** Ground metres per tile pixel at this zoom and latitude. */
export const metresPerPixel = (z: number, lat: number): number => (EARTH * Math.cos(lat * RAD)) / 2 ** z;

/** Global pixel position of a point at zoom z (x east, y south). */
export function toPixel(p: LatLng, z: number): { x: number; y: number } {
  const n = TILE * 2 ** z;
  const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, p.lat)) * RAD);
  return { x: ((p.lng + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

/** Which zoom draws about one tile pixel per screen pixel at this plan scale (px per metre), kept inside what the provider has. */
export function chooseZoom(viewScale: number, lat: number, maxZoom: number): number {
  const z = Math.round(Math.log2(EARTH * Math.cos(lat * RAD) * viewScale));
  return Math.max(1, Math.min(maxZoom, z));
}

/** East and north ground metres of a plan vector. */
export function planToGround(v: { x: number; y: number }, northDeg: number): { east: number; north: number } {
  const t = northDeg * RAD;
  return { east: v.x * Math.cos(t) - v.y * Math.sin(t), north: v.x * Math.sin(t) + v.y * Math.cos(t) };
}

/** Move a lat/lng by ground metres. */
export function offsetLatLng(p: LatLng, east: number, north: number): LatLng {
  return { lat: p.lat + north / M_PER_DEG, lng: p.lng + east / (M_PER_DEG * Math.cos(p.lat * RAD)) };
}

/**
 * Drag the map by `d` plan metres (the map content follows the pointer): what sits at plan (0, 0) is then what was at -d, so the anchor
 * moves the other way.
 */
export function shiftAnchor(anchor: LatLng, northDeg: number, d: { x: number; y: number }): LatLng {
  const g = planToGround(d, northDeg);
  return offsetLatLng(anchor, -g.east, -g.north);
}

/** Where, and how, to draw the tile layer in canvas pixels: a group at `x,y`, turned `rotation` degrees, scaled `scale` canvas px per tile px. */
export function groupTransform(view: View, northDeg: number, z: number, lat: number): { x: number; y: number; rotation: number; scale: number } {
  return { x: view.offsetX, y: view.offsetY, rotation: northDeg, scale: metresPerPixel(z, lat) * view.scale };
}

/** Tiles that cover a canvas of `w` x `h` px, with each tile's position in the group (pixels from the anchor). Capped so a wild zoom cannot ask for hundreds. */
export function visibleTiles(anchor: LatLng, northDeg: number, view: View, w: number, h: number, z: number, cap = 80): TileRef[] {
  const a = toPixel(anchor, z);
  const t = groupTransform(view, northDeg, z, anchor.lat);
  const th = northDeg * RAD, c = Math.cos(th), s = Math.sin(th);
  // canvas corner -> group pixel (undo translate, rotate, scale)
  const back = (cx: number, cy: number): { x: number; y: number } => {
    const dx = (cx - t.x) / t.scale, dy = (cy - t.y) / t.scale;
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  };
  const pts = [back(0, 0), back(w, 0), back(0, h), back(w, h)];
  const minX = Math.min(...pts.map((p) => p.x)) + a.x, maxX = Math.max(...pts.map((p) => p.x)) + a.x;
  const minY = Math.min(...pts.map((p) => p.y)) + a.y, maxY = Math.max(...pts.map((p) => p.y)) + a.y;
  const n = 2 ** z;
  const x0 = Math.floor(minX / TILE), x1 = Math.floor(maxX / TILE), y0 = Math.max(0, Math.floor(minY / TILE)), y1 = Math.min(n - 1, Math.floor(maxY / TILE));
  const out: TileRef[] = [];
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > cap) return out;
  for (let ty = y0; ty <= y1; ty += 1) for (let tx = x0; tx <= x1; tx += 1) out.push({ z, x: ((tx % n) + n) % n, y: ty, px: tx * TILE - a.x, py: ty * TILE - a.y });
  return out;
}
