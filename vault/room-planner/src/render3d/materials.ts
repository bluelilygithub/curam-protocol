import * as THREE from 'three';
import { DEFAULT_FINISHES, FIXTURE_FINISHES, SEED_MATERIALS } from '../data/furnitureLibrary';
import type { Palette } from '../data/palettes';
import type { FurnitureInstance, Material } from '../engine/types';
import { ROLE_DEFAULTS, type Part, type PartRole } from './furnitureParts';
import { TEXTURE_SPECS, type TextureKind } from './textureData';
import { textureOf } from './textures';

/** Status tints (same ink as the 2D view): a hard violation glows red, a soft one amber. */
export const TINT = { hard: '#ef4444', soft: '#f59e0b', selected: '#CC785C' } as const;
export type Tint = keyof typeof TINT | null;

export interface Look {
  colour: string; roughness: number; metalness: number; opacity: number; tint: Tint;
  /** Realistic look only: a generated detail texture that multiplies `colour`, and how strongly it bumps. */
  texture?: TextureKind;
  bump?: number;
}

/** The look of a part: a finish override on the instance (C13: part name → material id) wins over the part's default. */
export function lookOf(role: PartRole, inst: Pick<FurnitureInstance, 'finishOverrides'> | undefined, materials: Material[]): Omit<Look, 'tint'> {
  const id = inst?.finishOverrides?.[role];
  const m = id ? materials.find((x) => x.id === id) : undefined;
  const d = ROLE_DEFAULTS[role];
  if (m) return { colour: m.colour, roughness: m.roughness, metalness: m.metalness, opacity: d.opacity ?? 1 };
  return { colour: d.colour, roughness: d.roughness, metalness: d.metalness, opacity: d.opacity ?? 1 };
}

/** A material by id: the project's own list first, then the built-in starter list (so default finishes work in older projects). */
export const findMaterial = (id: string | undefined, materials: Material[]): Material | undefined =>
  id ? (materials.find((m) => m.id === id) ?? SEED_MATERIALS.find((m) => m.id === id)) : undefined;

function fromMaterial(m: Material, opacity = 1): Omit<Look, 'tint'> {
  return {
    colour: m.colour, roughness: m.roughness, metalness: m.metalness, opacity,
    ...(m.texture ? { texture: m.texture, bump: TEXTURE_SPECS[m.texture].bump } : {}),
  };
}

/**
 * The Realistic look of a furniture part: the designer's finish (override) wins, then the item's default finish, then the part's
 * plain role colour. A part with its own `tint` (a book) takes that colour on a smooth painted surface.
 */
export function realisticLookOf(
  definitionId: string, part: Pick<Part, 'role' | 'tint'>, inst: Pick<FurnitureInstance, 'finishOverrides'> | undefined, materials: Material[],
  palette?: Palette,
): Omit<Look, 'tint'> {
  if (part.role === 'glass') return lookOf('glass', undefined, materials);
  const chosen = inst?.finishOverrides?.[part.role];
  if (!chosen && part.tint) return { colour: part.tint, roughness: 0.8, metalness: 0, opacity: 1, texture: 'paint', bump: TEXTURE_SPECS.paint.bump };
  const m = findMaterial(chosen ?? DEFAULT_FINISHES[definitionId]?.[part.role as keyof (typeof DEFAULT_FINISHES)[string]], materials);
  if (m) {
    const look = fromMaterial(m);
    // The room's palette colours what the designer has not chosen themselves; a finish picked in the Inspector always wins.
    const colour = chosen ? undefined : paletteColour(palette, definitionId, part.role, m);
    return colour ? { ...look, colour } : look;
  }
  return lookOf(part.role, undefined, materials);
}

/** The palette's colour for a part, or undefined to leave it as it is. Rugs take the rug colours; fabric furniture the upholstery colour; wood furniture the wood tone. */
export function paletteColour(palette: Palette | undefined, definitionId: string, role: PartRole, m: Pick<Material, 'id' | 'texture'>): string | undefined {
  if (!palette) return undefined;
  if (definitionId.startsWith('rug-')) return role === 'fabric' ? palette.rug : role === 'accent' ? palette.rugAccent : undefined;
  if (m.texture === 'linen' && (role === 'upholstery' || role === 'frame')) return palette.upholstery;
  if (m.texture === 'wood' && m.id !== 'dark-wood' && (role === 'top' || role === 'frame' || role === 'accent' || role === 'upholstery')) return palette.wood;
  return undefined;
}

/** The Realistic look of a door or window part. */
export function realisticFixtureLook(role: PartRole, materials: Material[], palette?: Palette): Omit<Look, 'tint'> {
  if (role === 'glass') return lookOf('glass', undefined, materials);
  const id = role === 'handle' ? FIXTURE_FINISHES.handle : role === 'door' ? FIXTURE_FINISHES.door : FIXTURE_FINISHES.frame;
  const m = findMaterial(id, materials);
  if (!m) return lookOf(role, undefined, materials);
  const look = fromMaterial(m);
  return palette && role !== 'handle' ? { ...look, colour: palette.trim } : look;
}

/** Materials are shared by look, so a scene of hundreds of parts has a handful of GPU materials. */
export class MaterialCache {
  private readonly cache = new Map<string, THREE.MeshStandardMaterial>();

  get(look: Look): THREE.MeshStandardMaterial {
    const key = `${look.colour}|${look.roughness}|${look.metalness}|${look.opacity}|${look.tint ?? ''}|${look.texture ?? ''}`;
    let m = this.cache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: look.colour, roughness: look.roughness, metalness: look.metalness,
        transparent: look.opacity < 1, opacity: look.opacity, depthWrite: look.opacity >= 1,
        emissive: look.tint ? TINT[look.tint] : '#000000', emissiveIntensity: look.tint ? 0.35 : 0,
        ...(look.texture ? (() => { const t = textureOf(look.texture); return { map: t, bumpMap: t, bumpScale: look.bump ?? 0.3 }; })() : {}),
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
