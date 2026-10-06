// The glass-enclosure model (spec-v1.md sections 14 to 16, PROPOSED). A free-standing walk-in: four walls (insulated panel, framed glass or stud),
// a door, a ceiling header that carries the conditioner and vents. Whole millimetres. All defaults are read from the Carter Noir sample drawings
// and are UNVERIFIED until the owner confirms them. Racking inside is separate (no supplier sheet yet).

export type WallSide = 'NORTH' | 'EAST' | 'SOUTH' | 'WEST';
export type WallKind = 'PANEL' | 'GLASS' | 'STUD';

export interface EnclosureWall {
  kind: WallKind;
  /** Thickness of the wall build-up, inside the outer face. */
  buildUpMm: number;
}

export interface DoorSpec {
  wall: WallSide;
  widthMm: number;
  heightMm: number;
  swing: 'OUT' | 'IN';
  hinge: 'LEFT' | 'RIGHT';
  glazed: boolean;
  /** Distance from the start of the wall (west or north end) to the door's near edge. Centred when absent. */
  offsetMm?: number;
}

export type HeaderKind = 'CONDITIONER' | 'VENT';
/** Something on the front face of the ceiling header, positioned from the header's left end and its bottom edge. */
export interface HeaderComponent {
  id: string;
  kind: HeaderKind;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export interface Enclosure {
  /** Outer faces: width runs along the north and south walls, depth along east and west. */
  outerWidthMm: number;
  outerDepthMm: number;
  /** Height of the enclosure itself, floor to top of the ceiling panel. */
  heightMm: number;
  ceilingBuildUpMm: number;
  floorBuildUpMm: number;
  walls: Record<WallSide, EnclosureWall>;
  door: DoorSpec;
  /** Height of the box above the enclosure that holds the conditioner. */
  headerHeightMm: number;
  header: HeaderComponent[];
}

export interface InternalSize { widthMm: number; depthMm: number; heightMm: number }
export interface DoorLayout {
  wallLengthMm: number;
  /** Fixed panel (or glass) either side of the door, along the door wall. */
  beforeMm: number;
  afterMm: number;
  doorMm: number;
}
export interface Advisory { code: string; text: string }
