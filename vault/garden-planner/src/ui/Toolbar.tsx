import { STRUCTURE_LABEL } from '../domain/edit';
import { SERVICE_KINDS, type ServiceKind, type StructureKind } from '../domain/types';
import type { Tool } from '../state/uiStore';
import { useApp, useProject, useUi } from './AppContext';
import { Icon } from './icons';

const TOOLS: Array<{ tool: Tool; icon: string; label: string; tip: string }> = [
  { tool: 'select', icon: 'select', label: 'Select', tip: 'Select and move things (Esc)' },
  { tool: 'boundary', icon: 'boundary', label: 'Plot', tip: 'Draw your plot boundary' },
  { tool: 'house', icon: 'house', label: 'House', tip: 'Draw the house footprint' },
  { tool: 'bed', icon: 'bed', label: 'Bed', tip: 'Draw a garden bed' },
  { tool: 'lawn', icon: 'lawn', label: 'Lawn', tip: 'Draw a lawn' },
  { tool: 'path', icon: 'path', label: 'Path', tip: 'Draw a path' },
  { tool: 'zone', icon: 'zone', label: 'Zone', tip: 'Mark a zone: front, back, side, courtyard' },
];

export function Toolbar() {
  const app = useApp();
  const tool = useUi((s) => s.tool);
  const viewMode = useUi((s) => s.viewMode);
  const structureKind = useUi((s) => s.structureKind);
  const serviceKind = useUi((s) => s.serviceKind);
  const smooth = useUi((s) => s.smoothShapes);
  const showGrid = useUi((s) => s.showGrid);
  const libraryOpen = useUi((s) => s.libraryOpen);
  const inspectorOpen = useUi((s) => s.inspectorOpen);
  const hasUnderlay = useProject((s) => !!s.project?.underlay);
  const canUndo = useProject((s) => s.canUndo);
  const canRedo = useProject((s) => s.canRedo);
  const undoLabel = useProject((s) => s.undoLabel);
  const redoLabel = useProject((s) => s.redoLabel);
  const name = useProject((s) => s.project?.name ?? '');
  const ui = app.ui.getState();

  return (
    <header className="toolbar" role="toolbar" aria-label="Garden tools">
      <div className="tb-group" data-tour="gp-project">
        <button type="button" className="tb-btn" title="Plants (show or hide the plant library)" aria-pressed={libraryOpen} onClick={() => ui.set({ libraryOpen: !libraryOpen })}><Icon name="plant" /><span>Plants</span></button>
        <button type="button" className="tb-btn" title="Your gardens: open, new, import, export" onClick={() => ui.set({ projectsOpen: true })}><Icon name="folder" /><span className="tb-name">{name || 'Gardens'}</span></button>
      </div>

      <div className="tb-group" role="group" aria-label="Draw" data-tour="gp-tools">
        {TOOLS.map((t) => (
          <button key={t.tool} type="button" className="tb-btn" title={t.tip} aria-pressed={tool === t.tool} disabled={viewMode === '3d'} onClick={() => app.setTool(t.tool)}>
            <Icon name={t.icon} /><span>{t.label}</span>
          </button>
        ))}
        <span className="tb-select" title="Place a structure: pergola, shed, deck, raised bed, water tank, clothesline, pool, retaining wall, trellis or gate">
          <button type="button" className="tb-btn" aria-pressed={tool === 'structure'} disabled={viewMode === '3d'} onClick={() => app.setTool('structure')}><Icon name="structure" /><span>{STRUCTURE_LABEL[structureKind]}</span></button>
          <select aria-label="Structure type" value={structureKind} onChange={(e) => { ui.set({ structureKind: e.target.value as StructureKind, tool: 'structure' }); }}>
            {(Object.keys(STRUCTURE_LABEL) as StructureKind[]).map((k) => <option key={k} value={k}>{STRUCTURE_LABEL[k]}</option>)}
          </select>
        </span>
        <span className="tb-select" title="Mark an underground service or easement (sewer, water, stormwater, gas, power, easement) so trees and invasive roots can be kept clear of it">
          <button type="button" className="tb-btn" aria-pressed={tool === 'service'} disabled={viewMode === '3d'} onClick={() => app.setTool('service')}><Icon name="pipe" /><span>{serviceKind === 'easement' ? 'Easement' : 'Service'}</span></button>
          <select aria-label="Service type" value={serviceKind} onChange={(e) => { ui.set({ serviceKind: e.target.value as ServiceKind, tool: 'service' }); }}>
            {SERVICE_KINDS.map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}
          </select>
        </span>
        {hasUnderlay && (
          <button type="button" className="tb-btn" title="Set the scale of your tracing picture by marking a known length" aria-pressed={tool === 'scale'} disabled={viewMode === '3d'} onClick={() => app.setTool('scale')}><Icon name="scale" /><span>Scale</span></button>
        )}
        <button type="button" className="tb-btn" title="Draw beds and lawns with curved edges" aria-pressed={smooth} disabled={viewMode === '3d'} onClick={() => ui.set({ smoothShapes: !smooth })}><span className="curve-glyph">~</span><span>Curves</span></button>
      </div>

      <div className="tb-group">
        <button type="button" className="tb-btn" title={undoLabel ? `Undo: ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'} disabled={!canUndo} onClick={() => app.undo()}><Icon name="undo" /></button>
        <button type="button" className="tb-btn" title={redoLabel ? `Redo: ${redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'} disabled={!canRedo} onClick={() => app.redo()}><Icon name="redo" /></button>
        <button type="button" className="tb-btn" title="Fit the whole garden in view" onClick={() => app.fitToPlot()}><Icon name="fit" /></button>
        <button type="button" className="tb-btn" title="Show or hide the grid" aria-pressed={showGrid} onClick={() => ui.set({ showGrid: !showGrid })}><Icon name="grid" /></button>
      </div>

      <div className="tb-group seg" role="group" aria-label="View" data-tour="gp-view">
        <button type="button" className="tb-btn" aria-pressed={viewMode === '2d'} title="Plan view" onClick={() => ui.set({ viewMode: '2d' })}><Icon name="map" /><span>2D</span></button>
        <button type="button" className="tb-btn" aria-pressed={viewMode === '3d'} title="3D view" onClick={() => ui.set({ viewMode: '3d', tool: 'select' })}><Icon name="cube" /><span>3D</span></button>
      </div>

      <div className="tb-group tb-right">
        <button type="button" className="tb-btn" title="Checks: problems found in the plan" onClick={() => ui.set({ inspectorOpen: true, rightTab: 'checks' })}><Icon name="alert" /></button>
        <button type="button" className="tb-btn" title="Show or hide the details panel" aria-pressed={inspectorOpen} onClick={() => ui.set({ inspectorOpen: !inspectorOpen })}><Icon name="panelRight" /></button>
        <button type="button" className="tb-btn" title="Take the guided tour" onClick={() => void app.startTour()}><Icon name="compass" /></button>
        {app.plantPhotos.isAdmin() && <button type="button" className="tb-btn" title="Plant photo curator (admin)" data-testid="open-curator" onClick={() => ui.set({ curatorOpen: true })}><Icon name="image" /></button>}
        <button type="button" className="tb-btn" title="How this works" onClick={() => ui.set({ infoOpen: true })}><Icon name="info" /></button>
      </div>
    </header>
  );
}
