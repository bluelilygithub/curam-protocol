import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { analyseApp, deserializeApp, fullRuns, ParseError, sampleProject, serializeApp, type AppProject } from './app/model';
import type { AppStore } from './app/store';
import type { WallSide } from './enclosure';
import { badRunIds, elevationView, planView } from './views';
import { DrawingView } from './ui/DrawingView';
import { ChecksPanel, EnclosurePanel, RackPanel, RunsPanel, StoreContext } from './ui/panels';

const DRAFT_KEY = 'cellar-planner:enclosure-draft:v1';

export function loadDraft(): AppProject | null {
  try { const t = localStorage.getItem(DRAFT_KEY); return t ? deserializeApp(t) : null; } catch { return null; }
}

const WALLS: Array<[WallSide, string]> = [['NORTH', 'North'], ['EAST', 'East'], ['SOUTH', 'South'], ['WEST', 'West']];

export function App({ store }: { store: AppStore }) {
  const project = useStore(store, (s) => s.project);
  const revision = useStore(store, (s) => s.revision);
  const canUndo = useStore(store, (s) => s.past.length > 0);
  const canRedo = useStore(store, (s) => s.future.length > 0);
  const [tab, setTab] = useState<'plan' | 'elevation'>('plan');
  const [wall, setWall] = useState<WallSide>(project.enclosure.door.wall);
  const [msg, setMsg] = useState('');
  const file = useRef<HTMLInputElement>(null);

  // keep a draft in this browser so a closed tab loses nothing
  useEffect(() => {
    const t = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, serializeApp(project)); } catch { /* private mode or full: nothing to do */ } }, 400);
    return () => clearTimeout(t);
  }, [revision, project]);

  const analysis = useMemo(() => analyseApp(project), [project]);
  const plan = useMemo(() => planView(project.enclosure, fullRuns(project), analysis.racks, { walkwayMm: project.walkwayMm, badRuns: badRunIds(analysis.racks.issues) }), [project, analysis]);
  const elevation = useMemo(() => elevationView(project.enclosure, wall), [project.enclosure, wall]);

  const download = (): void => {
    const url = URL.createObjectURL(new Blob([serializeApp(project)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'enclosure'}.cellar.json`;
    a.click(); URL.revokeObjectURL(url);
  };
  const open = async (f: File | undefined): Promise<void> => {
    if (!f) return;
    try { store.getState().load(deserializeApp(await f.text())); setMsg(`Opened ${f.name}.`); } catch (e) { setMsg(e instanceof ParseError ? e.message : 'Could not open that file.'); }
    if (file.current) file.current.value = '';
  };

  return (
    <StoreContext.Provider value={store}>
      <div className="app">
        <header className="top">
          <h1>Cellar Planner <small>glass enclosure</small></h1>
          <input className="name" value={project.name} aria-label="Project name" data-testid="project-name" onChange={(e) => store.getState().edit((p) => ({ ...p, name: e.target.value }))} />
          <div className="actions">
            <button type="button" className="btn" disabled={!canUndo} onClick={() => store.getState().undo()} data-testid="undo">Undo</button>
            <button type="button" className="btn" disabled={!canRedo} onClick={() => store.getState().redo()} data-testid="redo">Redo</button>
            <button type="button" className="btn" onClick={download} data-testid="save">Save file</button>
            <button type="button" className="btn" onClick={() => file.current?.click()} data-testid="open">Open file</button>
            <button type="button" className="btn" onClick={() => { store.getState().load(sampleProject()); setMsg('Loaded the sample enclosure.'); }} data-testid="sample">Sample</button>
            <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => void open(e.target.files?.[0])} />
          </div>
          {msg && <p className="status" role="status" data-testid="status">{msg}</p>}
        </header>
        <aside className="left" data-testid="left"><EnclosurePanel /><RackPanel /><RunsPanel /></aside>
        <main className="stage">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'plan'} className={`tab${tab === 'plan' ? ' on' : ''}`} onClick={() => setTab('plan')} data-testid="tab-plan">Plan</button>
            <button type="button" role="tab" aria-selected={tab === 'elevation'} className={`tab${tab === 'elevation' ? ' on' : ''}`} onClick={() => setTab('elevation')} data-testid="tab-elevation">Elevation</button>
            {tab === 'elevation' && WALLS.map(([w, name]) => <button type="button" key={w} className={`tab small${wall === w ? ' on' : ''}`} onClick={() => setWall(w)} data-testid={`wall-${w}`}>{name}</button>)}
            <span className="hint">{tab === 'plan' ? 'From above. Drag to move, scroll to zoom.' : `The ${wall.toLowerCase()} wall seen from outside.`}</span>
          </div>
          {tab === 'plan' ? <DrawingView key="plan" prims={plan} testid="plan" /> : <DrawingView key={`elev-${wall}`} prims={elevation} testid="elevation" />}
          <p className="foot">PRELIMINARY DESIGN ONLY: FINAL SITE MEASURE REQUIRED PRIOR TO FABRICATION</p>
        </main>
        <aside className="right"><ChecksPanel /></aside>
      </div>
    </StoreContext.Provider>
  );
}
