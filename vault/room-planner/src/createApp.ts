import { fitView, panBy } from './adapters/canvas';
import { proposeCreateRoom, proposeFixPosition } from './engine/pipeline';
import { aabbOf } from './engine/geometry';
import { Interaction } from './interaction/interaction';
import { nameOf } from './interaction/statusMessages';
import { createFeedbackBus } from './state/feedbackBus';
import {
  loadStoredProject, parseProjectFile, projectFileName, startAutosave, type Autosave, type StorageLike,
} from './state/persistence';
import { newProject, randomId, rectangleRoom } from './state/projectFactory';
import { createProjectStore } from './state/projectStore';
import { serializeProject } from './engine/serialize';
import { createUiStore } from './state/uiStore';
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
  const interaction = new Interaction({
    project, ui, bus, newId: randomId, now: () => performance.now(),
    panBy: (dx, dy) => view.getState().setView(panBy(view.getState().view, dx, dy)),
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
    project, ui, view, bus, interaction,

    fitToRoom,

    /** B8 "Start from a rectangle": one undoable CreateRoom. */
    startRectangle(): void {
      const p = project.getState().project;
      if (!p) return;
      const result = proposeCreateRoom(p, rectangleRoom(randomId));
      if (project.getState().commitResult(result, 'Create room')) fitToRoom();
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
