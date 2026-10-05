// Phase 1 core types (Phase 1 contract §2–§4) plus Appendix C additions (C5, C9, C13).

export type Metres = number;
export interface Vec2 { x: Metres; y: Metres }
export interface Vertex { id: string; position: Vec2 }
export interface AABB { min: Vec2; max: Vec2 }
export interface Interval { min: Metres; max: Metres }

export type ConstraintSeverity = 'hard' | 'soft';
export type ConstraintType =
  | 'outside_room'
  | 'door_swing'
  | 'fixture_access'
  | 'fixture_out_of_wall'
  | 'physical_collision'
  | 'clearance'
  // Pipeline-only: a locked object rejects move/resize/rotate/delete (A16). Surfaced as a constraint message.
  | 'locked';

export interface ValidationViolation {
  type: ConstraintType;
  severity: ConstraintSeverity;
  message: string;
  involvedObjectIds: string[];
  involvedWallIds?: string[];
  involvedFixtureIds?: string[];
  /** Penetration depth / outside length. Used only by the escape rule; never compared in tests (C12). */
  magnitude?: number;
}

export interface ValidationResult {
  valid: boolean; // true only if no hard violations
  violations: ValidationViolation[];
}

export type SnapTargetType =
  | 'wall_endpoint'
  | 'wall'
  | 'furniture_edge'
  | 'furniture_centre'
  | 'alignment'
  | 'grid';

export interface SnapCandidate {
  targetType: SnapTargetType;
  position: Vec2;
  distance: Metres;
  priority: number;
  reason: string;
}

export type PolygonErrorCode =
  | 'SELF_INTERSECTION'
  | 'ZERO_AREA'
  | 'DEGENERATE_EDGE'
  | 'DUPLICATE_VERTEX'
  | 'TOO_FEW_VERTICES';

export type ApplyErrorCode =
  | 'UNKNOWN_COMMAND_TYPE'
  | 'MISSING_ID'
  | 'ID_NOT_FOUND'
  | 'STRUCTURALLY_CORRUPT_COMMAND';

// ---------------------------------------------------------------- entities

/** What a finish looks like close up in the Realistic look (generated textures; Spec Addition A2). */
export type FinishTexture = 'wood' | 'linen' | 'leather' | 'metal' | 'paint';

/** C13 */
export interface Material {
  id: string;
  name: string;
  colour: string; // hex
  roughness: number; // 0.4–0.8
  metalness: number; // 0.0–0.1
  /** Optional, so materials saved before M4.6 load unchanged: they simply have no texture. */
  texture?: FinishTexture;
}

export interface WallSegment {
  id: string;
  startVertexId: string;
  endVertexId: string;
  thickness: Metres; // default 0.15, expands outward only
}

export interface ClearancePolicy {
  side: 'front' | 'back' | 'left' | 'right' | 'all';
  offset: Metres;
  severity: ConstraintSeverity;
}

export interface FurnitureDefinition {
  id: string;
  name: string;
  category: string;
  defaultWidth: Metres;
  defaultLength: Metres;
  defaultHeight: Metres;
  /** Height of the underside above the floor when first placed (pictures and mirrors hang on the wall). Default 0. */
  defaultElevation?: Metres;
  /** Small pieces (a plant) that stand on whatever is under them: a table top, a sideboard, or the floor. */
  settles?: boolean;
  /** `ceiling`: starts hanging from the ceiling (its top at the room's ceiling height), whatever that is. */
  mount?: 'ceiling';
  clearancePolicies?: ClearancePolicy[];
}

export interface FurnitureMetadata {
  vendor?: string;
  sku?: string;
  finishCode?: string;
  unitCost?: number;
  notes?: string;
}

export interface FurnitureInstance {
  id: string;
  definitionId: string;
  roomId: string;
  position: Vec2; // centre
  elevation: Metres;
  rotation: number; // radians, [0, 2π) (C3)
  width: Metres;
  length: Metres;
  height: Metres;
  locked?: boolean;
  finishOverrides?: Record<string, string>; // part name → material id (C13)
  /** A photo of your own shown in this picture frame instead of the built-in artwork (key of `Project.images`). */
  imageId?: string;
  metadata?: FurnitureMetadata;
}

export interface Fixture {
  id: string;
  type: 'door' | 'window';
  wallId: string;
  /** Distance from the wall's start vertex to the fixture centre along the interior face (C8). */
  offsetAlongWall: Metres;
  width: Metres;
  height: Metres;
  elevation: Metres;
  hingeSide?: 'left' | 'right';
  swingAngle?: number; // radians, default π/2
  accessZoneDepth?: Metres;
}

