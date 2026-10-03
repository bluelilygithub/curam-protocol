import * as THREE from 'three';
import type { FurnitureInstance, Material } from '../engine/types';
import { ROLE_DEFAULTS, type PartRole } from './furnitureParts';

/** Status tints (same ink as the 2D view): a hard violation glows red, a soft one amber. */
export const TINT = { hard: '#ef4444', soft: '#f59e0b', selected: '#CC785C' } as const;
export type Tint = keyof typeof TINT | null;

export interface Look { colour: string; roughness: number; metalness: number; opacity: number; tint: Tint }

/** The look of a part: a finish override on the instance (C13: part name → material id) wins over the part's default. */
export function lookOf(role: PartRole, inst: Pick<FurnitureInstance, 'finishOverrides'> | undefined, materials: Material[]): Omit<Look, 'tint'> {
  const id = inst?.finishOverrides?.[role];
  const m = id ? materials.find((x) => x.id === id) : undefined;
  const d = ROLE_DEFAULTS[role];
  if (m) return { colour: m.colour, roughness: m.roughness, metalness: m.metalness, opacity: d.opacity ?? 1 };
  return { colour: d.colour, roughness: d.roughness, metalness: d.metalness, opacity: d.opacity ?? 1 };
}

/** Materials are shared by look, so a scene of hundreds of parts has a handful of GPU materials. */
export class MaterialCache {
  private readonly cache = new Map<string, THREE.MeshStandardMaterial>();

  get(look: Look): THREE.MeshStandardMaterial {
    const key = `${look.colour}|${look.roughness}|${look.metalness}|${look.opacity}|${look.tint ?? ''}`;
    let m = this.cache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: look.colour, roughness: look.roughness, metalness: look.metalness,
        transparent: look.opacity < 1, opacity: look.opacity, depthWrite: look.opacity >= 1,
        emissive: look.tint ? TINT[look.tint] : '#000000', emissiveIntensity: look.tint ? 0.35 : 0,
      });
      this.cache.set(key, m);
    }
    return m;
  }

  get size(): number { return this.cache.size; }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
}
