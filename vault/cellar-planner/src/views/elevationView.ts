import { doorLayout, wallLengthMm } from '../enclosure/enclosure';
import type { Enclosure, WallKind, WallSide } from '../enclosure/types';
import type { Prim, Tone } from './primitives';

// The wall elevation: one wall seen from OUTSIDE, facing it. x runs left to right as the viewer sees it, y down from the top of the header.
// Looking at the north or east wall from outside, the wall's start is on the viewer's right, so those walls are drawn mirrored.

const toneOfWall = (k: WallKind): Tone => (k === 'GLASS' ? 'glass' : k === 'STUD' ? 'stud' : 'panel');

/** The wall whose face carries the header's vents and conditioner: the door wall if it runs east-west, else the south wall. */
export const headerFaceWall = (e: Enclosure): WallSide => (e.door.wall === 'NORTH' || e.door.wall === 'SOUTH' ? e.door.wall : 'SOUTH');

export function elevationView(e: Enclosure, side: WallSide): Prim[] {
  const out: Prim[] = [];
  const L = wallLengthMm(e, side);
  const H = e.heightMm, HH = e.headerHeightMm;
  const mirrored = side === 'NORTH' || side === 'EAST';
  const view = (s: number, width: number): number => (mirrored ? L - s - width : s);
  const groundY = HH + H;

  out.push({ kind: 'rect', x: 0, y: 0, w: L, h: HH, tone: 'header', label: 'HEADER' });
  out.push({ kind: 'rect', x: 0, y: HH, w: L, h: H, tone: toneOfWall(e.walls[side].kind), label: side });

  if (side === headerFaceWall(e)) {
    for (const c of e.header) {
      out.push({ kind: 'rect', x: c.xMm, y: HH - c.yMm - c.heightMm, w: c.widthMm, h: c.heightMm, tone: 'equipment', label: c.kind === 'VENT' ? 'VENT' : 'CELLAR MOTOR / CONDITIONER' });
      out.push({ kind: 'dim', x1: c.xMm, y1: HH - c.yMm - c.heightMm, x2: c.xMm + c.widthMm, y2: HH - c.yMm - c.heightMm, offset: -120, text: `${c.widthMm}` });
    }
  }

  if (side === e.door.wall) {
    const lay = doorLayout(e);
    const dx = view(lay.beforeMm, lay.doorMm);
    out.push({ kind: 'rect', x: dx, y: groundY - e.door.heightMm, w: lay.doorMm, h: e.door.heightMm, tone: e.door.glazed ? 'glass' : 'door', label: 'DOOR' });
    // the leaf's diagonal, as on the sample drawings: its point is on the HANDLE side, opposite the hinge. The hinge side is already as the viewer
    // sees it (the hinge is defined from outside), so left is the left edge of the drawn door on every wall.
    const hingeX = e.door.hinge === 'LEFT' ? dx : dx + lay.doorMm;
    const handleX = hingeX === dx ? dx + lay.doorMm : dx;
    out.push({ kind: 'poly', pts: [hingeX, groundY - e.door.heightMm, handleX, groundY - e.door.heightMm / 2, hingeX, groundY], tone: 'door', dash: true });
    // the door wall split either side of the door, as on the sample drawings
    const a = view(0, lay.beforeMm), c = view(lay.beforeMm + lay.doorMm, lay.afterMm);
    const parts: Array<[number, number, number]> = [[a, lay.beforeMm, 0], [dx, lay.doorMm, 0], [c, lay.afterMm, 0]];
    parts.sort((p, q) => p[0] - q[0]);
    for (const [x, w] of parts) out.push({ kind: 'dim', x1: x, y1: groundY, x2: x + w, y2: groundY, offset: 230, text: `${w}` });
    out.push({ kind: 'dim', x1: dx + lay.doorMm, y1: groundY, x2: dx + lay.doorMm, y2: groundY - e.door.heightMm, offset: 160, text: `${e.door.heightMm}` });
  }

  out.push({ kind: 'dim', x1: 0, y1: groundY, x2: L, y2: groundY, offset: 520, text: `${L}` });
  out.push({ kind: 'dim', x1: 0, y1: HH, x2: 0, y2: groundY, offset: 250, text: `${H}` });
  if (HH > 0) out.push({ kind: 'dim', x1: 0, y1: 0, x2: 0, y2: HH, offset: 250, text: `${HH}` });
  return out;
}
