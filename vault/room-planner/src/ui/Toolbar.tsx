import { useApp, useLibrary, useProject, useUi } from './AppContext';
import { Icons } from './icons';
import { GRID_SIZES, type SnapMode, type Tool } from '../state/uiStore';

const TOOLS: Array<{ tool: Tool; key: string; label: string; icon: keyof typeof Icons; disabled?: boolean; hint?: string }> = [
  { tool: 'select', key: '1', label: 'Select', icon: 'select' },
  { tool: 'pan', key: '2', label: 'Pan', icon: 'pan' },
  { tool: 'wall_edit', key: '3', label: 'Walls', icon: 'wall', hint: 'Walls (3): drag corners, double-click a wall to add a corner, or draw a room' },
  { tool: 'measure', key: '4', label: 'Measure', icon: 'measure' },
];

export function Toolbar() {
  const app = useApp();
  const tool = useUi((s) => s.tool);
  const viewMode = useUi((s) => s.viewMode);
  const showClearances = useUi((s) => s.showClearances);
  const showGrid = useUi((s) => s.showGrid);
  const snapMode = useUi((s) => s.snapMode);
  const grid = useUi((s) => s.grid);
  const leftOpen = useUi((s) => s.leftOpen);
  const rightOpen = useUi((s) => s.rightOpen);
  const status = useLibrary((s) => s.status);
  const kind = useLibrary((s) => s.kind);
  const note = useLibrary((s) => s.note);
  const error = useLibrary((s) => s.error);
  const name = useProject((s) => s.document?.name ?? s.document?.rooms[0]?.name);
  const canUndo = useProject((s) => s.canUndo);
  const canRedo = useProject((s) => s.canRedo);
  const undoLabel = useProject((s) => s.undoLabel);
  const redoLabel = useProject((s) => s.redoLabel);
  const hasRoom = useProject((s) => !!s.project?.rooms.length);

  const undo = () => app.interaction.keyDown({ key: 'z', ctrl: true, shift: false, alt: false });
  const redo = () => app.interaction.keyDown({ key: 'z', ctrl: true, shift: true, alt: false });

  return (
    <header className="toolbar" role="toolbar" aria-label="Main toolbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">Room Planner</span>
        <span className="title-help">
          <button onClick={() => void app.startTour()} aria-label="Take the Room Planner tour" title="Take the Room Planner tour">{Icons.compass}</button>
          <button onClick={() => app.ui.getState().setInfoOpen(true)} aria-label="How this works" title="How this works">{Icons.info}</button>
        </span>
      </div>

      <div className="group" role="group" aria-label="Tools" data-tour="rp-tools">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            className={`btn icon ${tool === t.tool ? 'active' : ''}`}
            disabled={t.disabled || (viewMode === '3d' && t.tool !== 'select')}
            aria-pressed={tool === t.tool}
            title={t.hint ?? `${t.label} (${t.key})`}
            onClick={() => app.interaction.setTool(t.tool)}
          >
            {Icons[t.icon]}
            <span className="kbd">{t.key}</span>
          </button>
        ))}
      </div>

      <div className="group seg3d" role="group" aria-label="Switch view" data-tour="rp-view">
        <button className={`btn ${viewMode === '2d' ? 'active' : ''}`} aria-pressed={viewMode === '2d'} title="2D plan view (V)" onClick={() => app.setViewMode('2d')}>
          <span className="label">2D</span>
        </button>
        <button className={`btn ${viewMode === '3d' ? 'active' : ''}`} aria-pressed={viewMode === '3d'} disabled={!hasRoom} title="3D view (V)" onClick={() => app.setViewMode('3d')}>
          <span className="label">3D</span>
        </button>
      </div>

      <div className="group" role="group" aria-label="History">
        <button className="btn icon" disabled={!canUndo} onClick={undo} aria-label={canUndo && undoLabel ? `Undo · ${undoLabel}` : 'Undo'} title={undoLabel ? `Undo · ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'}>
          {Icons.undo}
        </button>
        <button className="btn icon" disabled={!canRedo} onClick={redo} aria-label={canRedo && redoLabel ? `Redo · ${redoLabel}` : 'Redo'} title={redoLabel ? `Redo · ${redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'}>
          {Icons.redo}
        </button>
      </div>

      <div className="group" role="group" aria-label="View">
        <button className={`btn icon ${showClearances ? 'active' : ''}`} aria-pressed={showClearances} title="Show clearance zones of the selection" onClick={() => app.ui.getState().toggleClearances()}>
          {Icons.clearance}
        </button>
        <button className={`btn icon ${showGrid ? 'active' : ''}`} aria-pressed={showGrid} title="Grid" onClick={() => app.ui.getState().toggleGrid()}>
          {Icons.grid}
        </button>
        {viewMode === '2d' && tool !== 'pan' && (<>
        <label className="snap-select" title="Snapping while you drag. Smart: corners, walls, furniture edges and centres, alignment and grid. Grid only: pieces land with their edges on grid lines measured from the room's first corner. Off: no snapping. Hold Alt while dragging to skip it for one move.">
          <span className="label">Snap</span>
          <select aria-label="Snap mode" value={snapMode} onChange={(e) => app.setSnapMode(e.target.value as SnapMode)}>
            <option value="smart">Smart</option>
            <option value="grid">Grid only</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label className="snap-select" title="Grid spacing, measured from the room's first corner. Used by Grid only and by Smart.">
          <span className="label">Grid</span>
          <select aria-label="Grid size" value={grid} onChange={(e) => app.setGrid(Number(e.target.value))}>
            {GRID_SIZES.map((g) => <option key={g} value={g}>{g * 100} cm</option>)}
          </select>
        </label>
        </>)}
        <button className="btn icon" disabled={!hasRoom} title={viewMode === '3d' ? 'Fit room to view' : 'Bring the whole room back to the middle of the page (Home)'} onClick={() => (viewMode === '3d' ? app.cameraPreset('fit') : app.fitToRoom())}>{Icons.fit}</button>
      </div>

      <div className="spacer" />

      <div className="group" role="group" aria-label="Project" data-tour="rp-project">
        <button className="btn project-button" onClick={() => app.ui.getState().setProjectsOpen(true)} title="Projects: new, open, rename, duplicate, delete, import, export">
          {Icons.file}<span className="label">{name || 'Projects'}</span>
        </button>
        <button className="btn" disabled={!hasRoom} onClick={() => app.ui.getState().setScheduleOpen(true)} title="Furniture schedule: what is in the room, with quantities, sizes and costs. Download it as a CSV for a spreadsheet, or as a PDF with a to-scale plan.">
          {Icons.list}<span className="label">Schedule</span>
        </button>
        {(status === 'unsaved' || status === 'error' || status === 'conflict') && (
          <button className="btn" onClick={() => void app.saveProject()} title="Save now (autosave also runs a moment after each change)">
            <span className="label">Save</span>
          </button>
        )}
      </div>

      <span
        className={`save-status ${status === 'unsaved' ? 'warn' : status === 'error' || status === 'conflict' ? 'bad' : ''}`}
        role="status"
        title={`${kind === 'server' ? 'Saved to your Vault account.' : 'Saved in this browser.'} ${note ? `${note} ` : ''}${error ?? ''} Changes save by themselves a moment after you make them. Undo history is not saved: it starts fresh each time a project is opened.`}
      >
        {status === 'loading' ? 'Loading…' : status === 'saving' ? 'Saving…' : status === 'unsaved' ? 'Unsaved' : status === 'error' ? 'Could not save' : status === 'conflict' ? 'Needs your attention' : 'Saved ✓'}
      </span>

      <div className="group" role="group" aria-label="Panels">
        <button className={`btn icon ${leftOpen ? 'active' : ''}`} aria-pressed={leftOpen} title="Library panel" onClick={() => app.ui.getState().setPanel('left', !leftOpen)}>{Icons.panelLeft}</button>
        <button className={`btn icon ${rightOpen ? 'active' : ''}`} aria-pressed={rightOpen} title="Inspector panel" onClick={() => app.ui.getState().setPanel('right', !rightOpen)}>{Icons.panelRight}</button>
      </div>
    </header>
  );
}
