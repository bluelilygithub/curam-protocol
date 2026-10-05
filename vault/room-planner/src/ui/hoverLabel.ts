// The label shown when the pointer rests over something in the 2D plan: its name and size. Pure.
import { pickAll } from '../engine/selection';
import type { Project, Vec2 } from '../engine/types';

const m = (n: number): string => String(Number(n.toFixed(2)));

/** Name and size of the topmost furniture or door/window under `world`, or null. Walls are not labelled (they are everywhere). */
export function hoverText(project: Project | null | undefined, world: Vec2, tolerance = 0.02): string | null {
  const room = project?.rooms[0];
  if (!project || !room) return null;
  const hit = pickAll(room, world, { tolerance }).find((h) => h.kind === 'furniture' || h.kind === 'fixture');
  if (!hit) return null;
  if (hit.kind === 'furniture') {
    const f = room.furniture.find((x) => x.id === hit.id);
    if (!f) return null;
    const name = project.furnitureDefinitions.find((d) => d.id === f.definitionId)?.name ?? 'Object';
    const up = f.elevation > 0.01 ? ` · at ${m(f.elevation)} m` : '';
    return `${name} · ${m(f.width)} × ${m(f.length)} × ${m(f.height)} m${up}`;
  }
  const fx = room.fixtures.find((x) => x.id === hit.id);
  if (!fx) return null;
  return `${fx.type === 'door' ? 'Door' : 'Window'} · ${m(fx.width)} × ${m(fx.height)} m`;
}
