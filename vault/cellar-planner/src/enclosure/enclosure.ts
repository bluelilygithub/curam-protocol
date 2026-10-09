import type { Advisory, DoorLayout, Enclosure, InternalSize, WallSide } from './types';
import type { Issue } from '../engine/types';

// Pure maths and checks for the glass enclosure (spec-v1.md sections 15 and 16).

/** Every advisory starts with this, so it can never be mistaken for a check that blocks a design. */
export const ADVISORY_PREFIX = 'Advisory only: requires mechanical engineer / HVAC sign-off. ';

/** Length of one wall measured along its outer face. */
export const wallLengthMm = (e: Enclosure, side: WallSide): number => (side === 'NORTH' || side === 'SOUTH' ? e.outerWidthMm : e.outerDepthMm);

/** Inside size: the outer size less each wall's build-up (and the ceiling and floor). */
export function internalSize(e: Enclosure): InternalSize {
  return {
    widthMm: e.outerWidthMm - e.walls.WEST.buildUpMm - e.walls.EAST.buildUpMm,
    depthMm: e.outerDepthMm - e.walls.NORTH.buildUpMm - e.walls.SOUTH.buildUpMm,
    heightMm: e.heightMm - e.ceilingBuildUpMm - e.floorBuildUpMm,
  };
}

/** The door wall split into fixed section, door, fixed section. Centred unless the door has an offset; an odd millimetre goes after the door. */
export function doorLayout(e: Enclosure): DoorLayout {
  const wallLengthMmValue = wallLengthMm(e, e.door.wall);
  const free = wallLengthMmValue - e.door.widthMm;
  const beforeMm = e.door.offsetMm ?? Math.floor(free / 2);
  return { wallLengthMm: wallLengthMmValue, beforeMm, doorMm: e.door.widthMm, afterMm: wallLengthMmValue - beforeMm - e.door.widthMm };
}

/**
 * The floor a door's leaf sweeps when open: a quarter circle of radius = door width on the side it swings to, hinged at one end of the opening.
 * Outside the enclosure for OUT, inside for IN (so inside it is floor that racking must stay clear of).
 */
/** 1 for a single door (also when unset), 2 for a double door. */
export const doorLeafCount = (e: Enclosure): 1 | 2 => (e.door.leaves === 2 ? 2 : 1);
/** Width of one leaf: the whole door for a single door, half the opening for a double door. */
export const doorLeafWidthMm = (e: Enclosure): number => e.door.widthMm / doorLeafCount(e);

export function doorSwing(e: Enclosure): { radiusMm: number; side: 'OUTSIDE' | 'INSIDE'; hinge: 'LEFT' | 'RIGHT'; wall: WallSide } {
  return { radiusMm: doorLeafWidthMm(e), side: e.door.swing === 'OUT' ? 'OUTSIDE' : 'INSIDE', hinge: e.door.hinge, wall: e.door.wall };
}

/** Share of the enclosure's outer wall area that is glass: glass walls plus a glazed door (the door replaces wall area on its own wall). */
export function glassFraction(e: Enclosure): number {
  const sides: WallSide[] = ['NORTH', 'EAST', 'SOUTH', 'WEST'];
  let total = 0, glass = 0;
  for (const s of sides) {
    const area = wallLengthMm(e, s) * e.heightMm;
    total += area;
    const doorHere = e.door.wall === s ? e.door.widthMm * Math.min(e.door.heightMm, e.heightMm) : 0;
    const wallGlass = e.walls[s].kind === 'GLASS' ? area - doorHere : 0;
    glass += wallGlass + (doorHere && e.door.glazed ? doorHere : 0);
  }
  return total ? glass / total : 0;
}

const overlap = (a: { xMm: number; yMm: number; widthMm: number; heightMm: number }, b: typeof a): boolean =>
  a.xMm < b.xMm + b.widthMm && b.xMm < a.xMm + a.widthMm && a.yMm < b.yMm + b.heightMm && b.yMm < a.yMm + a.heightMm;

