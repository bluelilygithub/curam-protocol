import { fitView, panBy } from '@planner-core/adapters/canvas';
import { createViewStore } from '@planner-core/state/viewStore';
import { aabbOf, dist } from '@planner-core/engine/geometry';
import type { Command } from './domain/commands';
import { setItem } from './domain/commands';
import {
  addBed, addLawn, addPath, addService, addPlant, addStructure, addZone, deleteItem, fillBedCommand, findItem, newHouse, replaceItem, setBoundaryCmd, setHouseCmd, translated,
} from './domain/edit';
import { boundaryFromPoints, cleanName, cloneGarden, isBlank, newGardenProject, randomId, rectanglePoints } from './domain/projectFactory';
import { sampleShape } from './domain/shapes';
import type { GardenProject, ProjectMeta, ServiceKind, StructureKind, Underlay, Vec2 } from './domain/types';
import { ProjectsController } from '@planner-core/library/projectsController';
import { MAX_PROJECT_NAME } from '@planner-core/library/library';
import { createPlaceLookup } from './state/geocode';
import { createPlantPhotos } from './state/plantPhotos';
import { createMapTiles } from './map/tiles';
import { createTagScanner } from './state/tagScan';
import type { MapSettings } from './domain/types';
import { createChecksStore } from './state/checksStore';
import { computeChecks, makeSunLookup, nearestValidPosition, type Issue } from './checks';
import { blobToDataUrl, browserImageStore, dataUrlToBlob, isLocalRef } from './state/images';
import { chooseLibrary, createLibraryStore, CURRENT_KEY, DIRTY_KEY, gardenCodec, type FetchLike } from './state/library';
import {
  deserializeProject, loadDraft, ParseError, projectFileName, serializeProject, startDraftAutosave, type Autosave, type StorageLike,
} from './state/persistence';
import { createProjectStore } from './state/projectStore';
import { createUiStore, type Selection, type Tool } from './state/uiStore';

export interface NewProjectOptions {
  meta: Omit<ProjectMeta, never>;
  plot?: { kind: 'rect'; width: number; depth: number } | null;
  /** A tracing picture (already shrunk): stored once, apart from the design, and referenced from it. */
  picture?: { blob: Blob; name: string; widthPx: number; heightPx: number } | null;
}

/**
 * Composition root: the stores plus the project-level actions the UI buttons call. DOM-free except where the browser pieces
 * (storage) are passed in, so it can be tested.
 */