export interface Room {
  id: string;
  name: string;
  floorElevation: Metres;
  wallHeight: Metres;
  ceilingHeight: Metres;
  vertices: Vertex[];
  walls: WallSegment[];
  fixtures: Fixture[]; // kept sorted by id
  furniture: FurnitureInstance[]; // kept sorted by id
  /** Colour palette id (`data/palettes.ts`). Optional so older files load unchanged; none = the standard colours. Shown in the 3D view. */
  palette?: string;
}

/**
 * A named 3D camera (M4, D44). Saved views are presentation, not design: they live in the project file but are never part of
 * undo history, and they do not change what the commands operate on.
 */
export interface SavedView {
  id: string;
  name: string;
  cameraPosition: [number, number, number];
  target: [number, number, number];
  projection: 'perspective' | 'orthographic';
  zoom?: number;
  roomId?: string;
}

export interface Project {
  schemaVersion: 1;
  id: string;
  /** Optional so older files load unchanged; the library shows `projectName()` when absent. */
  name?: string;
  units: 'metric' | 'imperial';
  rooms: Room[]; // kept sorted by id
  furnitureDefinitions: FurnitureDefinition[];
  materials: Material[];
  /** Optional so projects saved before M4 load unchanged; kept in creation order. */
  savedViews?: SavedView[];
  /** Your own photos for picture frames, shrunk and stored here (see `state/pictures.ts`). Optional so older files load unchanged. */
  images?: Record<string, ProjectImage>;
}

export interface ProjectImage { name: string; dataUrl: string; width: number; height: number }

// ---------------------------------------------------------------- commands

export interface PlaceFurnitureCommand { type: 'PlaceFurniture'; instance: FurnitureInstance }
export interface MoveFurnitureCommand { type: 'MoveFurniture'; instanceId: string; from: Vec2; to: Vec2 }
export interface ResizeFurnitureCommand {
  type: 'ResizeFurniture';
  instanceId: string;
  from: { position: Vec2; width: Metres; length: Metres };
  to: { position: Vec2; width: Metres; length: Metres };
}
export interface RotateFurnitureCommand { type: 'RotateFurniture'; instanceId: string; from: number; to: number }
export interface DeleteFurnitureCommand { type: 'DeleteFurniture'; instanceId: string; snapshot: FurnitureInstance }
export interface PlaceFixtureCommand { type: 'PlaceFixture'; fixture: Fixture }

export interface RoomGeometryState {
  vertices: Vertex[];
  walls: WallSegment[];
  fixtures: Fixture[]; // C5: mandatory on both sides
}
export interface EditWallCommand {
  type: 'EditWall';
  roomId: string;
  from: RoomGeometryState;
  to: RoomGeometryState;
}

/**
 * `null` means "property absent". It is used instead of `undefined` so that the key survives a JSON
 * round-trip and the from/to key sets stay comparable on replay (C9).
 */
export interface FurniturePatch {
  elevation?: Metres;
  height?: Metres;
  imageId?: string | null;
  locked?: boolean | null;
  finishOverrides?: Record<string, string> | null;
  metadata?: FurnitureMetadata | null;
}
export interface UpdateFurnitureCommand {
  type: 'UpdateFurniture';
  instanceId: string;
  from: FurniturePatch;
  to: FurniturePatch;
}

export interface FixturePatch {
  wallId?: string;
  offsetAlongWall?: Metres;
  width?: Metres;
  height?: Metres;
  elevation?: Metres;
  hingeSide?: 'left' | 'right' | null;
  swingAngle?: number | null;
  accessZoneDepth?: Metres | null;
}
export interface UpdateFixtureCommand {
  type: 'UpdateFixture';
  fixtureId: string;
  from: FixturePatch;
  to: FixturePatch;
}
export interface DeleteFixtureCommand { type: 'DeleteFixture'; fixtureId: string; snapshot: Fixture }
/** Rename a room and/or choose its colour palette (`palette: null` = back to the standard colours). Only the keys present are changed. */
export interface RoomPatch { name?: string; palette?: string | null }
export interface UpdateRoomCommand { type: 'UpdateRoom'; roomId: string; from: RoomPatch; to: RoomPatch }
export interface CreateRoomCommand { type: 'CreateRoom'; room: Room }
export interface DeleteRoomCommand { type: 'DeleteRoom'; roomId: string; snapshot: Room }
export interface CompositeCommand { type: 'Composite'; commands: Command[] }

export type Command =
  | PlaceFurnitureCommand
  | MoveFurnitureCommand
  | ResizeFurnitureCommand
  | RotateFurnitureCommand
  | DeleteFurnitureCommand
  | PlaceFixtureCommand
  | EditWallCommand
  | UpdateFurnitureCommand
  | UpdateFixtureCommand
  | DeleteFixtureCommand
  | UpdateRoomCommand
  | CreateRoomCommand
  | DeleteRoomCommand
  | CompositeCommand;

export class ApplyError extends Error {
  constructor(public readonly code: ApplyErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'ApplyError';
  }
}
