import type { WallSide } from '../enclosure';

// "Where is the door?" as a picture: a small outline of the room (in its real proportions) with a button on each wall. Tap the wall the door is on.
// The same choice as the "Door on the" menu below it (they stay in step); this is just easier to understand than "South wall". The drawing's top is
// North, as everywhere else in the tool.

const SIDES: Array<{ wall: WallSide; label: string; short: string; cell: string }> = [
  { wall: 'NORTH', label: 'Top wall (North)', short: 'Top', cell: 'n' },
  { wall: 'WEST', label: 'Left wall (West)', short: 'Left', cell: 'w' },
  { wall: 'EAST', label: 'Right wall (East)', short: 'Right', cell: 'e' },
  { wall: 'SOUTH', label: 'Bottom wall (South)', short: 'Bottom', cell: 's' },
];

export function DoorPicker({ wall, widthMm, depthMm, onPick }: { wall: WallSide; widthMm: number; depthMm: number; onPick(w: WallSide): void }) {
  // the room's shape, so a long thin cellar looks long and thin; kept inside a fixed box
  const ratio = Math.max(0.45, Math.min(2.2, widthMm / depthMm));
  const w = ratio >= 1 ? 100 : 100 * ratio, h = ratio >= 1 ? 100 / ratio : 100;
  return (
    <div className="doorpick" role="radiogroup" aria-label="Which wall the door is on" data-testid="lite-doorpick">
      {SIDES.map((s) => (
        <button
          type="button" key={s.wall} role="radio" aria-checked={wall === s.wall}
          className={`doorpick-btn doorpick-${s.cell}${wall === s.wall ? ' on' : ''}`}
          onClick={() => onPick(s.wall)} title={`The door is on the ${s.label.toLowerCase()}.`} aria-label={s.label} data-testid={`lite-doorpick-${s.wall}`}
        >{wall === s.wall ? 'Door' : s.short}</button>
      ))}
      <div className="doorpick-room" aria-hidden="true">
        <div className="doorpick-floor" style={{ width: `${w}%`, height: `${h}%` }}>
          <span className={`doorpick-door doorpick-door-${wall.toLowerCase()}`} />
          <span className="doorpick-you">Your cellar</span>
        </div>
      </div>
    </div>
  );
}
