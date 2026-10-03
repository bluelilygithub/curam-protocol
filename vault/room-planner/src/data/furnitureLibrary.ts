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
];

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

/** Small starter material list for finish overrides (Spec §8 ranges: roughness 0.4–0.8, metalness 0.0–0.1). */
export const SEED_MATERIALS: Material[] = [
  { id: 'oak', name: 'Oak', colour: '#b98b57', roughness: 0.6, metalness: 0 },
  { id: 'walnut', name: 'Walnut', colour: '#6b4a32', roughness: 0.55, metalness: 0 },
  { id: 'linen', name: 'Linen', colour: '#d9d2c3', roughness: 0.8, metalness: 0 },
  { id: 'charcoal-fabric', name: 'Charcoal fabric', colour: '#44464a', roughness: 0.8, metalness: 0 },
  { id: 'leather-tan', name: 'Tan leather', colour: '#a0623a', roughness: 0.5, metalness: 0.02 },
  { id: 'brushed-steel', name: 'Brushed steel', colour: '#a9adb2', roughness: 0.4, metalness: 0.1 },
];
