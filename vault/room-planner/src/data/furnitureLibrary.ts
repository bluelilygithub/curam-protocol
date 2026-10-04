import type { FurnitureDefinition, Material } from '../engine/types';

/**
 * Seed furniture library (Appendix C, C17). Generic metric set, edit freely: this is the only place the numbers live.
 * W × L × H in metres. All clearances are soft so a coffee table can sit in front of a sofa.
 * Bed sizes are generic; check them against what the designer actually specifies.
 */
export const FURNITURE_LIBRARY: FurnitureDefinition[] = [
  { id: 'sofa-3', name: '3-seat sofa', category: 'seating', defaultWidth: 2.2, defaultLength: 0.95, defaultHeight: 0.85,
    clearancePolicies: [{ side: 'front', offset: 0.45, severity: 'soft' }] },
  { id: 'armchair', name: 'Armchair', category: 'seating', defaultWidth: 0.85, defaultLength: 0.85, defaultHeight: 0.85,
    clearancePolicies: [{ side: 'front', offset: 0.45, severity: 'soft' }] },
  { id: 'coffee-table', name: 'Coffee table', category: 'tables', defaultWidth: 1.2, defaultLength: 0.6, defaultHeight: 0.42 },
  { id: 'side-table', name: 'Side table', category: 'tables', defaultWidth: 0.5, defaultLength: 0.5, defaultHeight: 0.55 },
  { id: 'dining-table', name: 'Dining table', category: 'tables', defaultWidth: 1.8, defaultLength: 0.9, defaultHeight: 0.75,
    clearancePolicies: [{ side: 'all', offset: 0.9, severity: 'soft' }] },
  { id: 'dining-chair', name: 'Dining chair', category: 'seating', defaultWidth: 0.45, defaultLength: 0.52, defaultHeight: 0.85 },
  { id: 'bed-queen', name: 'Queen bed', category: 'bedroom', defaultWidth: 1.6, defaultLength: 2.1, defaultHeight: 1.0,
    clearancePolicies: [
      { side: 'front', offset: 0.6, severity: 'soft' },
      { side: 'left', offset: 0.6, severity: 'soft' },
      { side: 'right', offset: 0.6, severity: 'soft' },
    ] },
  { id: 'bedside-table', name: 'Bedside table', category: 'bedroom', defaultWidth: 0.5, defaultLength: 0.4, defaultHeight: 0.55 },
  { id: 'wardrobe', name: 'Wardrobe', category: 'storage', defaultWidth: 1.8, defaultLength: 0.6, defaultHeight: 2.1,
    clearancePolicies: [{ side: 'front', offset: 0.6, severity: 'soft' }] },
  { id: 'desk', name: 'Desk', category: 'office', defaultWidth: 1.4, defaultLength: 0.7, defaultHeight: 0.74,
    clearancePolicies: [{ side: 'front', offset: 0.8, severity: 'soft' }] },
  { id: 'bookshelf', name: 'Bookshelf', category: 'storage', defaultWidth: 0.9, defaultLength: 0.35, defaultHeight: 1.8 },
  { id: 'tv-unit', name: 'TV unit', category: 'storage', defaultWidth: 1.8, defaultLength: 0.45, defaultHeight: 0.5 },

  // ---- more seating, tables, storage and bedroom pieces (M4.8)
  { id: 'loveseat', name: '2-seat sofa', category: 'seating', defaultWidth: 1.6, defaultLength: 0.9, defaultHeight: 0.85,
    clearancePolicies: [{ side: 'front', offset: 0.45, severity: 'soft' }] },
  { id: 'ottoman', name: 'Ottoman', category: 'seating', defaultWidth: 0.6, defaultLength: 0.6, defaultHeight: 0.4 },
  { id: 'bench', name: 'Bench', category: 'seating', defaultWidth: 1.2, defaultLength: 0.4, defaultHeight: 0.45 },
  { id: 'office-chair', name: 'Office chair', category: 'office', defaultWidth: 0.6, defaultLength: 0.6, defaultHeight: 0.95 },
  { id: 'console-table', name: 'Console table', category: 'tables', defaultWidth: 1.2, defaultLength: 0.35, defaultHeight: 0.8 },
  { id: 'round-table', name: 'Round dining table', category: 'tables', defaultWidth: 1.2, defaultLength: 1.2, defaultHeight: 0.75,
    clearancePolicies: [{ side: 'all', offset: 0.8, severity: 'soft' }] },
  { id: 'sideboard', name: 'Sideboard', category: 'storage', defaultWidth: 1.6, defaultLength: 0.45, defaultHeight: 0.8 },
  { id: 'dresser', name: 'Chest of drawers', category: 'bedroom', defaultWidth: 1.2, defaultLength: 0.5, defaultHeight: 0.9,
    clearancePolicies: [{ side: 'front', offset: 0.6, severity: 'soft' }] },
  { id: 'bed-single', name: 'Single bed', category: 'bedroom', defaultWidth: 0.95, defaultLength: 2.0, defaultHeight: 0.9,
    clearancePolicies: [{ side: 'front', offset: 0.5, severity: 'soft' }, { side: 'left', offset: 0.5, severity: 'soft' }, { side: 'right', offset: 0.5, severity: 'soft' }] },
  { id: 'bed-king', name: 'King bed', category: 'bedroom', defaultWidth: 1.9, defaultLength: 2.1, defaultHeight: 1.0,
    clearancePolicies: [{ side: 'front', offset: 0.6, severity: 'soft' }, { side: 'left', offset: 0.6, severity: 'soft' }, { side: 'right', offset: 0.6, severity: 'soft' }] },

  // ---- decor: plants, a lamp and a mirror
  { id: 'plant-large', name: 'Large plant', category: 'decor', defaultWidth: 0.55, defaultLength: 0.55, defaultHeight: 1.4 },
  { id: 'plant-small', name: 'Small plant', category: 'decor', defaultWidth: 0.3, defaultLength: 0.3, defaultHeight: 0.5 },
  { id: 'floor-lamp', name: 'Floor lamp', category: 'decor', defaultWidth: 0.35, defaultLength: 0.35, defaultHeight: 1.65 },
  { id: 'mirror-floor', name: 'Floor mirror', category: 'decor', defaultWidth: 0.7, defaultLength: 0.06, defaultHeight: 1.7 },

  // ---- rugs: they lie on the floor, so furniture may stand on them (no collision, no clearance, no door-swing check)
  { id: 'rug-rect', name: 'Rug', category: 'rugs', defaultWidth: 2.4, defaultLength: 1.7, defaultHeight: 0.015 },
  { id: 'rug-round', name: 'Round rug', category: 'rugs', defaultWidth: 1.6, defaultLength: 1.6, defaultHeight: 0.015 },
  { id: 'rug-runner', name: 'Runner rug', category: 'rugs', defaultWidth: 0.8, defaultLength: 2.4, defaultHeight: 0.012 },
];

