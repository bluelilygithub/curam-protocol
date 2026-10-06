import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { TooltipHost } from '@planner-core/help/TooltipHost';
import { analyseApp, deserializeApp, fullRuns, ParseError, sampleProject, serializeApp, type AppProject } from './app/model';
import type { AppStore } from './app/store';
import { INFO_KEY, type UiStore } from './app/uiStore';
import type { WallSide } from './enclosure';
import { badRunIds, elevationView, planView } from './views';
import { DrawingView } from './ui/DrawingView';
import { InfoModal } from './ui/InfoModal';
import { Icon } from './ui/icons';
import { ChecksPanel, EnclosurePanel, RackPanel, RunsPanel, StoreContext } from './ui/panels';

const DRAFT_KEY = 'cellar-planner:enclosure-draft:v1';

export function loadDraft(): AppProject | null {
  try { const t = localStorage.getItem(DRAFT_KEY); return t ? deserializeApp(t) : null; } catch { return null; }
}

const WALLS: Array<[WallSide, string]> = [['NORTH', 'North'], ['EAST', 'East'], ['SOUTH', 'South'], ['WEST', 'West']];

export function App({ store, ui }: { store: AppStore; ui: UiStore }) {
  const project = useStore(store, (s) => s.project);
  const revision = useStore(store, (s) => s.revision);
  const canUndo = useStore(store, (s) => s.past.length > 0);
  const canRedo = useStore(store, (s) => s.future.length > 0);
  const tab = useStore(ui, (s) => s.tab);
  const wall = useStore(ui, (s) => s.wall);
  const [msg, setMsg] = useState('');
  const file = useRef<HTMLInputElement>(null);

  // first visit: show the guide once. Vault's Settings page opens the planner with ?tour=1 to retake the tour.
  useEffect(() => {
    try { if (!localStorage.getItem(INFO_KEY)) ui.getState().set({ infoOpen: true }); } catch { /* storage blocked: skip the auto-open */ }
    if (new URLSearchParams(window.location.search).has('tour')) window.setTimeout(() => void startTour(), 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** Shepherd is loaded on first use, so it stays out of the main bundle. */
  const startTour = async (): Promise<void> => { const m = await import('./help/cellarTour'); m.startCellarTour(ui); };

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
        <header className="top" data-tour="cp-project">
          <h1>Cellar Planner <small>glass enclosure</small></h1>
          <input className="name" value={project.name} aria-label="Project name" title="The name of this design. It is used for the saved file's name." data-testid="project-name" onChange={(e) => store.getState().edit((p) => ({ ...p, name: e.target.value }))} />
          <div className="actions">
            <button type="button" className="btn" disabled={!canUndo} title="Undo the last change (every change is one step)." onClick={() => store.getState().undo()} data-testid="undo">Undo</button>
            <button type="button" className="btn" disabled={!canRedo} title="Put back the change you just undid." onClick={() => store.getState().redo()} data-testid="redo">Redo</button>
            <button type="button" className="btn" title="Download this design as a .cellar.json file you can keep or send to someone." onClick={download} data-testid="save">Save file</button>
            <button type="button" className="btn" title="Open a .cellar.json file saved earlier or sent to you. It replaces the design on screen." onClick={() => file.current?.click()} data-testid="open">Open file</button>
            <button type="button" className="btn" title="Load the sample enclosure, read from the Carter Noir drawings (values unverified). It replaces the design on screen." onClick={() => { store.getState().load(sampleProject()); setMsg('Loaded the sample enclosure.'); }} data-testid="sample">Sample</button>
            <button type="button" className="btn icon" title="How this works: the plain-language guide." onClick={() => ui.getState().set({ infoOpen: true })} data-testid="info-open"><Icon name="info" /></button>
            <button type="button" className="btn icon" title="Take the guided tour." onClick={() => void startTour()} data-testid="tour-start"><Icon name="compass" /></button>
            <input ref={file} type="file" accept=".json,application/json" hidden aria-label="Open a design file" title="Open a design file" onChange={(e) => void open(e.target.files?.[0])} />
          </div>
          {msg && <p className="status" role="status" data-testid="status">{msg}</p>}
        </header>
        <aside className="left" data-testid="left"><EnclosurePanel /><RackPanel /><RunsPanel /></aside>
        <main className="stage">
          <div className="tabs" role="tablist" data-tour="cp-tabs">
            <button type="button" role="tab" aria-selected={tab === 'plan'} className={`tab${tab === 'plan' ? ' on' : ''}`} title="The enclosure from above: walls, door, racks and sizes." onClick={() => ui.getState().set({ tab: 'plan' })} data-testid="tab-plan">Plan</button>
            <button type="button" role="tab" aria-selected={tab === 'elevation'} className={`tab${tab === 'elevation' ? ' on' : ''}`} title="One wall seen from outside: door, header, conditioner, vents and sizes." onClick={() => ui.getState().set({ tab: 'elevation' })} data-testid="tab-elevation">Elevation</button>
            {tab === 'elevation' && WALLS.map(([w, name]) => <button type="button" key={w} className={`tab small${wall === w ? ' on' : ''}`} title={`Show the ${name.toLowerCase()} wall as seen from outside.`} onClick={() => ui.getState().set({ wall: w })} data-testid={`wall-${w}`}>{name}</button>)}
            <span className="hint">{tab === 'plan' ? 'From above. Drag to move, scroll to zoom.' : `The ${wall.toLowerCase()} wall seen from outside.`}</span>
          </div>
          {tab === 'plan' ? <DrawingView key="plan" prims={plan} testid="plan" /> : <DrawingView key={`elev-${wall}`} prims={elevation} testid="elevation" />}
          <p className="foot">PRELIMINARY DESIGN ONLY: FINAL SITE MEASURE REQUIRED PRIOR TO FABRICATION</p>
        </main>
        <aside className="right"><ChecksPanel /></aside>
      </div>
      <InfoModal ui={ui} />
      <TooltipHost />
    </StoreContext.Provider>
  );
}