/** Design checks. Real errors only: climate and glass guidance is in `advisories`, never here. */
export function checkEnclosure(e: Enclosure): Issue[] {
  const out: Issue[] = [];
  const inner = internalSize(e);
  if (inner.widthMm < 500 || inner.depthMm < 500 || inner.heightMm < 1800) {
    out.push({ code: 'INTERNAL_TOO_SMALL', severity: 'error', message: `The inside is only ${inner.widthMm} x ${inner.depthMm} x ${inner.heightMm} mm.`, fix: 'Make the enclosure bigger or the wall build-up thinner.' });
  }
  const layout = doorLayout(e);
  if (e.door.widthMm > layout.wallLengthMm - 2 * 50) {
    out.push({ code: 'DOOR_TOO_WIDE', severity: 'error', message: `A ${e.door.widthMm} mm door does not fit a ${layout.wallLengthMm} mm wall with a fixed section either side.`, fix: `Make the door ${layout.wallLengthMm - 100} mm wide or less.` });
  } else if (layout.beforeMm < 0 || layout.afterMm < 0) {
    out.push({ code: 'DOOR_OFF_WALL', severity: 'error', message: 'The door runs past the end of its wall.', fix: 'Move the door onto the wall.' });
  }
  if (doorLeafCount(e) === 2 && e.door.widthMm < 800) {
    out.push({ code: 'DOUBLE_DOOR_TOO_NARROW', severity: 'error', message: `A double door ${e.door.widthMm} mm wide has leaves only ${doorLeafWidthMm(e)} mm wide, too narrow to walk through.`, fix: 'Make the opening at least 800 mm, or use a single door.' });
  }
  if (e.door.heightMm > inner.heightMm) {
    out.push({ code: 'DOOR_TOO_TALL', severity: 'error', message: `The door is ${e.door.heightMm} mm tall but the inside is ${inner.heightMm} mm.`, fix: `Make the door ${inner.heightMm} mm or less.` });
  }
  if (e.door.swing === 'IN') {
    out.push({ code: 'DOOR_SWINGS_IN', severity: 'info', message: doorLeafCount(e) === 2 ? `The double door swings in: keep a ${doorLeafWidthMm(e)} mm radius of floor inside clear of racking at each end of the opening.` : `The door swings in: keep a ${e.door.widthMm} mm radius of floor inside clear of racking.` });
  }

  const parts = e.header;
  for (const c of parts) {
    if (c.xMm < 0 || c.xMm + c.widthMm > e.outerWidthMm || c.yMm < 0 || c.yMm + c.heightMm > e.headerHeightMm) {
      out.push({ code: 'HEADER_COMPONENT_OUTSIDE', severity: 'error', message: `${c.kind === 'VENT' ? 'A vent' : 'The conditioner'} (${c.id}) does not fit inside the ${e.outerWidthMm} x ${e.headerHeightMm} mm header.`, fix: 'Move or resize it.', where: c.id });
    }
  }
  parts.forEach((a, i) => parts.slice(i + 1).forEach((b) => {
    if (overlap(a, b)) out.push({ code: 'HEADER_OVERLAP', severity: 'error', message: `${a.id} and ${b.id} overlap in the header.`, where: a.id });
  }));
  if (!parts.some((c) => c.kind === 'CONDITIONER')) out.push({ code: 'NO_CONDITIONER', severity: 'warning', message: 'No conditioner is placed in the header.' });
  return out;
}

/** Guidance from the Kings Winehaus guide. Information only (spec-v1.md section 16): never an error, never blocks a design. */
export function advisories(e: Enclosure): Advisory[] {
  const out: Advisory[] = [];
  const add = (code: string, text: string): void => { out.push({ code, text: ADVISORY_PREFIX + text }); };
  const frac = glassFraction(e);
  if (frac > 0.5) add('GLASS_AREA', `${Math.round(frac * 100)}% of the wall area is glass. The guide suggests at most 50% of cellar walls, so expect a higher cooling load; free-standing glass cabinets are usually well above that.`);
  if (frac > 0) add('GLASS_SPEC', 'Glass should be about 1.4 W/m2K or better (4 mm glass, 16 mm argon, 4 mm glass); frames thermally broken; doors sealed on all four sides.');
  for (const side of ['NORTH', 'EAST', 'SOUTH', 'WEST'] as const) {
    const w = e.walls[side];
    if (w.kind === 'PANEL' && w.buildUpMm < 50) add('INSULATION_THIN', `The ${side.toLowerCase()} wall is ${w.buildUpMm} mm. The guide recommends 50 to 80 mm polyurethane foam (expanded polystyrene needs about double).`);
  }
  add('NO_HEAT_SOURCES', 'No heat source inside the enclosure; slab heating should be at least 500 mm from the perimeter walls, with a thermal break.');
  return out;
}

export interface EnclosureAnalysis {
  internal: InternalSize;
  door: DoorLayout;
  glassFraction: number;
  issues: Issue[];
  advisories: Advisory[];
}

export function analyseEnclosure(e: Enclosure): EnclosureAnalysis {
  return { internal: internalSize(e), door: doorLayout(e), glassFraction: glassFraction(e), issues: checkEnclosure(e), advisories: advisories(e) };
}
