import { useEffect, useRef, useState } from 'react';
import { Garden3D } from '../render3d/Garden3D';
import { MONTH_NAMES } from '../plants/growth';
import { Plan2D } from '../render2d/Plan2D';
import { SUN_COLOURS } from '../sun/sunHours';
import { NumField } from './fields';
import { Icon } from './icons';
import { PLANT_DRAG_TYPE } from './PlantLibrary';
import { plantById, plantLabel } from '../plants/plants';
import { findItem } from '../domain/edit';
import { useApp, useProject, useUi } from './AppContext';

const HINTS: Record<string, string> = {
  select: 'Click to select. Drag to move. Drag a corner dot to reshape. Drag empty space to pan; scroll or pinch to zoom.',
  boundary: 'Click each corner of your plot, then click the first dot (or press Enter) to close it. Or drag out a rectangle.',
  house: 'Click the corners of the house footprint, then close it. Or drag out a rectangle.',
  bed: 'Click around the bed, then close it. Or drag out a rectangle. Beds are drawn with curved edges unless you turn Curves off.',
  lawn: 'Click around the lawn, then close it. Or drag out a rectangle.',
  zone: 'Click around a zone (front, back, side, courtyard), then close it.',
  service: 'Click along the line of the sewer, water or other service (or the middle of an easement). Double-click or press Enter to finish.',
  path: 'Click along the path. Double-click or press Enter to finish. Set its width in the panel.',
  structure: 'Click where the structure goes.',
  plant: 'Click to plant it. The plant is then selected: drag it to move, Duplicate for another, Delete to remove. Hold Shift while clicking to keep planting. Esc cancels.',
  scale: 'Click two points on your picture whose real distance apart you know, then type that distance.',
};

/** A field where keys mean text. A slider, checkbox or button does not: Ctrl+Z and Delete still work there. */
function isTyping(t: HTMLElement | null): boolean {
  if (!t) return false;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return true;
  return t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'file'].includes((t as HTMLInputElement).type);
}

