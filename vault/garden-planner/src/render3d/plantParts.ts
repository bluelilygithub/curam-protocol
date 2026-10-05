// Generic 3D plant forms (spec 6.5, v1): a handful of primitives per form, tinted with the plant's own colours. Pure data (no three.js), so the
// sizes can be tested against the plant record. Units: metres; y is up; the plant stands at the origin.
import { autumnTint, leafFactor, mixHex, plantSizeAt, isFlowering, type GrowthStage, canopyColour } from '../plants/growth';
import type { PlantRecord } from '../plants/types';

export type Role = 'foliage' | 'trunk' | 'flower';
export interface Part {
  shape: 'sphere' | 'cylinder' | 'cone' | 'box';
  /** Centre. */
  position: [number, number, number];
  /** Full size along x, y, z (a sphere of scale [2,2,2] has radius 1). */
  size: [number, number, number];
  /** Rotation about y then tilt about z (radians); only the palm crown and grass blades use it. */
  rotationY?: number;
  tilt?: number;
  role: Role;
  colour: string;
}

const TRUNK = '#6b4a2e';

/** Small deterministic random generator from a string, so flowers sit in the same places every render. */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}

export function plantParts(p: PlantRecord, stage: GrowthStage, month: number, seed = p.id): Part[] {
  const { height: h, spread: s } = plantSizeAt(p, stage);
  const leaf = leafFactor(p, month);
  const colour = canopyColour(p, month);
  const rnd = seeded(seed);
  const parts: Part[] = [];
  const woody = p.type === 'tree' || p.type === 'palm' || (p.form === 'rounded' && h > 2.5) || p.form === 'spreading' || p.form === 'weeping';
  const trunkH = p.form === 'palm' ? h * 0.78 : p.type === 'tree' ? h * 0.38 : woody ? h * 0.2 : 0;
  const trunkR = Math.max(0.02, Math.min(0.025 + h * 0.012, 0.35));
  if (trunkH > 0) parts.push({ shape: 'cylinder', position: [0, trunkH / 2, 0], size: [trunkR * 2, trunkH, trunkR * 2], role: 'trunk', colour: TRUNK });

  const foliage = (shape: Part['shape'], y: number, sx: number, sy: number, sz: number): void => {
    // a deciduous plant in winter shows only its bare branches: a thin, pale skeleton instead of a leafy canopy
    if (leaf < 0.05) {
      parts.push({ shape: 'sphere', position: [0, y, 0], size: [sx * 0.95, sy * 0.95, sz * 0.95], role: 'trunk', colour: mixHex(TRUNK, '#bdb3a4', 0.5) });
      return;
    }
    const k = 0.45 + 0.55 * leaf;
    parts.push({ shape, position: [0, y, 0], size: [sx * k, sy * k, sz * k], role: 'foliage', colour });
  };

  switch (p.form) {
    case 'columnar': foliage('sphere', trunkH + (h - trunkH) / 2, s, h - trunkH, s); break;
    case 'rounded': foliage('sphere', trunkH + (h - trunkH) / 2, s, h - trunkH, s); break;
    case 'spreading': foliage('sphere', trunkH + (h - trunkH) * 0.5, s, (h - trunkH) * 0.9, s); break;
    case 'weeping':
      foliage('sphere', h - (h - trunkH) * 0.3, s * 0.8, (h - trunkH) * 0.5, s * 0.8);
      if (leaf >= 0.05) parts.push({ shape: 'cone', position: [0, trunkH + (h - trunkH) * 0.4, 0], size: [s, (h - trunkH) * 0.8, s], role: 'foliage', colour });
      break;
    case 'palm': {
      const n = 8;
      for (let i = 0; i < n; i++) {
        parts.push({ shape: 'box', position: [0, h * 0.84, 0], size: [s * 0.5, Math.max(0.03, h * 0.012), Math.max(0.08, s * 0.12)], rotationY: (i / n) * Math.PI * 2, tilt: 0.45, role: 'foliage', colour });
      }
      break;
    }
    case 'clumping_grass': {
      const blades = 10;
      for (let i = 0; i < blades; i++) {
        const a = (i / blades) * Math.PI * 2;
        parts.push({ shape: 'cone', position: [Math.cos(a) * s * 0.28, h / 2, Math.sin(a) * s * 0.28], size: [Math.max(0.02, s * 0.12), h, Math.max(0.02, s * 0.12)], rotationY: a, tilt: 0.25, role: 'foliage', colour });
      }
      break;
    }
    case 'groundcover_mat': parts.push({ shape: 'cylinder', position: [0, Math.max(h, 0.04) / 2, 0], size: [s, Math.max(h, 0.04), s], role: 'foliage', colour }); break;
    case 'climber': parts.push({ shape: 'box', position: [0, h / 2, 0], size: [Math.max(s, 0.3), h, 0.08], role: 'foliage', colour }); break;
  }

  // flowers: small dabs of colour on the surface of the canopy
  if (isFlowering(p, month) && p.flowerColours.length && leaf > 0.3 && p.form !== 'palm') {
    const n = Math.max(4, Math.min(14, Math.round(s * 6)));
    const cy = p.form === 'groundcover_mat' ? h : trunkH + (h - trunkH) / 2;
    const rx = s / 2, ry = Math.max(0.03, (p.form === 'groundcover_mat' ? h : h - trunkH) / 2);
    for (let i = 0; i < n; i++) {
      const u = rnd() * Math.PI * 2, v = Math.acos(1 - rnd() * 1.4);
      const size = Math.max(0.03, Math.min(0.14, s * 0.08));
      parts.push({
        shape: 'sphere', role: 'flower', colour: p.flowerColours[i % p.flowerColours.length], size: [size, size, size],
        position: [Math.cos(u) * Math.sin(v) * rx, cy + Math.cos(v) * ry, Math.sin(u) * Math.sin(v) * rx],
      });
    }
  }
  void autumnTint;
  return parts;
}

/** The horizontal extent (full width) a set of foliage parts covers: used to check 3D sizes against the plant record. */
export function canopyWidth(parts: Part[]): number {
  let w = 0;
  for (const q of parts) if (q.role === 'foliage' && q.shape !== 'box') w = Math.max(w, Math.abs(q.position[0]) * 2 + q.size[0], Math.abs(q.position[2]) * 2 + q.size[2]);
  return w;
}
export function topOf(parts: Part[]): number {
  let t = 0;
  for (const q of parts) t = Math.max(t, q.position[1] + q.size[1] / 2);
  return t;
}
