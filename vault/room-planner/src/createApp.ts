import { fitView, panBy } from './adapters/canvas';
import { proposeCreateRoom, proposeDeleteRoom, proposeFixPosition } from './engine/pipeline';
import { cleanName, cloneRoom, nextRoomName } from './engine/roomOps';
import { aabbOf } from './engine/geometry';
import { addSavedView, deleteSavedView, renameSavedView, savedViewsOf } from './engine/savedViews';
import { Interaction } from './interaction/interaction';
import { nameOf } from './interaction/statusMessages';
import { createFeedbackBus } from './state/feedbackBus';
import {
  loadStoredProject, parseProjectFile, projectFileName, startAutosave, type Autosave, type StorageLike,
} from './state/persistence';
import { newProject, randomId, rectangleRoom } from './state/projectFactory';
import { createProjectStore } from './state/projectStore';
import { serializeProject } from './engine/serialize';
import { createCameraStore } from './state/cameraStore';
import { chooseLibrary, type FetchLike } from './state/library';
import { createLibraryStore } from './state/libraryStore';
import { ProjectsController } from './state/projects';
import { convertProjection, presetCamera, type CameraPreset, type CameraState, type Projection } from './render3d/cameraPresets';
import { buildTour } from './render3d/tour';
import { walkStart } from './render3d/walk';
import { createUiStore, type Look, type Quality, type ViewMode } from './state/uiStore';
import { createViewStore } from './state/viewStore';

/**
 * Composition root: the stores, the interaction engine and the project-level actions the UI buttons call.
 * Everything here is DOM-free except `saveFile`/`openFile`, which take the browser pieces they need as arguments.
 */
