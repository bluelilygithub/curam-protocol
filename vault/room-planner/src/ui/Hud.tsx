import { worldToCanvas } from '../adapters/canvas';
import { footprintOf } from '../engine/footprints';
import { aabbOf } from '../engine/geometry';
import { useApp, useBus, useProject, useUi, useView } from './AppContext';
import { Icons } from './icons';
import { previewFurnitureEdit } from './inspectorLogic';

/** Tiny on-canvas strip for the selection: Rotate / Duplicate / Lock / Delete (Spec §6). It never competes with the inspector. */
export function Hud() {
  const app = useApp();
  const project = useProject((s) => s.project);
  const selection = useUi((s) => s.selection);
  const view = useView((s) => s.view);
  const gesturing = useBus((s) => s.previews.length > 0);
  const room = project?.rooms[0];
  const ids = selection.filter((s) => s.kind === 'furniture').map((s) => s.id);
  if (!project || !room || gesturing || ids.length === 0 || ids.length !== selection.length) return null;
  const insts = ids.map((id) => room.furniture.find((f) => f.id === id)).filter((f) => !!f);
  if (insts.length === 0) return null;
  const box = aabbOf(insts.flatMap((f) => footprintOf(f!)));
  const bottom = worldToCanvas({ x: (box.min.x + box.max.x) / 2, y: box.min.y }, view);
  const locked = insts.every((f) => f!.locked);
  const key = (k: string, ctrl = false) => app.interaction.keyDown({ key: k, ctrl, shift: false, alt: false });

  return (
    <div className="hud" style={{ left: bottom.x, top: bottom.y + 12 }} role="toolbar" aria-label="Selection actions">
      <button className="btn icon" title="Rotate 45° (R)" disabled={locked} onClick={() => key('r')}>{Icons.rotate}</button>
      <button className="btn icon" title="Duplicate (Ctrl+D)" onClick={() => app.interaction.duplicate(ids)}>{Icons.copy}</button>
      <button
        className={`btn icon ${locked ? 'active' : ''}`} title={locked ? 'Unlock' : 'Lock in place'} aria-pressed={locked}
        onClick={() => { const p = previewFurnitureEdit(project, ids, 'locked', !locked); if (p.command) app.project.getState().commitResult({ rejected: false, command: p.command }, p.label); }}
      >
        {locked ? Icons.lock : Icons.unlock}
      </button>
      <button className="btn icon danger" title="Delete" disabled={locked} onClick={() => key('Delete')}>{Icons.trash}</button>
    </div>
  );
}
