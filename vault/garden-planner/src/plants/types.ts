// Plant record (spec 4.1). The horticultural data is curated by us; images are separate (pulled from open sources, step 4).
import type { AuState, ClimateZone, Frost, Soil } from '../domain/types';

export type PlantType =
  | 'tree' | 'shrub' | 'groundcover' | 'grass' | 'climber' | 'perennial' | 'annual' | 'succulent' | 'palm' | 'fern' | 'edible' | 'aquatic';
export const PLANT_TYPES: readonly PlantType[] = [
  'tree', 'shrub', 'groundcover', 'grass', 'climber', 'perennial', 'annual', 'succulent', 'palm', 'fern', 'edible', 'aquatic',
];
export type Sun = 'full_sun' | 'part_shade' | 'shade';
export const SUN_LEVELS: readonly Sun[] = ['full_sun', 'part_shade', 'shade'];
export type Water = 'low' | 'medium' | 'high';
export type GrowthRate = 'slow' | 'medium' | 'fast';
export type Form3D = 'columnar' | 'rounded' | 'spreading' | 'weeping' | 'palm' | 'clumping_grass' | 'groundcover_mat' | 'climber';
export type Feature = 'bird' | 'bee' | 'screening' | 'edible' | 'fragrant' | 'coastal' | 'pet_safe';
export const FEATURES: readonly Feature[] = ['bird', 'bee', 'screening', 'edible', 'fragrant', 'coastal', 'pet_safe'];
export type Caution = 'toxic_pets' | 'toxic_people' | 'spiky' | 'invasive_roots';
export type Foliage = 'evergreen' | 'deciduous';

/** What the record's numbers came from. Every plant carries one (spec 4.2: "a source for each value"). */
export interface PlantSource { dataset: string; note: string }

export interface PlantRecord {
  id: string;
  botanical: string;
  cultivar?: string;
  common: string[];
  native: boolean;
  /** States a native comes from (empty for exotics). */
  origin: AuState[];
  type: PlantType;
  /** [min, max] metres at maturity. */
  height: [number, number];
  spread: [number, number];
  yearsToMature: number;
  growth: GrowthRate;
  /** Light levels the plant is happy in. */
  sun: Sun[];
  zones: ClimateZone[];
  /** Hardest frost it survives: none = frost-tender, heavy = tolerates heavy frost. */
  frost: Frost;
  water: Water;
  droughtTolerant: boolean;
  soils: Soil[];
  /** Copes with poorly drained soil. */
  tolerantOfPoorDrainage: boolean;
  /** Months 1-12 it flowers in (empty for foliage-only plants). */
  flowerMonths: number[];
  flowerColours: string[];
  foliage: Foliage;
  foliageColour: string;
  features: Feature[];
  cautions: Caution[];
  /** States where it is listed as a weed. It is hidden from suggestions and flagged in the plan there. */
  weedStates: AuState[];
  /**
   * States where the weed status has been CHECKED against that state's official weed list. Empty for every plant today: until a state is
   * here, a plant that is not in `weedStates` is "unknown" there, never "not a weed" (see weeds.ts).
   */
  weedChecked: AuState[];
  form: Form3D;
  source: PlantSource;
}