export function createApp(storage: StorageLike) {
  const project = createProjectStore(null);
  const ui = createUiStore();
  const view = createViewStore();
  const bus = createFeedbackBus();
  const camera = createCameraStore();
  const library = createLibraryStore();
  const interaction = new Interaction({
    project, ui, bus, newId: randomId, now: () => performance.now(),
    panBy: (dx, dy) => view.getState().setView(panBy(view.getState().view, dx, dy)),
    onRoomCreated: () => fitToRoom(),
  });

  project.getState().load(loadStoredProject(storage) ?? newProject());

  // Quality is a per-browser preference (never part of the project). Default low.
  const QUALITY_KEY = 'room-planner:quality:v1';
  try {
    const q = storage.getItem(QUALITY_KEY);
    if (q === 'low' || q === 'high') ui.getState().setQuality(q);
  } catch { /* storage unavailable: keep the default */ }
  // The Cinematic look (clay / realistic) is a per-browser preference too. Default clay.
  const LOOK_KEY = 'room-planner:look:v1';
  try {
    const l = storage.getItem(LOOK_KEY);
    if (l === 'clay' || l === 'realistic') ui.getState().setLook(l);
  } catch { /* storage unavailable: keep the default */ }
  let lastQuality = ui.getState().quality;
  let lastLook = ui.getState().look;
  ui.subscribe((s) => {
    if (s.quality !== lastQuality) {
      lastQuality = s.quality;
      try { storage.setItem(QUALITY_KEY, s.quality); } catch { /* ignore */ }
    }
    if (s.look !== lastLook) {
      lastLook = s.look;
      try { storage.setItem(LOOK_KEY, s.look); } catch { /* ignore */ }
    }
  });

  /** Put the 3D camera back on the (new) active room, if the 3D view has been used. */
  function frameCamera(): void {
    const room = project.getState().project?.rooms[0];
    const cur = camera.getState().camera;
    if (!room || !cur) return;
    const { viewport } = camera.getState();
    camera.getState().requestCamera(presetCamera(room, 'iso', cur, { aspect: viewport.w / viewport.h, viewportW: viewport.w, viewportH: viewport.h }), false);
  }

  /** The project library: where projects are saved, which one is open, and saving it (Spec M5 projects). */
  const projects = new ProjectsController({
    project, store: library, storage, newId: randomId,
    choose: () => chooseLibrary({
      storage, newId: randomId,
      fetch: typeof fetch === 'function' ? (((url, init) => fetch(url, init)) as FetchLike) : undefined,
    }),
    newEmpty: (name) => ({ ...newProject(), name }),
    schedule: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
    notify: (text, severity) => notify(text, severity),
    onLoaded: () => {
      interaction.cancel();
      ui.getState().clearSelection();
      ui.getState().setTourPlaying(false);
      ui.getState().setWalking(false);
      fitToRoom();
      frameCamera();
    },
  });
  let initDone: Promise<void> | null = null;

  /**
   * Begin autosaving; returns the cleanup. Kept out of `createApp` so React StrictMode's mount → unmount → mount cycle
   * (which reuses the same app object) re-arms it instead of leaving it disposed.
   */
  function start(): () => void {
    let lastRevision = project.getState().revision;
    const autosave: Autosave = startAutosave(
      storage,
      () => project.getState().document, // the draft mirror holds every room
      (onChange) => project.subscribe((s) => {
        if (s.revision !== lastRevision) { lastRevision = s.revision; onChange(); }
      }),
      (s) => ui.getState().setSaveStatus(s),
    );
    const detach = projects.attach();
    initDone ??= projects.init();
    // leaving browser full screen (Esc, or the browser's own control) also leaves the presentation view and pauses the tour
    const onFullscreen = (): void => {
      if (typeof document !== 'undefined' && !document.fullscreenElement && ui.getState().immersive) {
        ui.getState().setImmersive(false);
        ui.getState().setTourPlaying(false);
      }
    };
    if (typeof document !== 'undefined') document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      autosave.dispose();
      detach();
      interaction.cancel();
      if (typeof document !== 'undefined') document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }

  /**
   * Live walk-mode input, written by the keyboard and the on-screen pad and read every frame by the 3D view. It changes many times
   * a second, so it is deliberately not a store (A12).
   */
  const walkInput = { keys: new Set<string>(), padX: 0, padY: 0 };

  const notify = (text: string, severity: 'info' | 'warn' | 'error' = 'info'): void => ui.getState().setStatus({ text, severity });

  function fitToRoom(): void {
    const room = project.getState().project?.rooms[0];
    if (!room) return;
    const box = aabbOf(room.vertices.map((v) => v.position));
    const pad = 0.5;
    const { viewport } = view.getState();
    view.getState().setView(fitView(
      { min: { x: box.min.x - pad, y: box.min.y - pad }, max: { x: box.max.x + pad, y: box.max.y + pad } }, viewport, 56,
    ));
  }

  function app_exitImmersive(): void {
    ui.getState().setImmersive(false);
    ui.getState().setTourPlaying(false);
    try { if (typeof document !== 'undefined' && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); } catch { /* ignore */ }
  }

  const api = {
    project, ui, view, bus, interaction, camera,

    fitToRoom,

    // ------------------------------------------------------------ help (tour; the info modal is plain UI state)

    /** Choose the colour palette of the active room (`null` = the standard colours). One undoable step; shown in the 3D view. */
    setPalette(id: string | null): void {
      const room = project.getState().project?.rooms[0];
      if (!room || (room.palette ?? null) === id) return;
      project.getState().commit({ type: 'UpdateRoom', roomId: room.id, from: { palette: room.palette ?? null }, to: { palette: id } }, id ? 'Change colour palette' : 'Remove colour palette');
    },

    /** Start the guided tour (Shepherd is loaded on first use, so it stays out of the main bundle). */
    async startTour(): Promise<void> {
      const m = await import('./help/roomPlannerTour');
      m.startRoomPlannerTour(api as unknown as App);
    },

    // ------------------------------------------------------------ 3D view (M4)

    /** Switch between the 2D and 3D views. A gesture in progress is cancelled; selection and both cameras are kept. */
    setViewMode(mode: ViewMode): void {
      interaction.switchView(mode);
    },

    // ------------------------------------------------------------ Cinematic (Spec Addition A1)

    /** Cinematic on/off. Presentation only: the project and its history are never touched. */
    setCinematic(on: boolean): void {
      if (!on && ui.getState().immersive) app_exitImmersive();
      ui.getState().setCinematic(on);
    },
    setQuality(q: Quality): void { ui.getState().setQuality(q); },
    setLook(l: Look): void { ui.getState().setLook(l); },
    walkInput,

    /** Start walking through the room at eye height (collides with walls and furniture). False, with a message, if there is nowhere to stand. */
    startWalk(): boolean {
      const room = project.getState().project?.rooms[0];
      if (!room) return false;
      if (!walkStart(room)) { notify('There is no room to walk in here: the floor is too small or full.', 'warn'); return false; }
      interaction.cancel();
      ui.getState().setWalking(true);
      return true;
    },
    stopWalk(): void { ui.getState().setWalking(false); },
    toggleWalk(): void { if (ui.getState().walking) ui.getState().setWalking(false); else this.startWalk(); },
    playTour(): void { ui.getState().setTourPlaying(true); },
    pauseTour(): void { ui.getState().setTourPlaying(false); },
    toggleTour(): void { ui.getState().setTourPlaying(!ui.getState().tourPlaying); },
    /** What the fly-through would visit right now (for the label next to Play). */
    tourSummary(): { stops: number; source: 'saved views' | 'automatic' | 'saved view + automatic' } | null {
      const p = project.getState().project;
      const room = p?.rooms[0];
      if (!p || !room) return null;
      const views = p.savedViews ?? [];
      const t = buildTour(room, views);
      return { stops: t.stops.length, source: views.length >= 2 ? 'saved views' : views.length === 1 ? 'saved view + automatic' : 'automatic' };
    },
    /** Hide the interface for a presentation, and ask the browser for full screen where it allows it (inside Vault's frame it may not). */
    enterImmersive(): void {
      ui.getState().setImmersive(true);
      try { void document.documentElement.requestFullscreen?.().catch(() => undefined); } catch { /* not allowed: the hidden interface still works */ }
    },
    exitImmersive(): void { app_exitImmersive(); },

    /** Move the 3D camera to a preset (animated). `fit` keeps the current direction. */
    cameraPreset(preset: CameraPreset): void {
      const room = project.getState().project?.rooms[0];
      if (!room) return;
      const { camera: cur, viewport } = camera.getState();
      camera.getState().requestCamera(
        presetCamera(room, preset, cur, { aspect: viewport.w / viewport.h, viewportW: viewport.w, viewportH: viewport.h }), true,
      );
    },

    /** Perspective ⇄ orthographic, keeping the framing (no animation: the camera object is swapped). */
    setProjection(projection: Projection): void {
      const { camera: cur, viewport } = camera.getState();
      if (!cur || cur.projection === projection) return;
      camera.getState().requestCamera(convertProjection(cur, projection, viewport.h), false);
    },

    /** Save the current 3D camera as a named view (not an undoable edit, D44). Returns the new id. */
    saveView(name?: string): string | null {
      const cur = camera.getState().camera;
      const room = project.getState().project?.rooms[0];
      if (!cur || !project.getState().project) return null;
      const id = randomId();
      project.getState().updateSilently((p) => addSavedView(p, {
        id, ...(name ? { name } : {}), cameraPosition: cur.position, target: cur.target, projection: cur.projection, zoom: cur.zoom,
        ...(room ? { roomId: room.id } : {}),
      }));
      return id;
    },

    /** Fly to a saved view. */
    restoreView(id: string): void {
      const p = project.getState().project;
      const v = p ? savedViewsOf(p).find((x) => x.id === id) : undefined;
      if (!v) return;
      const state: CameraState = { position: v.cameraPosition, target: v.target, projection: v.projection, zoom: v.zoom ?? camera.getState().camera?.zoom ?? 100 };
      camera.getState().requestCamera(state, camera.getState().camera?.projection === v.projection);
    },

    renameView(id: string, name: string): void {
      project.getState().updateSilently((p) => renameSavedView(p, id, name));
    },

    deleteView(id: string): void {
      project.getState().updateSilently((p) => deleteSavedView(p, id));
    },

    // ------------------------------------------------------------ rooms (several per project)

    /** B8 "Start from a rectangle" / "Add room": a 4 × 5 m room named Room N, one undoable CreateRoom; it becomes the open room. */
    startRectangle(): void {
      const d = project.getState().document;
      if (!d) return;
      const result = proposeCreateRoom(d, rectangleRoom(randomId, 4, 5, nextRoomName(d)));
      if (project.getState().commitResult(result, 'Create room')) { ui.getState().clearSelection(); fitToRoom(); frameCamera(); }
    },

    /** B8 "Draw a room": the wall tool with no room open. With rooms already there, the open room steps aside until this one is closed. */
    startDrawing(): void {
      if ((project.getState().document?.rooms.length ?? 0) > 0) { interaction.cancel(); ui.getState().clearSelection(); project.getState().setActiveRoom(null); }
      interaction.setTool('wall_edit');
    },

    /** Give up adding a room and go back to the one that was open. */
    cancelNewRoom(): void {
      interaction.cancel();
      project.getState().restoreActiveRoom();
      interaction.setTool('select');
    },

    /** Open another room of this project (no history entry). */
    switchRoom(id: string): void {
      if (id === project.getState().activeRoomId) return;
      interaction.cancel();
      ui.getState().clearSelection();
      project.getState().setActiveRoom(id);
      fitToRoom();
      frameCamera();
    },

    /** A copy of a room (default: the open one) with its furniture and openings; one undoable step, and it becomes the open room. */
    duplicateRoom(id?: string): void {
      const d = project.getState().document;
      const room = d?.rooms.find((r) => r.id === (id ?? project.getState().activeRoomId));
      if (!d || !room) return;
      const copy = cloneRoom(room, randomId, cleanName(`${room.name} (copy)`, 'Room copy'));
      if (project.getState().commitResult(proposeCreateRoom(d, copy), 'Duplicate room')) { ui.getState().clearSelection(); fitToRoom(); frameCamera(); }
    },

    /** Rename a room: one undoable step. */
    renameRoom(id: string, name: string): void {
      const room = project.getState().document?.rooms.find((r) => r.id === id);
      if (!room) return;
      const next = cleanName(name, room.name);
      if (next === room.name) return;
      project.getState().commit({ type: 'UpdateRoom', roomId: id, from: { name: room.name }, to: { name: next } }, 'Rename room');
    },

    /** Remove a room (default: the open one), undoable. Its furniture and doors go with it and come back on undo. */
    deleteRoom(id?: string): void {
      const d = project.getState().document;
      const target = id ?? project.getState().activeRoomId;
      if (!d || !target || !d.rooms.some((r) => r.id === target)) return;
      interaction.cancel();
      ui.getState().clearSelection();
      project.getState().commitResult(proposeDeleteRoom(d, target), 'Delete room');
      fitToRoom();
      frameCamera();
    },

    // ------------------------------------------------------------ projects (the library)

    library,
    projects,
    /** Resolves when the library has been chosen and the last project opened (tests, start-up). */
    whenReady(): Promise<void> { return initDone ?? Promise.resolve(); },
    newProject: (name?: string) => projects.newProject(name),
    openProject: (id: string) => projects.open(id),
    renameProject: (id: string, name: string) => projects.rename(id, name),
    duplicateProject: (id: string) => projects.duplicate(id),
    deleteProject: (id: string) => projects.remove(id),
    saveProject: () => projects.saveNow(),

    /** Add a project from a file's text and open it. */
    async importFile(text: string): Promise<boolean> {
      const r = parseProjectFile(text);
      if (!r.ok) { notify(`Could not open that file: ${r.error}`, 'error'); return false; }
      await projects.importProject(r.project);
      notify('Project added to your library and opened. Undo history starts fresh.');
      return true;
    },

    /** Synchronous check plus a fire-and-forget import (kept for callers that only need to know the file was readable). */
    openJson(text: string): boolean {
      const r = parseProjectFile(text);
      if (!r.ok) { notify(`Could not open that file: ${r.error}`, 'error'); return false; }
      void projects.importProject(r.project);
      return true;
    },

    /** The text of the download (every room). The caller turns it into a file. */
    exportJson(): { name: string; text: string } | null {
      const p = project.getState().document;
      return p ? { name: projectFileName(p), text: serializeProject(p) } : null;
    },

    /** B5 "Fix position": one MoveFurniture to the nearest valid position, or a plain message. */
    fixPosition(id: string): void {
      const p = project.getState().project;
      if (!p) return;
      const r = proposeFixPosition(p, id);
      if (project.getState().commitResult(r, `Fix position of ${nameOf(p, id)}`)) return;
      if (r.rejected && r.message) notify(r.message, 'warn');
    },

    notify,
    start,
  };
  return api;
}

export type App = ReturnType<typeof createApp>;
