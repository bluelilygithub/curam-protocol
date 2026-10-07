// Cellar Planner domain model (spec-v1.md section 4). Every length is a whole number of millimetres. Anything that can be worked out from
// something else is NOT stored (wall length, the base module's height, run terminations' scribes, capacity): a stored copy can drift.

export const SCHEMA_VERSION = 1;

export type BottleProfileId = 'BORDEAUX' | 'BURGUNDY' | 'CHAMPAGNE' | 'MAGNUM';
export type StorageStyle = 'SCALLOPED_CRADLE' | 'LABEL_FORWARD' | 'CASE_DRAWER';

/** How a run of cabinets ends. ROOM_WALL and CORNER_OWNS meet a room wall (scribe); CORNER_YIELDS meets the face of the owning wall's cabinets. */
export type Termination = 'ROOM_WALL' | 'CORNER_OWNS' | 'CORNER_YIELDS';
export type CornerOwnershipMode = 'LONGEST_WALL_FIRST' | 'MANUAL';

/** A bottle type. Typical sizes for the Australian market: DRAFT, confirm with the cabinet maker. */
export interface BottleProfile {
  id: BottleProfileId;
  label: string;
  diameterMm: number;
  lengthMm: number;
  /** Smallest vertical opening for one row of these bottles. */
  minClearMm: number;
  /** Centre-to-centre spacing across a scalloped shelf (also the width pitch of a label-forward display). */
  slotPitchMm: number;
}

/** The construction rules every formula reads. All defaults are "typical, confirm with your cabinet maker"; a user may override any of them. */
export interface ConstructionRules {
  /** Sides, top, bottom and shelves. */
  boardMm: number;
  backPanelMm: number;
  /** Depth of the groove (rebate) the back panel sits in. */
  rebateMm: number;
  /** Setback of the front of the shelves from the front edge of the cabinet (clears glass doors). */
  frontMarginMm: number;
  plinthMm: number;
  topShadowRailMm: number;
  /** Filler cut on site where a run meets a room wall. */
  scribeMm: number;
  /** Gap between a yielding wall's run and the owner's cabinets at a corner. */
  cornerClearanceMm: number;
  /** Extra length a bottle needs in the cabinet beyond its own length (rear air gap plus door buffer). */
  depthClearanceMm: number;
  /** Row warning: informational note when a row is taller than minClear plus this. */
  excessRowWarnMm: number;
  displayAngleDeg: number;
  /** Lip at the front of an inclined display shelf. */
  displayLipMm: number;
  /** Room for a hand to take a bottle from an inclined display tier. */
  displayHandClearanceMm: number;
  sheetMaterial: string;
}

export interface Opening { id: string; wallId: string; xMm: number; widthMm: number; heightMm: number; sillMm?: number }
export interface Obstruction { id: string; label: string; polygon: Array<[number, number]> }

export interface BayModule {
  id: string;
  storageStyle: StorageStyle;
  bottleProfile: BottleProfileId;
  /**
   * The module's height. Required on every module except the first (bottom) one: the bottom module takes whatever is left of the stack,
   * so its height is never stored.
   */
  heightMm?: number;
}

export interface CabinetBay {
  id: string;
  /** Distance along the wall from the start of the wall to the start of the bay. */
  xMm: number;
  widthMm: number;
  outerDepthMm: number;
  /** Plinth, carcass, stack and shadow rail together. */
  outerHeightMm: number;
  /** Bottom to top. Index 0 is the flexible base module. */
  modules: BayModule[];
}

export interface Wall {
  id: string;
  start: [number, number];
  end: [number, number];
  startTermination: Termination;
  endTermination: Termination;
  bays: CabinetBay[];
}

export interface Room {
  heightMm: number;
  walls: Wall[];
  doors: Opening[];
  windows: Opening[];
  obstructions: Obstruction[];
}

export interface CellarProject {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  locale: 'en-AU';
  cornerOwnershipMode: CornerOwnershipMode;
  rules: ConstructionRules;
  room: Room;
}

// ---------------------------------------------------------------- results

export type Severity = 'error' | 'warning' | 'info';
export interface Issue {
  code: string;
  severity: Severity;
  message: string;
  /** What to do about it, when there is a clear fix. */
  fix?: string;
  /** Where it is: a wall, bay or module id. */
  where?: string;
}

export interface RowResult {
  rows: number;
  /** Clear height of every row once the spare height is shared out evenly. */
  clearMm: number;
  /** Height above the minimum that was absorbed evenly into the rows. */
  absorbedMm: number;
}

export interface ModuleResult {
  moduleId: string;
  heightMm: number;
  netHeightMm: number;
  rows: number;
  slotsPerRow: number;
  capacity: number;
  clearMm: number;
  absorbedMm: number;
}

export interface BayResult {
  bayId: string;
  stackZoneMm: number;
  internalDepthMm: number;
  netWidthMm: number;
  modules: ModuleResult[];
  capacity: number;
}

export interface Part {
  code: 'SIDE' | 'TOP' | 'BOTTOM' | 'SHELF' | 'BACK' | 'PLINTH' | 'SHADOW_RAIL' | 'SCRIBE';
  label: string;
  qty: number;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  material: string;
  /** Length of edge to be banded, per piece. */
  edgeBandMm: number;
  notes: string[];
}
