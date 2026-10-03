import { fitView, panBy } from './adapters/canvas';
import { proposeCreateRoom, proposeDeleteRoom, proposeFixPosition } from './engine/pipeline';
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
import { convertProjection, presetCamera, type CameraPreset, type CameraState, type Projection } from './render3d/cameraPresets';
import { createUiStore, type ViewMode } from './state/uiStore';
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
  const interaction = new Interaction({
    project, ui, bus, newId: randomId, now: () => performance.now(),
    panBy: (dx, dy) => view.getState().setView(panBy(view.getState().view, dx, dy)),
    onRoomCreated: () => fitToRoom(),
  });

  project.getState().load(loadStoredProject(storage) ?? newProject());

  /**
   * Begin autosaving; returns the cleanup. Kept out of `createApp` so React StrictMode's mount → unmount → mount cycle
   * (which reuses the same app object) re-arms it instead of leaving it disposed.
   */
  function start(): () => void {
    let lastRevision = project.getState().revision;
    const autosave: Autosave = startAutosave(
      storage,
      () => project.getState().project,
      (onChange) => project.subscribe((s) => {
        if (s.revision !== lastRevision) { lastRevision = s.revision; onChange(); }
      }),
      (s) => ui.getState().setSaveStatus(s),
    );
    return () => {
      autosave.dispose();
      interaction.cancel();
    };
  }

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

  return {
    project, ui, view, bus, interaction, camera,

    fitToRoom,

    // ------------------------------------------------------------ 3D view (M4)

    /** Switch between the 2D and 3D views. A gesture in progress is cancelled; selection and both cameras are kept. */
    setViewMode(mode: ViewMode): void {
      interaction.switchView(mode);
    },

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

    /** B8 "Start from a rectangle": one undoable CreateRoom. */
    startRectangle(): void {
      const p = project.getState().project;
      if (!p) return;
      const result = proposeCreateRoom(p, rectangleRoom(randomId));
      if (project.getState().commitResult(result, 'Create room')) fitToRoom();
    },

    /** B8 "Draw a room": the wall tool with no room yet. Click corners, click the first one (or Enter) to close. */
    startDrawing(): void {
      interaction.setTool('wall_edit');
    },

    /** Remove the room (undoable) so another can be drawn. Furniture and doors in it go with it, and come back on undo. */
    deleteRoom(): void {
      const p = project.getState().project;
      const room = p?.rooms[0];
      if (!p || !room) return;
      interaction.cancel();
      ui.getState().clearSelection();
      project.getState().commitResult(proposeDeleteRoom(p, room.id), 'Delete room');
    },

    /** Discard the current project and start empty (history resets). */
    newBlank(): void {
      interaction.cancel();
      ui.getState().clearSelection();
      project.getState().load(newProject());
    },

    openJson(text: string): boolean {
      const r = parseProjectFile(text);
      if (!r.ok) { notify(`Could not open that file: ${r.error}`, 'error'); return false; }
      interaction.cancel();
      ui.getState().clearSelection();
      project.getState().load(r.project);
      fitToRoom();
      notify('Project opened. Undo history starts fresh.');
      return true;
    },

    /** The text of the download. The caller turns it into a file. */
    exportJson(): { name: string; text: string } | null {
      const p = project.getState().project;
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
}

export type App = ReturnType<typeof createApp>;
