import { useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { TooltipHost } from '@planner-core/help/TooltipHost';
import { analyseApp, deserializeApp, fullRuns, ParseError, sampleProject, serializeApp, testCaseProject } from './app/model';
import { DRAFT_KEY } from './app/designLibrary';
import type { Designs } from './app/designs';
import type { AppStore } from './app/store';
import { INFO_KEY, type UiStore } from './app/uiStore';
import type { WallSide } from './enclosure';
import { badRunIds, bottlesOnWall, elevationView, planView, rackFaceView, rackWallSummary } from './views';
import { ConflictBar, DesignsPanel, SaveStatus } from './ui/DesignsPanel';
import { DrawingView } from './ui/DrawingView';
import { CodeModal, projectFromCode } from './ui/CodeModal';
import { InfoModal } from './ui/InfoModal';
import { PackageModal } from './ui/PackageModal';
import { Icon } from './ui/icons';
import { Accordion } from './ui/fields';
import { CatalogueContext, ChecksPanel, EnclosurePanel, PricePanel, RackPanel, RunsPanel, StoreContext } from './ui/panels';
import { createCatalogueStore, type CatalogueStore } from './app/catalogue';
import { createLeadsStore, openLeadDesign, type FetchFn, type LeadsStore } from './app/leads';
import { LeadsPanel } from './ui/LeadsPanel';
import { QuoteModal } from './ui/QuoteModal';
import { CalcModal } from './ui/CalcModal';

const WALLS: Array<[WallSide, string]> = [['NORTH', 'North'], ['EAST', 'East'], ['SOUTH', 'South'], ['WEST', 'West']];

export function App({ store, ui, designs, catalogue, leads, ready }: { store: AppStore; ui: UiStore; designs: Designs; catalogue?: CatalogueStore; leads?: LeadsStore; ready?: Promise<unknown> }) {
  // the rack catalogue and the website enquiries come from Vault; without them (a test, or signed out) the planner still works
  const fallbackCatalogue = useMemo(() => createCatalogueStore(), []);
  const fallbackLeads = useMemo(() => createLeadsStore(), []);
  const cat = catalogue ?? fallbackCatalogue;
  const leadStore = leads ?? fallbackLeads;
  const fetchFn: FetchFn | undefined = typeof fetch === 'function' ? (url, init) => fetch(url, init) : undefined;
  const newLeads = useStore(leadStore, (s) => s.leads.filter((l) => l.status === 'new').length);
  const project = useStore(store, (s) => s.project);
  const revision = useStore(store, (s) => s.revision);
  const canUndo = useStore(store, (s) => s.past.length > 0);
  const canRedo = useStore(store, (s) => s.future.length > 0);
  const tab = useStore(ui, (s) => s.tab);
  const wall = useStore(ui, (s) => s.wall);
  const rackWall = useStore(ui, (s) => s.rackWall);
  const pane = useStore(ui, (s) => s.pane);
  const msg = useStore(ui, (s) => s.notice);
  const setMsg = (notice: string): void => ui.getState().set({ notice });
  const file = useRef<HTMLInputElement>(null);

  // first visit: show the guide once. Vault's Settings page opens the planner with ?tour=1 to retake the tour.
  useEffect(() => {
    try { if (!localStorage.getItem(INFO_KEY)) ui.getState().set({ infoOpen: true }); } catch { /* storage blocked: skip the auto-open */ }
    if (new URLSearchParams(window.location.search).has('tour')) window.setTimeout(() => void startTour(), 400);
    // ?testcase=1 opens the ready-made test case (estimated rack values) instead of the saved draft
    if (new URLSearchParams(window.location.search).has('testcase')) void designs.whenReady().then(() => addDesign(testCaseProject(), 'Added the test case as a new design: its rack values are best guesses.'));
    // ?d=<design code> (a link from the public planner) opens that design as a new one
    const linked = new URLSearchParams(window.location.search).get('d');
    if (linked) void designs.whenReady().then(() => { const r = projectFromCode(linked); if ('project' in r) return addDesign(r.project, 'Opened the design from the link as a new design: its rack values are best guesses.'); setMsg(r.error); return undefined; });
    // ?lead=<number> (the link in a CRM deal made from a website enquiry) opens that enquiry's design as a new one, once Vault's catalogue has loaded
    const lead = Number(new URLSearchParams(window.location.search).get('lead'));
    if (Number.isInteger(lead) && lead > 0) {
      void Promise.all([designs.whenReady(), ready ?? Promise.resolve()]).then(() => openEnquiry(lead)).then(() => {
        try { const u = new URL(window.location.href); u.searchParams.delete('lead'); window.history.replaceState(null, '', u.toString()); } catch { /* fine */ }
      });
    }
    void (ready ?? Promise.resolve()).then(() => leadStore.getState().load(fetchFn, localStorage));
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
  const racks = useMemo(() => rackFaceView(project.enclosure, fullRuns(project), analysis.racks, rackWall, project.bottle, { badRuns: badRunIds(analysis.racks.issues) }), [project, analysis, rackWall]);
  const e = project.enclosure;
  const bottles = analysis.racks.total.status === 'OK' ? `${analysis.racks.total.capacity} bottles` : 'bottles not set';
  const planText = `Plan of the enclosure from above: ${e.outerWidthMm} by ${e.outerDepthMm} millimetres outside, ${analysis.enclosure.internal.widthMm} by ${analysis.enclosure.internal.depthMm} inside, door on the ${e.door.wall.toLowerCase()} wall opening ${e.door.swing === 'OUT' ? 'outwards' : 'inwards'}, ${project.runs.length} rack run${project.runs.length === 1 ? '' : 's'}, ${bottles}.`;
  const elevText = `The ${wall.toLowerCase()} wall seen from outside: ${wall === e.door.wall ? `${e.door.leaves === 2 ? 'double door' : 'door'} ${e.door.widthMm} by ${e.door.heightMm} millimetres, ` : 'no door, '}wall height ${e.heightMm} millimetres, header ${e.headerHeightMm} millimetres.`;
  const wallRuns = project.runs.filter((r) => r.wall === rackWall);
  const rackText = `The inside face of the ${rackWall.toLowerCase()} wall seen from inside: ${wallRuns.reduce((n, r) => n + r.units, 0)} rack unit${wallRuns.reduce((n, r) => n + r.units, 0) === 1 ? '' : 's'}, each bottle drawn end-on at its true size, ${bottlesOnWall(analysis.racks, fullRuns(project), rackWall)} bottles on this wall.`;

  const download = (): void => {
    const url = URL.createObjectURL(new Blob([serializeApp(project)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'enclosure'}.cellar.json`;
    a.click(); URL.revokeObjectURL(url);
  };
  /** A design from a file, the test case or the blank sample is ADDED to the saved designs and opened; the design that was open stays saved as it was. */
  const addDesign = async (p: ReturnType<typeof testCaseProject>, message: string): Promise<void> => { await designs.controller.importProject(p); setMsg(message); };
  /** A website enquiry opens as a NEW design (the one open stays saved), with the catalogue's default rack type. */
  const openEnquiry = async (id: number): Promise<void> => {
    const r = await openLeadDesign({ id, fetchFn, storage: localStorage, catalogue: cat.getState().catalogue, importProject: (p) => designs.controller.importProject(p) });
    setMsg(r.message);
    if (r.ok) void leadStore.getState().load(fetchFn, localStorage);
  };
  const open = async (f: File | undefined): Promise<void> => {
    if (!f) return;
    try { await addDesign(deserializeApp(await f.text()), `Opened ${f.name} as a new design.`); } catch (e) { setMsg(e instanceof ParseError ? e.message : 'Could not open that file.'); }
    if (file.current) file.current.value = '';
  };

  return (
    <StoreContext.Provider value={store}>
    <CatalogueContext.Provider value={catalogue ?? null}>
      <div className="app" data-pane={pane}>
        <header className="toolbar" role="toolbar" aria-label="Main toolbar" data-tour="cp-project">
          <div className="toolbar-row">
            <div className="brand">
              <span className="brand-name">Cellar Planner</span>
              <span className="title-help">
                <button type="button" aria-label="Take the guided tour" title="Take the guided tour." onClick={() => void startTour()} data-testid="tour-start"><Icon name="compass" /></button>
                <button type="button" aria-label="How this works" title="How this works: the plain-language guide." onClick={() => ui.getState().set({ infoOpen: true })} data-testid="info-open"><Icon name="info" /></button>
                <button type="button" aria-label="How the numbers are calculated" title="How the numbers are calculated: the formulas and working for this design, step by step, for technicians." onClick={() => ui.getState().set({ calcOpen: true })} data-testid="calc-open"><Icon name="calc" /></button>
              </span>
            </div>
            <div className="group" role="group" aria-label="History">
              <button type="button" className="btn icon" aria-label="Undo" disabled={!canUndo} title="Undo the last change (every change is one step)." onClick={() => store.getState().undo()} data-testid="undo"><Icon name="undo" /></button>
              <button type="button" className="btn icon" aria-label="Redo" disabled={!canRedo} title="Put back the change you just undid." onClick={() => store.getState().redo()} data-testid="redo"><Icon name="redo" /></button>
            </div>
            <div className="group" role="group" aria-label="Design">
              <input className="name" value={project.name} aria-label="Project name" title="The name of this design. It is how it appears in Your designs and in the saved file's name." data-testid="project-name" onChange={(e) => store.getState().updateSilently((p) => ({ ...p, name: e.target.value }))} />
              <button type="button" className="btn" title="Your saved designs: open one, start a new one, copy or delete. Designs save by themselves." onClick={() => ui.getState().set({ designsOpen: true })} data-testid="designs-open"><Icon name="file" /><span className="label">Your designs</span></button>
              <button type="button" className="btn" title="People who sent your website's contact form with a design from the public planner. Open one to start from their design." onClick={() => ui.getState().set({ leadsOpen: true })} data-testid="leads-open"><Icon name="list" /><span className="label">Enquiries</span>{newLeads > 0 && <span className="badge" data-testid="leads-new-count" aria-label={`${newLeads} new`}>{newLeads}</span>}</button>
            </div>
            <div className="group" role="group" aria-label="File">
              <button type="button" className="btn" title="Download a copy of this design to your computer as a .cellar.json file, to keep or send to someone. This is not the save: designs save by themselves (see the status next to the name)." onClick={download} data-testid="save"><Icon name="download" /><span className="label">Download file</span></button>
              <button type="button" className="btn" title="Upload a .cellar.json file you downloaded earlier or were sent. It is added as a new saved design and opened; the design you have open stays as it is." onClick={() => file.current?.click()} data-testid="open"><Icon name="upload" /><span className="label">Upload file</span></button>
            </div>
            <div className="group" role="group" aria-label="Examples">
              <button type="button" className="btn" title="Load a ready-made test case: the sample enclosure with racks on every wall, filled with best-guess rack values so there are bottles to count. Every guess is marked estimated until you type your own number over it. It is added as a new saved design and opened." onClick={() => void addDesign(testCaseProject(), 'Added the test case as a new design: its rack values are best guesses.')} data-testid="testcase">Test case</button>
              <button type="button" className="btn" title="Load the sample enclosure, read from the Carter Noir drawings (values unverified), with the racks left blank. It is added as a new saved design and opened. For one with racks filled in, use Test case." onClick={() => void addDesign(sampleProject(), 'Added the blank sample as a new design.')} data-testid="sample">Blank sample</button>
              <button type="button" className="btn" title="Paste a design code from a visitor's enquiry (from the public planner). It is added as a new design with best-guess racks; your other designs are not changed." onClick={() => ui.getState().set({ codeOpen: true })} data-testid="code-open">From design code</button>
            </div>
            <div className="group" role="group" aria-label="Output">
              <button type="button" className="btn" title="Make a PDF of A3 drawing sheets: the specification, the plan, the elevation and the racks on each wall, with a title block. Every sheet says preliminary design only." onClick={() => ui.getState().set({ packageOpen: true })} data-testid="package-open"><Icon name="list" /><span className="label">Drawing package</span></button>
              <button type="button" className="btn" title="Make a quote PDF for the customer from the price breakdown. It is only available when the numbers behind it can be trusted: a confirmed rack type, no errors and a price." onClick={() => ui.getState().set({ quoteOpen: true })} data-testid="quote-open"><Icon name="download" /><span className="label">Quote</span></button>
            </div>
            <div className="spacer" />
            <SaveStatus designs={designs} />
            <input ref={file} type="file" accept=".json,application/json" hidden aria-label="Upload a design file" title="Upload a design file" onChange={(e) => void open(e.target.files?.[0])} />
          </div>
          <ConflictBar designs={designs} />
          {msg && <p className="toolbar-note" role="status" data-testid="status">{msg}</p>}
        </header>
        <nav className="panes" aria-label="Show" data-testid="panes">
          {([['controls', 'Controls', 'The settings: enclosure, racks and runs.'], ['drawing', 'Drawing', 'The plan, elevation and racks drawings.'], ['checks', `Checks${analysis.racks.issues.length ? ` (${analysis.racks.issues.length})` : ''}`, 'What is wrong or worth a look, with the fix for each.']] as const).map(([k, label, tip]) => (
            <button type="button" key={k} title={tip} aria-pressed={pane === k} className={`tab${pane === k ? ' on' : ''}`} onClick={() => ui.getState().set({ pane: k })} data-testid={`pane-${k}`}>{label}</button>
          ))}
        </nav>
        <aside className="left" data-testid="left"><Accordion initial="Enclosure"><EnclosurePanel /><RackPanel /><RunsPanel /><PricePanel /></Accordion></aside>
        <main className="stage">
          <div className="tabs" role="group" aria-label="Drawing" data-tour="cp-tabs">
            <button type="button" aria-pressed={tab === 'plan'} className={`tab${tab === 'plan' ? ' on' : ''}`} title="The enclosure from above: walls, door, racks and sizes." onClick={() => ui.getState().set({ tab: 'plan' })} data-testid="tab-plan">Plan</button>
            <button type="button" aria-pressed={tab === 'elevation'} className={`tab${tab === 'elevation' ? ' on' : ''}`} title="One wall seen from outside: door, header, conditioner, vents and sizes." onClick={() => ui.getState().set({ tab: 'elevation' })} data-testid="tab-elevation">Elevation</button>
            <button type="button" aria-pressed={tab === 'racks'} className={`tab${tab === 'racks' ? ' on' : ''}`} title="The inside face of one wall with every bottle drawn at its true size and spacing, so you can see the rows and the count. Racks that cannot be built are red and not counted." onClick={() => ui.getState().set({ tab: 'racks' })} data-testid="tab-racks">Racks</button>
            {tab === 'elevation' && WALLS.map(([w, name]) => <button type="button" key={w} aria-pressed={wall === w} className={`tab small${wall === w ? ' on' : ''}`} title={`Show the ${name.toLowerCase()} wall as seen from outside.`} onClick={() => ui.getState().set({ wall: w })} data-testid={`wall-${w}`}>{name}</button>)}
            {tab === 'racks' && WALLS.map(([w, name]) => <button type="button" key={w} aria-pressed={rackWall === w} className={`tab small${rackWall === w ? ' on' : ''}`} title={`Show the racks on the ${name.toLowerCase()} wall, seen from inside.`} onClick={() => ui.getState().set({ rackWall: w })} data-testid={`rackwall-${w}`}>{name}</button>)}
            <span className="hint">{tab === 'plan' ? 'From above. Drag to move, scroll or pinch to zoom.' : tab === 'racks' ? `The ${rackWall.toLowerCase()} wall seen from inside, bottles end-on.` : `The ${wall.toLowerCase()} wall seen from outside.`}</span>
          </div>
          {tab === 'plan' ? <DrawingView key="plan" prims={plan} testid="plan" description={planText} /> : tab === 'racks' ? <DrawingView key={`racks-${rackWall}`} prims={racks} testid="racks" description={rackText} /> : <DrawingView key={`elev-${wall}`} prims={elevation} testid="elevation" description={elevText} />}
          {tab === 'racks' && <p className="racks-summary" data-testid="racks-summary" role="status">{rackWallSummary(analysis.racks, fullRuns(project), rackWall).text} <span className="muted">Whole enclosure: {bottles}.</span></p>}
          <p className="foot">PRELIMINARY DESIGN ONLY: FINAL SITE MEASURE REQUIRED PRIOR TO FABRICATION</p>
        </main>
        <aside className="right"><ChecksPanel /></aside>
      </div>
      <InfoModal ui={ui} />
      <CodeModal ui={ui} onOpen={(p) => void addDesign(p, 'Opened the design code as a new design: its rack values are best guesses.')} />
      <PackageModal store={store} ui={ui} />
      <CalcModal store={store} ui={ui} catalogue={cat} />
      <QuoteModal store={store} ui={ui} catalogue={cat} fetchFn={fetchFn} storage={localStorage} />
      <LeadsPanel ui={ui} leads={leadStore} reload={() => void leadStore.getState().load(fetchFn, localStorage)} onOpen={(id) => void openEnquiry(id)} />
      <DesignsPanel ui={ui} designs={designs} onImportFile={(f) => void open(f)} />
      <TooltipHost />
    </CatalogueContext.Provider>
    </StoreContext.Provider>
  );
}
