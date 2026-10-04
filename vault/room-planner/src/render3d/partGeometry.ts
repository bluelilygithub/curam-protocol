// Geometry for furniture parts (M4.6): one cached geometry per distinct part, with UVs in metres (box-projected), so a texture keeps
// its real-world scale on every face. Rounded boxes and tapered legs need real geometry (non-uniform scaling would distort them),
// so everything uses the same path; the cache is a small LRU so resizing a piece does not leak a geometry per millimetre.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Part } from './furnitureParts';

const MAX_CACHED = 600;
const cache = new Map<string, THREE.BufferGeometry>();
const mm = (v: number): number => Math.round(v * 1000);

/** Box-projected UVs in metres: each vertex is projected along its dominant normal axis. */
export function projectUV(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    if (ay >= ax && ay >= az) { uv[i * 2] = x; uv[i * 2 + 1] = z; }
    else if (ax >= az) { uv[i * 2] = z; uv[i * 2 + 1] = y; }
    else { uv[i * 2] = x; uv[i * 2 + 1] = y; }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function build(part: Part): THREE.BufferGeometry {
  const [sx, sy, sz] = part.size;
  let g: THREE.BufferGeometry;
  switch (part.shape) {
    case 'box':
      g = new THREE.BoxGeometry(sx, sy, sz);
      break;
    case 'rbox':
      g = new RoundedBoxGeometry(sx, sy, sz, 3, part.radius ?? 0.01);
      break;
    case 'ellipsoid': {
      g = new THREE.SphereGeometry(0.5, 20, 14);
      g.scale(sx, sy, sz);
      g.computeVertexNormals();
      break;
    }
    case 'taper': {
      // wide at the top, `taper` × as wide at the foot; elliptical if the footprint is not square
      g = new THREE.CylinderGeometry(sx / 2, (sx / 2) * (part.taper ?? 0.6), sy, 24);
      g.scale(1, 1, sx > 0 ? sz / sx : 1);
      break;
    }
    case 'cylinder': {
      const axis = part.axis ?? 'y';
      g = new THREE.CylinderGeometry(1, 1, 1, 32);
      if (axis === 'y') { g.scale(sx / 2, sy, sz / 2); }
      else if (axis === 'z') { g.scale(sx / 2, sz, sy / 2); g.rotateX(Math.PI / 2); }
      else { g.scale(sy / 2, sx, sz / 2); g.rotateZ(Math.PI / 2); }
      g.computeVertexNormals();
      break;
    }
  }
  if (!part.art) projectUV(g); // a picture keeps the box's own 0–1 UVs so the artwork fills its face
  return g;
}

const keyOf = (p: Part): string => `${p.shape}|${mm(p.size[0])}|${mm(p.size[1])}|${mm(p.size[2])}|${mm(p.radius ?? 0)}|${p.taper ?? ''}|${p.axis ?? ''}|${p.art ?? ''}`;

/** The shared geometry for a part, centred on the origin (position the mesh at `part.centre`). */
export function partGeometry(part: Part): THREE.BufferGeometry {
  const key = keyOf(part);
  let g = cache.get(key);
  if (g) { cache.delete(key); cache.set(key, g); return g; } // most recently used goes last
  g = build(part);
  cache.set(key, g);
  if (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value as string;
    cache.get(oldest)?.dispose();
    cache.delete(oldest);
  }
  return g;
}

export function geometryCacheSize(): number { return cache.size; }

export function disposePartGeometries(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}
