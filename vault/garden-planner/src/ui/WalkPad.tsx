// On-screen joystick for walk mode (touch, or a mouse if you like): drag the knob to walk; up = forward, sideways = strafe. It writes the shared
// walk input (not a store: it changes on every pointer move). Shown only while walking. Looking around is done by dragging the picture.
import { useRef, useState } from 'react';
import { useApp, useUi } from './AppContext';

const RADIUS = 48; // knob travel in px

export function WalkPad() {
  const app = useApp();
  const walking = useUi((s) => s.walking);
  const pad = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);
  if (!walking) return null;

  const move = (e: React.PointerEvent): void => {
    if (active.current !== e.pointerId || !pad.current) return;
    const r = pad.current.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) { dx = (dx / len) * RADIUS; dy = (dy / len) * RADIUS; }
    setKnob({ x: dx, y: dy });
    app.walkInput.padX = dx / RADIUS;
    app.walkInput.padY = -dy / RADIUS;
  };
  const end = (e: React.PointerEvent): void => {
    if (active.current !== e.pointerId) return;
    active.current = null;
    setKnob({ x: 0, y: 0 });
    app.walkInput.padX = 0;
    app.walkInput.padY = 0;
  };

  return (
    <div
      ref={pad} className="walkpad" role="group" aria-label="Walking pad: drag to walk" data-testid="walkpad"
      onPointerDown={(e) => { active.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); move(e); }}
      onPointerMove={move} onPointerUp={end} onPointerCancel={end}
    >
      <div className="walkpad-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
