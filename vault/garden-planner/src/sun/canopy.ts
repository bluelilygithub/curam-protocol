// How much shade a plant throws: the size of its canopy at the growth stage, and how much sun it blocks in a given month. Used by the sun
// and shade maps. The numbers come from the plant record and the growth control, the same ones the plan and 3D view draw from.
import { leafFactor, plantSizeAt, type GrowthStage } from '../plants/growth';
import type { PlantRecord } from '../plants/types';

/** Plants lower than this cast no shade worth mapping (groundcovers, small perennials). */
export const MIN_SHADING_HEIGHT = 0.5;

export interface CanopyShape { radius: number; zb: number; zt: number }

/** The canopy as a vertical cylinder: radius, and the heights it spans. Trees and palms stand on a trunk; shrubs reach the ground. */
export function canopyShape(p: PlantRecord, stage: GrowthStage): CanopyShape | null {
  const { height, spread } = plantSizeAt(p, stage);
  if (height < MIN_SHADING_HEIGHT || p.type === 'groundcover') return null;
  const radius = spread / 2;
  if (p.type === 'palm') return { radius: radius * 0.5, zb: height * 0.78, zt: height }; // a palm shades from its crown
  if (p.type === 'tree') return { radius, zb: height * 0.38, zt: height };
  return { radius, zb: 0, zt: height };
}

/** 0-1: how much of the sun the canopy blocks that month. An evergreen blocks most; a deciduous plant in winter blocks little. */
export function canopyOpacity(p: PlantRecord, month: number): number {
  const dense = p.type === 'palm' ? 0.5 : p.type === 'grass' || p.type === 'perennial' ? 0.55 : 0.8;
  const bare = 0.2; // bare branches still shade a little
  const leaf = leafFactor(p, month); // 0 bare ... 1 full leaf
  return bare + (dense - bare) * leaf;
}
