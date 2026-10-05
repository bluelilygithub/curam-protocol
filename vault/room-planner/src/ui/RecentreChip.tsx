// "Show room": appears in the plan when the room has been panned or zoomed mostly out of view, so it is never lost off the page.
import { useStore } from 'zustand';
import { worldToCanvas } from '../adapters/canvas';
import { aabbOf } from '../engine/geometry';
import { useApp, useProject, useUi } from './AppContext';

/** The fraction (0-1) of the room's on-screen box that is inside the viewport. */
export function visibleFraction(
  box: { min: { x: number; y: number }; max: { x: number; y: number } }, view: { scale: number; offsetX: number; offsetY: number }, viewport: { width: number; height: number },
): number {
  const a = worldToCanvas(box.min, view);
  const b = worldToCanvas(box.max, view);
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const area = (x1 - x0) * (y1 - y0);
  if (area <= 0) return 0;
  const ix = Math.max(0, Math.min(x1, viewport.width) - Math.max(x0, 0));
  const iy = Math.max(0, Math.min(y1, viewport.height) - Math.max(y0, 0));
  return (ix * iy) / area;
}

export function RecentreChip() {
  const app = useApp();
  const viewMode = useUi((s) => s.viewMode);
  const room = useProject((s) => s.project?.rooms[0]);
  const lost = useStore(app.view, (s) => {
    if (!room || room.vertices.length < 3) return false;
    const box = aabbOf(room.vertices.map((v) => v.position));
    return visibleFraction(box, s.view, s.viewport) < 0.25;
  });
  if (viewMode !== '2d' || !lost) return null;
  return (
    <div className="recentre" role="status" data-testid="recentre">
      <span>The room is out of view.</span>
      <button className="btn primary" onClick={() => app.fitToRoom()} title="Bring the whole room back to the middle of the page (Home)">Show room</button>
    </div>
  );
}
