import { useRef } from 'react';
import { useApp, useProject, useUi } from './AppContext';
import { Icons } from './icons';
import type { Tool } from '../state/uiStore';

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
  const leftOpen = useUi((s) => s.leftOpen);
  const rightOpen = useUi((s) => s.rightOpen);
  const saveStatus = useUi((s) => s.saveStatus);
  const canUndo = useProject((s) => s.canUndo);
  const canRedo = useProject((s) => s.canRedo);
  const undoLabel = useProject((s) => s.undoLabel);
  const redoLabel = useProject((s) => s.redoLabel);
  const hasRoom = useProject((s) => !!s.project?.rooms.length);
  const fileInput = useRef<HTMLInputElement>(null);

  const undo = () => app.interaction.keyDown({ key: 'z', ctrl: true, shift: false, alt: false });
  const redo = () => app.interaction.keyDown({ key: 'z', ctrl: true, shift: true, alt: false });

  const download = (): void => {
    const out = app.exportJson();
    if (!out) return;
    const url = URL.createObjectURL(new Blob([out.text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = out.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <header className="toolbar" role="toolbar" aria-label="Main toolbar">
      <div className="brand" title="Room Planner">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">Room Planner</span>
      </div>

      <div className="group" role="group" aria-label="Tools">
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

      <div className="group seg3d" role="group" aria-label="Switch view">
        <button className={`btn ${viewMode === '2d' ? 'active' : ''}`} aria-pressed={viewMode === '2d'} title="2D plan view (V)" onClick={() => app.setViewMode('2d')}>
          <span className="label">2D</span>
        </button>
        <button className={`btn ${viewMode === '3d' ? 'active' : ''}`} aria-pressed={viewMode === '3d'} disabled={!hasRoom} title="3D view (V)" onClick={() => app.setViewMode('3d')}>
          <span className="label">3D</span>
        </button>
      </div>

      <div className="group" role="group" aria-label="History">
        <button className="btn" disabled={!canUndo} onClick={undo} title={undoLabel ? `Undo · ${undoLabel}` : 'Nothing to undo'}>
          {Icons.undo}<span className="label">{canUndo && undoLabel ? `Undo · ${undoLabel}` : 'Undo'}</span>
        </button>
        <button className="btn" disabled={!canRedo} onClick={redo} title={redoLabel ? `Redo · ${redoLabel}` : 'Nothing to redo'}>
          {Icons.redo}<span className="label">{canRedo && redoLabel ? `Redo · ${redoLabel}` : 'Redo'}</span>
        </button>
      </div>

      <div className="group" role="group" aria-label="View">
        <button className={`btn icon ${showClearances ? 'active' : ''}`} aria-pressed={showClearances} title="Show clearance zones of the selection" onClick={() => app.ui.getState().toggleClearances()}>
          {Icons.clearance}
        </button>
        <button className={`btn icon ${showGrid ? 'active' : ''}`} aria-pressed={showGrid} title="Grid" onClick={() => app.ui.getState().toggleGrid()}>
          {Icons.grid}
        </button>
        <button className="btn icon" disabled={!hasRoom} title="Fit room to view" onClick={() => (viewMode === '3d' ? app.cameraPreset('fit') : app.fitToRoom())}>{Icons.fit}</button>
      </div>

      <div className="spacer" />

      <div className="group" role="group" aria-label="File">
        <button className="btn" onClick={download} disabled={!hasRoom} title="Download the project as a .json file">
          {Icons.file}<span className="label">Save file</span>
        </button>
        <button className="btn" onClick={() => fileInput.current?.click()} title="Open a project .json file">
          <span className="label">Open…</span>
        </button>
        <button
          className="btn"
          onClick={() => { if (!hasRoom || window.confirm('Start a new project? Download the current one first if you want to keep it.')) app.newBlank(); }}
          title="Start a new empty project"
        >
          <span className="label">New</span>
        </button>
        <input
          ref={fileInput} type="file" accept="application/json,.json" hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) app.openJson(await f.text());
            e.target.value = '';
          }}
        />
      </div>

      <span
        className={`save save-${saveStatus}`}
        role="status"
        title="Your project is saved in this browser. Undo history is not saved: it starts fresh each time the project is opened."
      >
        {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Could not save' : 'Project saved'}
      </span>

      <div className="group" role="group" aria-label="Panels">
        <button className={`btn icon ${leftOpen ? 'active' : ''}`} aria-pressed={leftOpen} title="Library panel" onClick={() => app.ui.getState().setPanel('left', !leftOpen)}>{Icons.panelLeft}</button>
        <button className={`btn icon ${rightOpen ? 'active' : ''}`} aria-pressed={rightOpen} title="Inspector panel" onClick={() => app.ui.getState().setPanel('right', !rightOpen)}>{Icons.panelRight}</button>
      </div>
    </header>
  );
}