/** Pieces that lie on the floor and may be walked and built over: no overlap, clearance or door-swing checks (they must still sit inside the room). */
export const FLOOR_COVERING_CATEGORY = 'rugs';

/**
 * Default fixture definitions (M2 owner decision). Same data file as the furniture library.
 * Door: single-leaf hinged, 0.82 W × 2.04 H, elevation 0, swing 90°. Window: 1.20 W × 1.20 H, sill at elevation 0.90.
 */
export interface FixtureDefinition {
  id: string;
  name: string;
  type: 'door' | 'window';
  width: number;
  height: number;
  elevation: number;
  hingeSide?: 'left' | 'right';
  swingAngle?: number;
  accessZoneDepth?: number;
}

export const FIXTURE_LIBRARY: FixtureDefinition[] = [
  { id: 'door-single', name: 'Door', type: 'door', width: 0.82, height: 2.04, elevation: 0, hingeSide: 'left', swingAngle: Math.PI / 2 },
  { id: 'window-std', name: 'Window', type: 'window', width: 1.2, height: 1.2, elevation: 0.9 },
];

/** Starter material list for finishes (Spec §8 ranges: roughness 0.4–0.8, metalness 0.0–0.1). `texture` is what it looks like in the Realistic look. */
export const SEED_MATERIALS: Material[] = [
  { id: 'oak', name: 'Oak', colour: '#b98b57', roughness: 0.6, metalness: 0, texture: 'wood' },
  { id: 'walnut', name: 'Walnut', colour: '#6b4a32', roughness: 0.55, metalness: 0, texture: 'wood' },
  { id: 'linen', name: 'Linen', colour: '#d9d2c3', roughness: 0.8, metalness: 0, texture: 'linen' },
  { id: 'charcoal-fabric', name: 'Charcoal fabric', colour: '#44464a', roughness: 0.8, metalness: 0, texture: 'linen' },
  { id: 'leather-tan', name: 'Tan leather', colour: '#a0623a', roughness: 0.5, metalness: 0.02, texture: 'leather' },
  { id: 'brushed-steel', name: 'Brushed steel', colour: '#a9adb2', roughness: 0.4, metalness: 0.1, texture: 'metal' },
  { id: 'white-paint', name: 'White paint', colour: '#f1eee8', roughness: 0.6, metalness: 0, texture: 'paint' },
  { id: 'grey-fabric', name: 'Grey fabric', colour: '#8d8a82', roughness: 0.8, metalness: 0, texture: 'linen' },
  { id: 'sage-fabric', name: 'Sage fabric', colour: '#7d8a84', roughness: 0.8, metalness: 0, texture: 'linen' },
  { id: 'dark-wood', name: 'Dark wood', colour: '#3b2d24', roughness: 0.55, metalness: 0.02, texture: 'wood' },
  { id: 'pale-oak', name: 'Pale oak', colour: '#d8b98c', roughness: 0.6, metalness: 0, texture: 'wood' },
  { id: 'leaf-green', name: 'Leaf green', colour: '#4f7a3a', roughness: 0.7, metalness: 0, texture: 'paint' },
  { id: 'ceramic-white', name: 'White ceramic', colour: '#eeece6', roughness: 0.4, metalness: 0, texture: 'paint' },
  { id: 'terracotta-pot', name: 'Terracotta', colour: '#b8643f', roughness: 0.7, metalness: 0, texture: 'paint' },
  { id: 'rug-cream', name: 'Cream wool', colour: '#e0d6c3', roughness: 0.8, metalness: 0, texture: 'linen' },
  { id: 'rug-border', name: 'Rug pattern', colour: '#a58a63', roughness: 0.8, metalness: 0, texture: 'linen' },
];

