// Domain-agnostic base types shared by every planner (Room Planner, Garden Planner). Metres everywhere; the screen's Y flip lives
// only in adapters/canvas.ts.
export type Metres = number;
export interface Vec2 { x: Metres; y: Metres }
export interface Vertex { id: string; position: Vec2 }
export interface AABB { min: Vec2; max: Vec2 }
export interface Interval { min: Metres; max: Metres }

export type PolygonErrorCode =
  | 'SELF_INTERSECTION'
  | 'ZERO_AREA'
  | 'DEGENERATE_EDGE'
  | 'DUPLICATE_VERTEX'
  | 'TOO_FEW_VERTICES';

/** Anything with a centre, size and rotation: can be tested for collision and snapped. */
export interface Footprinted { position: Vec2; width: Metres; length: Metres; rotation: number }
