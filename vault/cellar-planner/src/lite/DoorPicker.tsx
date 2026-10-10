import type { KeyboardEvent, ReactElement } from 'react';
import type { WallSide } from '../enclosure';
import type { DoorPosition } from './settings';

// "Where is the door?" as a drawing of the room from above: the room in its real proportions, its four walls labelled and tappable, and the door
// drawn as an actual opening with the way it swings, at the position and width chosen (a single door is narrower than a double one). So what is
// selected can be SEEN, not decoded. The wall menu this replaced is gone; keyboard users tab to a wall and press Enter or Space.
// The top of the drawing is North, as everywhere else in the tool. Left / Right are as seen standing outside facing the door.

const W = 400, H = 262;           // drawing size (wide enough that the side labels clear the door swing)
const BOX = { w: 204, h: 126 };   // the largest the room outline can be
const BAND = 11;                    // drawn wall thickness
const HIT = 46;                     // tappable thickness of a wall

const WALLS: Array<{ wall: WallSide; label: string; name: string }> = [
  { wall: 'NORTH', label: 'Top wall (North)', name: 'Top' },
  { wall: 'SOUTH', label: 'Bottom wall (South)', name: 'Bottom' },
  { wall: 'WEST', label: 'Left wall (West)', name: 'Left' },
  { wall: 'EAST', label: 'Right wall (East)', name: 'Right' },
];

/** Where along its wall the door starts, 0 to 1 of the free length, as drawn from above (north-south or west-east order). */
function startFraction(wall: WallSide, pos: DoorPosition): number {
  if (pos === 'CENTRE') return 0.5;
  // standing outside: south wall -> your left is west (the start of the drawing's left-to-right); west wall -> your left is north (the start);
  // north wall -> your left is east (the end); east wall -> your left is south (the end)
  const leftIsStart = wall === 'SOUTH' || wall === 'WEST';
  return (pos === 'LEFT') === leftIsStart ? 0.06 : 0.94;
}

export function describeDoor(wall: WallSide, pos: DoorPosition, double: boolean): string {
  const w = WALLS.find((x) => x.wall === wall)?.label.toLowerCase() ?? '';
  const where = pos === 'CENTRE' ? 'in the middle' : `toward the ${pos.toLowerCase()} end`;
  return `${double ? 'Double' : 'Single'} door on the ${w}, ${where}.`;
}