export function Stage() {
  const app = useApp();
  const viewMode = useUi((s) => s.viewMode);
  const tool = useUi((s) => s.tool);
  const ref = useRef<HTMLDivElement>(null);
  const plan = useRef<Plan2D | null>(null);
  const three = useRef<Garden3D | null>(null);
  const hasProject = useProject((s) => s.project !== null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasProject) return undefined;
    if (viewMode === '2d') {
      const p = new Plan2D(el, app);
      plan.current = p;
      return () => { p.destroy(); plan.current = null; };
    }
    const g = new Garden3D(el, app);
    three.current = g;
    return () => { g.destroy(); three.current = null; };
  }, [viewMode, hasProject, app]);

  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (isTyping(e.target as HTMLElement | null)) return;
      const ui = app.ui.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) app.redo(); else app.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); app.redo(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); app.duplicateSelected(); return; }
      const p = plan.current;
      if (e.key === 'Escape') {
        if (p?.drawing) p.cancelDraft();
        else if (ui.tool !== 'select') app.setTool('select');
        else ui.select(null);
        return;
      }
      if (e.key === 'Enter' && p?.finishDraft()) return;
      if (e.key === 'Backspace' && p?.drawing) { e.preventDefault(); p.undoLastPoint(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selection) { e.preventDefault(); app.deleteSelected(); return; }
      if (ui.selection && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const d = e.shiftKey ? 1 : 0.1;
        app.nudgeSelected(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0);
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [app]);

  return (
    <div className="stage-wrap" data-tour="gp-stage">
      <div ref={ref} className="stage" data-view={viewMode}
        onDragOver={(e) => { if (viewMode === '2d' && e.dataTransfer.types.includes(PLANT_DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(PLANT_DRAG_TYPE);
          if (!id) return;
          e.preventDefault();
          if (viewMode !== '2d' || !plan.current) { app.notify('Switch to the 2D plan to drop a plant.', 'info'); return; }
          plan.current.dropPlant(id, e.clientX, e.clientY, e.shiftKey);
        }} />
      {viewMode === '2d' && <p className="hint-banner">{HINTS[tool]}</p>}
      {viewMode === '3d' && (
        <div className="view3d-bar" role="group" aria-label="3D camera">
          <button type="button" title="Isometric view" onClick={() => three.current?.iso()}>Iso</button>
          <button type="button" title="Straight down" onClick={() => three.current?.top()}>Top</button>
          <button type="button" title="From the front" onClick={() => three.current?.front()}>Front</button>
        </div>
      )}
      {viewMode === '2d' && <SelectionBar />}
      <ScalePrompt />
      {viewMode === '2d' && <SunLegend />}
    </div>
  );
}

/** On-canvas actions for the selected item (like Room Planner's): Duplicate (Ctrl+D) and Delete (Del). Boundary and house cannot be duplicated. */
function SelectionBar() {
  const app = useApp();
  const sel = useUi((s) => s.selection);
  const tool = useUi((s) => s.tool);
  const name = useProject((s) => {
    if (!sel || !s.project) return '';
    const it = findItem(s.project, sel) as { plantId?: string; name?: string } | null;
    if (!it) return '';
    if (sel.kind === 'plant') { const r = plantById(it.plantId ?? ''); return r ? plantLabel(r) : 'Plant'; }
    return it.name ?? sel.kind;
  });
  if (!sel || tool !== 'select' || !name) return null;
  const copyable = sel.kind !== 'boundary' && sel.kind !== 'house';
  return (
    <div className="selbar" role="toolbar" aria-label="Selected item" data-testid="selection-bar">
      <span className="selbar-name">{name}</span>
      {copyable && <button type="button" className="btn" title="Make a copy beside this one (Ctrl+D)" onClick={() => app.duplicateSelected()}><Icon name="copy" size={15} /> Duplicate</button>}
      <button type="button" className="btn danger" title="Delete (Del)" onClick={() => app.deleteSelected()}><Icon name="trash" size={15} /> Delete</button>
      <button type="button" className="btn" title="Done (Esc)" onClick={() => app.ui.getState().select(null)}>Done</button>
    </div>
  );
}

/** After two clicks on the tracing picture: ask for the real distance between them. */
function ScalePrompt() {
  const app = useApp();
  const draft = useUi((s) => s.scaleDraft);
  const [len, setLen] = useState(5);
  if (!draft?.b) return null;
  return (
    <div className="scale-prompt" role="dialog" aria-label="Set picture scale">
      <p>How far apart are those two points in real life?</p>
      <NumField label="Distance" unit="m" value={len} min={0.1} max={500} step={0.1} onCommit={setLen} />
      <div className="row">
        <button type="button" className="btn primary" onClick={() => { if (!app.applyScale(len)) app.notify('Could not set the scale. Try two different points.', 'warn'); }}>Set scale</button>
        <button type="button" className="btn" onClick={() => app.ui.getState().set({ scaleDraft: null })}>Start again</button>
      </div>
    </div>
  );
}

const rgb = (l: 'full_sun' | 'part_shade' | 'shade'): string => `rgb(${SUN_COLOURS[l].join(',')})`;

/** Key to the sun map, with the two thresholds as settings (spec 8: full sun 6+ h, part shade 3-6 h, shade under 3 h by default). */
function SunLegend() {
  const app = useApp();
  const showSun = useUi((s) => s.showSun);
  const t = useUi((s) => s.sunThresholds);
  const month = useUi((s) => s.month);
  if (!showSun) return null;
  const set = (next: { fullSunHours: number; partShadeHours: number }): void => app.ui.getState().set({ sunThresholds: next });
  return (
    <div className="sun-legend" aria-label="Sun map key" data-testid="sun-legend">
      <h4>Hours of direct sun a day, {MONTH_NAMES[month - 1]}</h4>
      <div className="row"><span className="sw" style={{ background: rgb('full_sun') }} /> Full sun: {t.fullSunHours} h or more</div>
      <div className="row"><span className="sw" style={{ background: rgb('part_shade') }} /> Part shade: {t.partShadeHours} to {t.fullSunHours} h</div>
      <div className="row"><span className="sw" style={{ background: rgb('shade') }} /> Shade: under {t.partShadeHours} h</div>
      <div className="grid2">
        <NumField label="Full sun from" unit="h" value={t.fullSunHours} min={t.partShadeHours + 0.5} max={16} step={0.5} decimals={1} onCommit={(v) => set({ ...t, fullSunHours: v })} />
        <NumField label="Part shade from" unit="h" value={t.partShadeHours} min={0.5} max={t.fullSunHours - 0.5} step={0.5} decimals={1} onCommit={(v) => set({ ...t, partShadeHours: v })} />
      </div>
      <p className="note">Counts the hours the sun is at least 3 degrees up. Hover the plan for a spot's hours.</p>
    </div>
  );
}