/**
 * What each part of each library item is made of in the Realistic look when the designer has not chosen a finish (material ids from
 * SEED_MATERIALS). A finish chosen in the Inspector (`finishOverrides`, C13) always wins; the ordinary and clay looks ignore this.
 */
export const DEFAULT_FINISHES: Record<string, Partial<Record<'frame' | 'upholstery' | 'top' | 'leg' | 'fabric' | 'accent' | 'handle' | 'foliage' | 'pot', string>>> = {
  'sofa-3': { upholstery: 'grey-fabric', frame: 'grey-fabric', leg: 'dark-wood' },
  armchair: { upholstery: 'sage-fabric', frame: 'sage-fabric', leg: 'dark-wood' },
  'coffee-table': { top: 'pale-oak', frame: 'pale-oak', leg: 'dark-wood' },
  'side-table': { top: 'walnut', leg: 'dark-wood' },
  'dining-table': { top: 'pale-oak', frame: 'pale-oak', leg: 'pale-oak' },
  'dining-chair': { upholstery: 'linen', frame: 'pale-oak', leg: 'pale-oak' },
  'bed-queen': { frame: 'walnut', fabric: 'linen', upholstery: 'grey-fabric', leg: 'dark-wood' },
  'bedside-table': { frame: 'walnut', top: 'walnut', accent: 'walnut', leg: 'dark-wood', handle: 'brushed-steel' },
  wardrobe: { frame: 'white-paint', accent: 'white-paint', leg: 'white-paint', handle: 'brushed-steel' },
  desk: { top: 'pale-oak', frame: 'white-paint', accent: 'pale-oak', handle: 'brushed-steel' },
  bookshelf: { frame: 'pale-oak', accent: 'pale-oak' },
  'tv-unit': { frame: 'walnut', top: 'walnut', accent: 'walnut', leg: 'dark-wood', handle: 'brushed-steel' },
  loveseat: { upholstery: 'sage-fabric', frame: 'sage-fabric', leg: 'dark-wood' },
  ottoman: { upholstery: 'grey-fabric', frame: 'grey-fabric', leg: 'dark-wood' },
  bench: { top: 'pale-oak', frame: 'pale-oak', upholstery: 'linen', leg: 'dark-wood' },
  'office-chair': { upholstery: 'charcoal-fabric', frame: 'charcoal-fabric', leg: 'brushed-steel', handle: 'brushed-steel' },
  'console-table': { top: 'walnut', frame: 'walnut', leg: 'dark-wood' },
  'round-table': { top: 'pale-oak', frame: 'pale-oak', leg: 'dark-wood' },
  sideboard: { frame: 'walnut', top: 'walnut', accent: 'walnut', leg: 'dark-wood', handle: 'brushed-steel' },
  dresser: { frame: 'pale-oak', top: 'pale-oak', accent: 'pale-oak', leg: 'dark-wood', handle: 'brushed-steel' },
  'bed-single': { frame: 'walnut', fabric: 'linen', upholstery: 'grey-fabric', leg: 'dark-wood' },
  'bed-king': { frame: 'walnut', fabric: 'linen', upholstery: 'grey-fabric', leg: 'dark-wood' },
  'plant-large': { foliage: 'leaf-green', pot: 'ceramic-white' },
  'plant-small': { foliage: 'leaf-green', pot: 'terracotta-pot' },
  'floor-lamp': { leg: 'brushed-steel', fabric: 'linen', frame: 'brushed-steel' },
  'mirror-floor': { frame: 'dark-wood', handle: 'brushed-steel' },
  'rug-rect': { fabric: 'rug-cream', accent: 'rug-border' },
  'rug-round': { fabric: 'rug-cream', accent: 'rug-border' },
  'rug-runner': { fabric: 'rug-cream', accent: 'rug-border' },
};

/** Finishes of doors and windows in the Realistic look. */
export const FIXTURE_FINISHES = { frame: 'white-paint', door: 'white-paint', handle: 'brushed-steel' } as const;