export function DoorPicker({ wall, pos, double, widthMm, depthMm, doorMm, onPick }: { wall: WallSide; pos: DoorPosition; double: boolean; widthMm: number; depthMm: number; doorMm: number; onPick(w: WallSide): void }) {
  // the room outline: proportional to the real inside, kept inside BOX
  const ratio = Math.max(0.5, Math.min(2.4, widthMm / depthMm));
  const rw = ratio >= BOX.w / BOX.h ? BOX.w : BOX.h * ratio, rh = ratio >= BOX.w / BOX.h ? BOX.w / ratio : BOX.h;
  const rx = (W - rw) / 2, ry = (H - rh) / 2;
  const horizontal = wall === 'NORTH' || wall === 'SOUTH';
  const wallLenPx = horizontal ? rw : rh, wallLenMm = horizontal ? widthMm : depthMm;
  const doorPx = Math.max(16, Math.min(wallLenPx * 0.7, (doorMm / wallLenMm) * wallLenPx));
  const along = (wallLenPx - doorPx) * startFraction(wall, pos);
  // the door's opening sits in the wall band; each leaf is hinged at an outer edge and swings a quarter turn OUTWARD (as the plan view draws it)
  // the swing is drawn at most 40 px across, so it always stays inside the picture
  const leaves = double ? 2 : 1, leafPx = Math.min(40, doorPx / leaves);
  const parts: ReactElement[] = [];
  /** One leaf: a line in its open position (straight out from the hinge) and the quarter circle it sweeps from closed (along the wall) to open. */
  const leaf = (hx: number, hy: number, closedDeg: number, openDeg: number, k: string): void => {
    const rad = (d: number): number => (d * Math.PI) / 180;
    const sweep = ((openDeg - closedDeg + 360) % 360) === 90 ? 1 : 0;
    parts.push(<line key={`l${k}`} x1={hx} y1={hy} x2={hx + leafPx * Math.cos(rad(openDeg))} y2={hy + leafPx * Math.sin(rad(openDeg))} className="doorpick-leaf" />);
    parts.push(<path key={`a${k}`} d={`M ${hx + leafPx * Math.cos(rad(closedDeg))} ${hy + leafPx * Math.sin(rad(closedDeg))} A ${leafPx} ${leafPx} 0 0 ${sweep} ${hx + leafPx * Math.cos(rad(openDeg))} ${hy + leafPx * Math.sin(rad(openDeg))}`} className="doorpick-swing" />);
  };
  let gap: ReactElement;
  if (horizontal) {
    const x0 = rx + along, y = wall === 'NORTH' ? ry : ry + rh;
    gap = <rect x={x0} y={y - BAND / 2 - 1} width={doorPx} height={BAND + 2} className="doorpick-gap" />;
    const open = wall === 'NORTH' ? 270 : 90;       // straight out: up for the top wall, down for the bottom wall
    leaf(x0, y, 0, open, '0');                      // hinged at the left edge, closed pointing right
    if (leaves === 2) leaf(x0 + doorPx, y, 180, open, '1'); // the second leaf hinged at the right edge, closed pointing left
  } else {
    const y0 = ry + along, x = wall === 'WEST' ? rx : rx + rw;
    gap = <rect x={x - BAND / 2 - 1} y={y0} width={BAND + 2} height={doorPx} className="doorpick-gap" />;
    const open = wall === 'WEST' ? 180 : 0;         // straight out: left for the left wall, right for the right wall
    leaf(x, y0, 90, open, '0');                     // hinged at the top edge, closed pointing down
    if (leaves === 2) leaf(x, y0 + doorPx, 270, open, '1');
  }

  // the four tappable walls: a wide transparent strip over each, with its own label outside the room
  const hits: Record<WallSide, { x: number; y: number; w: number; h: number; tx: number; ty: number; anchor: 'middle' | 'end' | 'start' }> = {
    // each zone runs from the picture edge (where its label is) to a little inside the wall, so the label and the wall are one big tap target
    NORTH: { x: rx - 4, y: 0, w: rw + 8, h: ry + HIT / 2, tx: W / 2, ty: 15, anchor: 'middle' },
    SOUTH: { x: rx - 4, y: ry + rh - HIT / 2, w: rw + 8, h: H - (ry + rh - HIT / 2), tx: W / 2, ty: H - 7, anchor: 'middle' },
    WEST: { x: 0, y: ry + 6, w: rx + HIT / 2, h: rh - 12, tx: 6, ty: H / 2 + 4, anchor: 'start' },
    EAST: { x: rx + rw - HIT / 2, y: ry + 6, w: W - (rx + rw - HIT / 2), h: rh - 12, tx: W - 6, ty: H / 2 + 4, anchor: 'end' },
  };
  const key = (e: KeyboardEvent<SVGGElement>, w: WallSide): void => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(w); } };

  return (
    <div className="doorpick" role="radiogroup" aria-label="Which wall the door is on" data-testid="lite-doorpick">
      <svg viewBox={`0 0 ${W} ${H}`} className="doorpick-svg" focusable="false">
        <rect x={rx} y={ry} width={rw} height={rh} className="doorpick-floor" />
        <text x={W / 2} y={H / 2 + 4} textAnchor="middle" className="doorpick-you" aria-hidden="true">Your cellar</text>
        {/* the four walls, drawn, with the chosen one in the brand colour */}
        {WALLS.map(({ wall: w }) => {
          const on = w === wall;
          const horiz = w === 'NORTH' || w === 'SOUTH';
          const bx = horiz ? rx : (w === 'WEST' ? rx - BAND / 2 : rx + rw - BAND / 2), by = horiz ? (w === 'NORTH' ? ry - BAND / 2 : ry + rh - BAND / 2) : ry;
          return <rect key={w} x={bx} y={by} width={horiz ? rw : BAND} height={horiz ? BAND : rh} className={`doorpick-wall${on ? ' on' : ''}`} />;
        })}
        {gap}
        {parts}
        {WALLS.map(({ wall: w, label, name }) => {
          const h = hits[w];
          const on = w === wall;
          return (
            <g key={w} role="radio" aria-checked={on} aria-label={label} tabIndex={0} className={`doorpick-hit${on ? ' on' : ''}`} onClick={() => onPick(w)} onKeyDown={(e) => key(e, w)} data-testid={`lite-doorpick-${w}`}>
              <title>{`The door is on the ${label.toLowerCase()}.`}</title>
              <rect x={h.x} y={h.y} width={h.w} height={h.h} rx={8} className="doorpick-hitbox" />
              <text x={h.tx} y={h.ty} textAnchor={h.anchor} className={`doorpick-label${on ? ' on' : ''}`}>{name}</text>
            </g>
          );
        })}
      </svg>
      <p className="doorpick-caption" data-testid="lite-doorsummary">{describeDoor(wall, pos, double)}</p>
    </div>
  );
}
