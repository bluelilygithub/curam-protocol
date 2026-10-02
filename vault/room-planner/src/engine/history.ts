import { apply, inverse } from './commands';
import type { Command, Project } from './types';

export interface History {
  /** Only after a successful commit. Clears the redo branch. `label` is the human action name (B9). */
  push(command: Command, label?: string): void;
  /** Applies the inverse of the newest command. `null` when empty. */
  undo(state: Project): Project | null;
  /** Re-applies the next undone command. `null` when at newest. */
  redo(state: Project): Project | null;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Label of the entry the next undo / redo would act on (B9: "Undo · Move Sofa"). */
  undoLabel(): string | undefined;
  redoLabel(): string | undefined;
}

export interface HistoryJSON {
  done: Command[];
  undone: Command[];
  doneLabels?: Array<string | null>;
  undoneLabels?: Array<string | null>;
}

export class CommandHistory implements History {
  private done: Command[] = [];
  private undone: Command[] = [];
  private doneLabels: Array<string | undefined> = [];
  private undoneLabels: Array<string | undefined> = [];

  push(command: Command, label?: string): void {
    this.done.push(command);
    this.doneLabels.push(label);
    this.undone = [];
    this.undoneLabels = [];
  }

  undo(state: Project): Project | null {
    const cmd = this.done[this.done.length - 1];
    if (!cmd) return null;
    const next = apply(inverse(cmd), state);
    this.done.pop();
    this.undone.push(cmd);
    this.undoneLabels.push(this.doneLabels.pop());
    return next;
  }

  redo(state: Project): Project | null {
    const cmd = this.undone[this.undone.length - 1];
    if (!cmd) return null;
    const next = apply(cmd, state);
    this.undone.pop();
    this.done.push(cmd);
    this.doneLabels.push(this.undoneLabels.pop());
    return next;
  }

  canUndo(): boolean { return this.done.length > 0; }
  canRedo(): boolean { return this.undone.length > 0; }
  get length(): number { return this.done.length; }
  undoLabel(): string | undefined { return this.doneLabels[this.doneLabels.length - 1]; }
  redoLabel(): string | undefined { return this.undoneLabels[this.undoneLabels.length - 1]; }

  /** Commands are plain JSON-serialisable data. */
  toJSON(): HistoryJSON {
    return {
      done: structuredClone(this.done),
      undone: structuredClone(this.undone),
      doneLabels: this.doneLabels.map((l) => l ?? null),
      undoneLabels: this.undoneLabels.map((l) => l ?? null),
    };
  }

  static fromJSON(data: HistoryJSON): CommandHistory {
    const h = new CommandHistory();
    h.done = structuredClone(data.done);
    h.undone = structuredClone(data.undone);
    h.doneLabels = h.done.map((_, i) => data.doneLabels?.[i] ?? undefined);
    h.undoneLabels = h.undone.map((_, i) => data.undoneLabels?.[i] ?? undefined);
    return h;
  }
}