export function createApp(storage: StorageLike) {
  const project = createProjectStore(null);
  const ui = createUiStore();
  const view = createViewStore();

  const library = createLibraryStore();
  // Sun-map thresholds are a per-browser preference (like Room Planner's look and snap settings), never part of the garden.
  const SUN_KEY = 'garden-planner:sun:v1';
  try {
    const v = JSON.parse(storage.getItem(SUN_KEY) ?? 'null') as { fullSunHours?: unknown; partShadeHours?: unknown } | null;
    if (v && typeof v.fullSunHours === 'number' && typeof v.partShadeHours === 'number' && v.partShadeHours > 0 && v.fullSunHours > v.partShadeHours) {
      ui.getState().set({ sunThresholds: { fullSunHours: v.fullSunHours, partShadeHours: v.partShadeHours } });
    }
  } catch { /* storage unavailable or damaged: keep the defaults */ }
  // The checks' two settings (narrowest path, mower width) are per-browser preferences too.
  const CHECK_KEY = 'garden-planner:checks:v1';
  try {
    const v = JSON.parse(storage.getItem(CHECK_KEY) ?? 'null') as { pathMinWidth?: unknown; mowerWidth?: unknown } | null;
    if (v && typeof v.pathMinWidth === 'number' && v.pathMinWidth >= 0.3 && v.pathMinWidth <= 3) ui.getState().set({ pathMinWidth: v.pathMinWidth });
    if (v && typeof v.mowerWidth === 'number' && v.mowerWidth >= 0.3 && v.mowerWidth <= 3) ui.getState().set({ mowerWidth: v.mowerWidth });
  } catch { /* keep the defaults */ }
  ui.subscribe((s, prev) => {
    if (s.pathMinWidth !== prev.pathMinWidth || s.mowerWidth !== prev.mowerWidth) { try { storage.setItem(CHECK_KEY, JSON.stringify({ pathMinWidth: s.pathMinWidth, mowerWidth: s.mowerWidth })); } catch { /* ignore */ } }
  });
  ui.subscribe((s, prev) => {
    if (s.sunThresholds !== prev.sunThresholds) { try { storage.setItem(SUN_KEY, JSON.stringify(s.sunThresholds)); } catch { /* ignore */ } }
  });
  const places = createPlaceLookup(storage);
  const plantPhotos = createPlantPhotos(storage);
  const mapTiles = createMapTiles(storage);
  const tagScanner = createTagScanner();
  /** The live 3D view, while there is one (Render photo asks it where the camera is). */
  const view3d: { current: { cameraState(): { position: [number, number, number]; target: [number, number, number]; fov?: number }; walking: boolean; startWalk(): boolean; stopWalk(): void; presetPose(k: 'iso' | 'front' | 'top'): { position: [number, number, number]; target: [number, number, number] } | null } | null } = { current: null };
  const checks = createChecksStore();
  const images = browserImageStore(() => library.getState().kind, randomId, storage);

  const notify = (text: string, severity: 'info' | 'warn' | 'error' = 'info'): void => ui.getState().setStatus(text, severity);
  const cur = (): GardenProject | null => project.getState().project;

  function plotBox(p: GardenProject): { min: Vec2; max: Vec2 } {
    const pts: Vec2[] = [];
    if (p.boundary) pts.push(...p.boundary.vertices.map((v) => v.position));
    if (p.house) pts.push(...p.house.vertices.map((v) => v.position));
    if (p.underlay) {
      const u = p.underlay;
      pts.push(u.origin, { x: u.origin.x + u.widthPx * u.metresPerPixel, y: u.origin.y + u.heightPx * u.metresPerPixel });
    }
    for (const b of p.beds) pts.push(...sampleShape(b.shape));
    if (!pts.length) return { min: { x: -2, y: -2 }, max: { x: 18, y: 14 } };
    return aabbOf(pts);
  }

  function fitToPlot(): void {
    const p = cur();
    if (!p) return;
    const b = plotBox(p);
    const pad = 1;
    view.getState().setView(fitView({ min: { x: b.min.x - pad, y: b.min.y - pad }, max: { x: b.max.x + pad, y: b.max.y + pad } }, view.getState().viewport, 56));
  }

  /** The project library: where gardens are saved (the Vault account, or this browser offline) and which one is open. */
  const projects = new ProjectsController({
    doc: {
      get: () => cur(),
      revision: () => project.getState().revision,
      subscribe: (fn) => project.subscribe(fn),
      load: (p) => project.getState().load(p),
      setName: (name) => project.getState().updateSilently((p) => ({ ...p, name })),
    },
    store: library, storage, newId: randomId,
    choose: () => chooseLibrary({
      storage, newId: randomId,
      fetch: typeof fetch === 'function' ? (((url, init) => fetch(url, init)) as FetchLike) : undefined,
    }),
    newEmpty: (name) => newGardenProject(name),
    schedule: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
    notify: (text, severity) => notify(text, severity),
    onLoaded: () => { ui.getState().set({ selection: null, tool: 'select', projectsOpen: false }); fitToPlot(); void normalisePicture(); },
    currentKey: CURRENT_KEY, dirtyKey: DIRTY_KEY,
    clone: (p, name) => cloneGarden(p, randomId, name),
    nameOf: (p) => gardenCodec.nameOf(p),
    withName: (p, name) => ({ ...p, name }),
    cleanName,
    isEmpty: isBlank,
    loadDraft: () => loadDraft(storage),
  });
  let initDone: Promise<void> | null = null;

  /** Move an embedded picture (a file, or a garden saved before pictures were stored apart) into storage; the design keeps a reference. */
  async function storeEmbeddedPicture(p: GardenProject): Promise<void> {
    const u = p.underlay;
    if (!u?.dataUrl) return;
    const blob = dataUrlToBlob(u.dataUrl);
    const { dataUrl: _drop, ...rest } = u;
    void _drop;
    if (!blob) { delete p.underlay; notify('The tracing picture in that garden could not be read, so it was left out.', 'warn'); return; }
    const stored = await images.put(blob);
    if (stored.note) notify(stored.note, 'warn');
    p.underlay = { ...rest, imageId: stored.ref };
  }

  let normalising = false;
  /**
   * Keep the open garden's picture where it belongs: an embedded one (migration of gardens saved before pictures were stored apart) is
   * stored and replaced by a reference; a browser-only one is moved to the account once the library is saving there. Changes the
   * design without an undo step; autosave then saves the small design.
   */
  async function normalisePicture(): Promise<void> {
    if (normalising) return;
    const p0 = cur();
    const u0 = p0?.underlay;
    if (!p0 || !u0) return;
    const needsStore = !!u0.dataUrl;
    const needsPromote = !needsStore && isLocalRef(u0.imageId) && library.getState().kind === 'server';
    if (!needsStore && !needsPromote) return;
    normalising = true;
    try {
      const copy = structuredClone(p0);
      if (needsStore) await storeEmbeddedPicture(copy);
      else copy.underlay = { ...u0, imageId: await images.promote(u0.imageId) };
      const now = cur();
      if (!now || now.id !== p0.id || now.underlay !== u0) return; // another garden, or edited meanwhile: try again next time
      if (copy.underlay?.imageId === u0.imageId && !u0.dataUrl) return;
      project.getState().updateSilently((p) => {
        const next = { ...p };
        if (copy.underlay) next.underlay = copy.underlay; else delete next.underlay;
        return next;
      });
    } finally { normalising = false; }
  }

  const api = {
    project, ui, view, notify, fitToPlot, library, projects, images, places, plantPhotos, mapTiles, tagScanner, view3d,
    /** The on-screen walking pad's position (-1..1), read by the 3D view while walking: it changes every pointer move, so it is not a store. */
    walkInput: { padX: 0, padY: 0 }, checks,
    /** Resolves when the library has been chosen and the last garden opened (start-up, tests). */
    whenReady(): Promise<void> { return initDone ?? Promise.resolve(); },

    // ------------------------------------------------------------ projects
    /** Start a garden from the wizard. A blank garden that is already open (a new library starts with one) is filled in rather than left behind. */
    async newProject(o: NewProjectOptions): Promise<void> {
      const p = newGardenProject(o.meta.name, o.meta.location);
      Object.assign(p, o.meta);
      if (o.plot?.kind === 'rect') p.boundary = boundaryFromPoints(rectanglePoints(o.plot.width, o.plot.depth));
      if (o.picture) {
        const stored = await images.put(o.picture.blob);
        if (stored.note) notify(stored.note, 'warn');
        // a first guess: the picture is 20 m wide. The Scale tool fixes it by marking a known length.
        p.underlay = { name: o.picture.name, imageId: stored.ref, widthPx: o.picture.widthPx, heightPx: o.picture.heightPx, metresPerPixel: 20 / o.picture.widthPx, origin: { x: 0, y: 0 }, rotation: 0, opacity: 0.6 };
      }
      const open = cur();
      ui.getState().set({ selection: null, tool: 'select', wizardOpen: false });
      if (open && isBlank(open) && library.getState().currentId) {
        project.getState().load({ ...p, id: open.id }); // the change autosaves over the blank entry
        fitToPlot();
      } else await projects.importProject(p);
    },
    openProject: (id: string) => projects.open(id),
    duplicateProject: (id: string) => projects.duplicate(id),
    deleteProject: (id: string) => projects.remove(id),
    renameProject(name: string): void {
      project.getState().updateSilently((p) => ({ ...p, name: cleanName(name, 'My garden', MAX_PROJECT_NAME) }));
    },
    async importFile(text: string): Promise<boolean> {
      try {
        const p = deserializeProject(text);
        p.id = randomId(); // a file you open twice is two gardens, not one overwritten
        await storeEmbeddedPicture(p); // an exported file carries its picture; it goes to storage, not into the design
        await projects.importProject(p);
        notify('Garden added to your library and opened.');
        return true;
      } catch (e) {
        notify(e instanceof ParseError ? e.message : 'Could not open that file.', 'error');
        return false;
      }
    },
    /** The garden as a file. The file carries its tracing picture (so it works anywhere); on import the picture goes back to storage. */
    async exportJson(): Promise<{ name: string; text: string } | null> {
      const p = cur();
      if (!p) return null;
      let out = p;
      if (p.underlay?.imageId) {
        try {
          const dataUrl = await blobToDataUrl(await images.blob(p.underlay.imageId));
          const { imageId: _ref, ...rest } = p.underlay;
          void _ref;
          out = { ...p, underlay: { ...rest, imageId: '', dataUrl } };
        } catch { notify('The tracing picture could not be included in the file.', 'warn'); }
      }
      return { name: projectFileName(p), text: serializeProject(out) };
    },
    /** The version chosen in a save conflict. */
    resolveConflict(keep: 'mine' | 'saved'): Promise<void> { return keep === 'mine' ? projects.overwriteMine() : projects.reloadTheirs(); },

    // ------------------------------------------------------------ editing
    commit(command: Command, label: string): boolean { return project.getState().commit(command, label); },
    undo(): void { const l = project.getState().undo(); if (l) notify(`Undid: ${l}`); ui.getState().select(stillThere(ui.getState().selection)); },
    redo(): void { const l = project.getState().redo(); if (l) notify(`Redid: ${l}`); ui.getState().select(stillThere(ui.getState().selection)); },

    /** Change the wizard answers (location, climate, frost, pets, soil, north). One undoable step. */
    updateMeta(patch: Partial<ProjectMeta>): void {
      const p = cur();
      if (!p) return;
      const from: Partial<ProjectMeta> = {};
      for (const k of Object.keys(patch) as Array<keyof ProjectMeta>) (from as Record<string, unknown>)[k] = p[k];
      project.getState().commit({ type: 'SetMeta', from, to: patch }, 'Change garden settings');
    },

    setBoundary(points: Vec2[]): void {
      const p = cur();
      if (p) project.getState().commit(setBoundaryCmd(p, boundaryFromPoints(points)), 'Draw boundary');
    },
    setHouse(points: Vec2[]): void {
      const p = cur();
      if (!p) return;
      project.getState().commit(setHouseCmd(p, newHouse(points, randomId)), 'Draw house');
    },
    /** `smooth` defaults to the Curves setting; a dragged rectangle passes false so it stays a rectangle. */
    addBed(points: Vec2[], smooth: boolean = ui.getState().smoothShapes): void {
      const p = cur(); if (!p) return;
      const cmd = addBed(points, smooth, randomId, p.beds.length + 1);
      project.getState().commit(cmd, 'Draw bed');
      if (cmd.type === 'SetItem') ui.getState().select({ kind: 'bed', id: cmd.id });
    },
    addLawn(points: Vec2[], smooth: boolean = ui.getState().smoothShapes): void {
      const p = cur(); if (!p) return;
      const cmd = addLawn(points, smooth, randomId, p.lawns.length + 1);
      project.getState().commit(cmd, 'Draw lawn');
      if (cmd.type === 'SetItem') ui.getState().select({ kind: 'lawn', id: cmd.id });
    },
    addZone(points: Vec2[]): void {
      const p = cur(); if (!p) return;
      project.getState().commit(addZone(points, randomId, p.zones.length + 1), 'Draw zone');
    },
    addPath(points: Vec2[]): void {
      const p = cur(); if (!p) return;
      const cmd = addPath(points, randomId, p.paths.length + 1);
      project.getState().commit(cmd, 'Draw path');
      if (cmd.type === 'SetItem') ui.getState().select({ kind: 'path', id: cmd.id });
    },
    addService(points: Vec2[], kind: ServiceKind): void {
      const p = cur(); if (!p) return;
      const cmd = addService(points, kind, randomId, p.services.length + 1);
      project.getState().commit(cmd, 'Draw service');
      if (cmd.type === 'SetItem') ui.getState().select({ kind: 'service', id: cmd.id });
    },
    addStructure(kind: StructureKind, at: Vec2): void {
      const cmd = addStructure(kind, at, randomId);
      project.getState().commit(cmd, 'Place structure');
      if (cmd.type === 'SetItem') ui.getState().select({ kind: 'structure', id: cmd.id });
    },
    /** Plant once, then select the new plant and go back to Select (like Room Planner), so it can be dragged, duplicated or deleted. `keepPlanting` (Shift) stays armed. */
    addPlant(plantId: string, at: Vec2, keepPlanting = false): void {
      const cmd = addPlant(plantId, at, randomId);
      if (!project.getState().commit(cmd, 'Plant')) return;
      if (keepPlanting || cmd.type !== 'SetItem') return;
      ui.getState().setTool('select');
      ui.getState().select({ kind: 'plant', id: cmd.id });
    },
    fillBed(bedId: string, plantId: string): number {
      const p = cur(); if (!p) return 0;
      const cmd = fillBedCommand(p, bedId, plantId, randomId);
      if (!cmd || cmd.type !== 'Composite') { notify('That bed is too small to fit this plant.', 'warn'); return 0; }
      project.getState().commit(cmd, 'Fill bed with plants');
      return cmd.commands.length;
    },

    /** Replace the selected item (inspector edits). */
    updateSelected(sel: Selection, next: unknown, label: string): void {
      const p = cur(); if (!p) return;
      const cmd = replaceItem(p, sel, next);
      if (cmd) project.getState().commit(cmd, label);
    },
    deleteSelected(): void {
      const p = cur(); const sel = ui.getState().selection;
      if (!p || !sel) return;
      const cmd = deleteItem(p, sel);
      if (cmd && project.getState().commit(cmd, 'Delete')) ui.getState().select(null);
    },
    nudgeSelected(dx: number, dy: number): void {
      const p = cur(); const sel = ui.getState().selection;
      if (!p || !sel) return;
      const item = findItem(p, sel);
      if (!item) return;
      const cmd = replaceItem(p, sel, translated(item, sel.kind, dx, dy));
      if (cmd) project.getState().commit(cmd, 'Move');
    },
    duplicateSelected(): void {
      const p = cur(); const sel = ui.getState().selection;
      if (!p || !sel || sel.kind === 'boundary' || sel.kind === 'house') return;
      const item = structuredClone(findItem(p, sel)) as { id: string };
      const moved = translated(item, sel.kind, 0.6, -0.6) as { id: string };
      moved.id = randomId();
      const coll = ({ zone: 'zones', bed: 'beds', path: 'paths', service: 'services', lawn: 'lawns', structure: 'structures', plant: 'plants' } as const)[sel.kind];
      project.getState().commit(setItem(coll, moved.id, null, moved as never), 'Duplicate');
      ui.getState().select({ kind: sel.kind, id: moved.id });
    },

    /**
     * Copies of the selected item in a straight line (a hedge, an avenue, a row of herbs): `count` copies, `spacing` metres apart, in the
     * direction `angleDeg` (0 = right on the plan, 90 = up). One undo step; the last copy is selected. Returns how many were made.
     */
    duplicateRow(count: number, spacing: number, angleDeg: number): number {
      const p = cur(); const sel = ui.getState().selection;
      if (!p || !sel || sel.kind === 'boundary' || sel.kind === 'house') return 0;
      const n = Math.min(50, Math.max(1, Math.round(count)));
      if (!(spacing > 0)) return 0;
      const src = findItem(p, sel);
      if (!src) return 0;
      const coll = ({ zone: 'zones', bed: 'beds', path: 'paths', service: 'services', lawn: 'lawns', structure: 'structures', plant: 'plants' } as const)[sel.kind];
      const a = (angleDeg * Math.PI) / 180;
      const commands = [];
      let lastId = '';
      for (let i = 1; i <= n; i += 1) {
        const copy = translated(structuredClone(src), sel.kind, Math.cos(a) * spacing * i, Math.sin(a) * spacing * i) as { id: string };
        copy.id = randomId();
        lastId = copy.id;
        commands.push(setItem(coll, copy.id, null, copy as never));
      }
      if (!project.getState().commit({ type: 'Composite', commands } as never, n === 1 ? 'Duplicate' : `Make a row of ${n}`)) return 0;
      ui.getState().select({ kind: sel.kind, id: lastId });
      return n;
    },

    // ------------------------------------------------------------ satellite map
    /** Change the satellite map settings (one undo step). `null` removes them. */
    setMap(next: MapSettings | null, label: string): void {
      const p = cur(); if (!p) return;
      project.getState().commit({ type: 'SetSingleton', name: 'map', from: p.map ?? null, to: next }, label);
    },
    /** Switch the map on, anchored at the garden's location the first time. */
    showMap(on: boolean): void {
      const p = cur(); if (!p) return;
      const base: MapSettings = p.map ?? { on: false, lat: p.location.lat, lng: p.location.lng, opacity: 1 };
      this.setMap({ ...base, on }, on ? 'Show map' : 'Hide map');
      if (!on) ui.getState().set({ mapAlign: false });
    },
    /** Put the map back under the garden's location. */
    resetMap(): void {
      const p = cur(); if (!p?.map) return;
      this.setMap({ ...p.map, lat: p.location.lat, lng: p.location.lng }, 'Reset map position');
    },

    // ------------------------------------------------------------ tracing underlay
    setUnderlay(u: Underlay | null): void {
      const p = cur(); if (!p) return;
      project.getState().commit({ type: 'SetSingleton', name: 'underlay', from: p.underlay ?? null, to: u }, u ? 'Add tracing picture' : 'Remove tracing picture');
      if (u) fitToPlot();
    },
    /** The two clicked points are `known` metres apart: rescale the picture so they are. */
    applyScale(known: number): boolean {
      const p = cur(); const d = ui.getState().scaleDraft;
      if (!p?.underlay || !d?.b || !(known > 0)) return false;
      const u = p.underlay;
      const clickedMetres = dist(d.a, d.b);
      if (clickedMetres < 1e-6) return false;
      // scale about the first point so it stays put
      const k = known / clickedMetres;
      const next: Underlay = {
        ...u, metresPerPixel: u.metresPerPixel * k,
        origin: { x: d.a.x + (u.origin.x - d.a.x) * k, y: d.a.y + (u.origin.y - d.a.y) * k },
      };
      project.getState().commit({ type: 'SetSingleton', name: 'underlay', from: u, to: next }, 'Set picture scale');
      ui.getState().set({ scaleDraft: null, tool: 'select' });
      fitToPlot();
      return true;
    },

    /** Start the guided tour (Shepherd is loaded on first use, so it stays out of the main bundle). */
    async startTour(): Promise<void> {
      const m = await import('./help/gardenTour');
      m.startGardenTour(api as unknown as App);
    },

    setTool(t: Tool): void { ui.getState().setTool(t); },

    // ------------------------------------------------------------ checks
    /** Run the checks now (they also run by themselves a moment after every change). */
    runChecks,
    /** Do what an issue's "Fix" button says, as one undoable step. */
    applyFix(issue: Issue): void {
      const p = cur();
      const fix = issue.fix;
      if (!p || !fix) return;
      if (fix.kind === 'replace') { api.updateSelected(fix.sel, fix.next, fix.label); runChecks(); return; }
      const inst = p.plants.find((q) => q.id === fix.plantId);
      if (!inst) return;
      const spot = nearestValidPosition(p, fix.plantId);
      if (!spot) { notify('No clear spot within 5 m. Try a smaller plant, or a different part of the garden.', 'warn'); return; }
      project.getState().commit(setItem('plants', inst.id, inst, { ...inst, position: spot.to }), 'Fix position');
      notify(spot.clean ? 'Moved it to the nearest clear spot.' : 'Moved it to the nearest spot without a clash. It is still a little crowded there.', spot.clean ? 'info' : 'warn');
    },
    /** Select what an issue is about and bring it to the middle of the plan. */
    focusIssue(issue: Issue): void {
      const p = cur();
      if (!p) return;
      const ref = issue.items.find((it) => it.kind === 'boundary' || it.kind === 'house' || findItem(p, it));
      if (ref) ui.getState().set({ selection: ref, viewMode: '2d' });
      if (issue.at) {
        const v = view.getState().view, vp = view.getState().viewport;
        view.getState().setView({ ...v, offsetX: vp.width / 2 - issue.at.x * v.scale, offsetY: vp.height / 2 + issue.at.y * v.scale });
      }
    },
    panBy: (dx: number, dy: number): void => view.getState().setView(panBy(view.getState().view, dx, dy)),

    /** Begin saving; returns the cleanup. The library (account or browser) saves after a pause; the browser also keeps a draft. */
    start(): () => void {
      let last = project.getState().revision;
      const draft: Autosave = startDraftAutosave(
        storage, () => cur(),
        (onChange) => project.subscribe((s) => { if (s.revision !== last) { last = s.revision; onChange(); } }),
      );
      const detach = projects.attach();
      const unsubLibrary = library.subscribe((s, prev) => { if (s.status === 'saved' && (prev.status !== 'saved' || prev.kind !== s.kind)) void normalisePicture(); });
      initDone ??= projects.init().then(() => {
        // a library that started empty opens a blank garden: the wizard is how a garden gets its place and climate
        const p = cur();
        if (p && isBlank(p)) ui.getState().set({ wizardOpen: true });
      });
      return () => { draft.dispose(); detach(); unsubLibrary(); };
    },
  };

  // ---------------------------------------------------------------- checks run
  // A moment after the garden or a checks setting changes (never during a drag: the garden only changes when a gesture ends).
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  function runChecks(): void {
    clearTimeout(checkTimer);
    const p = cur();
    if (!p) { checks.getState().set({ issues: [], computing: false }); return; }
    const u = ui.getState();
    const issues = computeChecks(p, { pathMinWidth: u.pathMinWidth, mowerWidth: u.mowerWidth, sun: u.sunThresholds }, makeSunLookup(p));
    checks.getState().set({ issues, computing: false, runs: checks.getState().runs + 1 });
  }
  const scheduleChecks = (): void => {
    checks.getState().set({ computing: true });
    clearTimeout(checkTimer);
    checkTimer = setTimeout(runChecks, 300);
  };
  project.subscribe((s, prev) => { if (s.project !== prev.project) scheduleChecks(); });
  ui.subscribe((s, prev) => {
    if (s.pathMinWidth !== prev.pathMinWidth || s.mowerWidth !== prev.mowerWidth || s.sunThresholds !== prev.sunThresholds) scheduleChecks();
  });

  function stillThere(sel: Selection | null): Selection | null {
    const p = cur();
    return sel && p && findItem(p, sel) ? sel : null;
  }

  return api;
}

export type App = ReturnType<typeof createApp>;
